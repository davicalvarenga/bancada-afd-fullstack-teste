/**
 * Ponto de entrada das transformações: escolhe o algoritmo, acumula os passos,
 * transforma estouro de limite em aviso (resultado parcial) e avisa quando a
 * linguagem é vazia. É o único arquivo que a tela precisa chamar.
 */
import { Cfg, GlcLimitError, Step, StepLog, altsOf, familyRoot, rhsKey } from './cfg';
import { hasLeftRecursion, isLanguageEmpty, leftRecursion } from './analysis';
import { EMPTY_LANGUAGE_WARNING, removeEpsilon, removeUnits, removeUseless, simplify } from './simplify';
import { removeLeftRecursion } from './left-recursion';
import { DEFAULT_MAX_ITERATIONS, FactoringMode, factor } from './factoring';
import { toCnf, toGnf } from './normal-forms';

export type TransformKind = 'simplify' | 'useless' | 'epsilon' | 'unit' | 'left-recursion' | 'factoring' | 'cnf' | 'gnf';

export interface TransformInfo { id: TransformKind; label: string; summary: string }

export const TRANSFORMS: TransformInfo[] = [
  { id: 'simplify', label: 'Simplificação completa', summary: 'ε-livre → produções simples → símbolos inúteis.' },
  { id: 'useless', label: 'Símbolos inúteis', summary: 'Estéreis e depois inalcançáveis.' },
  { id: 'epsilon', label: 'ε-livre', summary: 'Anuláveis, combinações e novo início se S for anulável.' },
  { id: 'unit', label: 'Produções simples', summary: 'Fecho de cada variável; troca A → B.' },
  { id: 'left-recursion', label: 'Recursão à esquerda', summary: 'Direta e indireta (ordenação A1..An).' },
  { id: 'factoring', label: 'Fatoração à esquerda', summary: 'Direta e indireta, até não haver prefixo comum.' },
  { id: 'cnf', label: 'Forma Normal de Chomsky', summary: 'A → BC ou A → a.' },
  { id: 'gnf', label: 'Forma Normal de Greibach', summary: 'A → aα, α só variáveis.' },
];

export interface TransformOptions {
  /** Recursão à esquerda: A → βA' | β, A' → αA' | α (sem ε). */
  epsFreeRecursion: boolean;
  /** CNF/GNF: incluir a remoção (opcional) de símbolos inúteis. */
  removeUseless: boolean;
  /** Fatoração: teto de iterações (substituições + fatorações). */
  maxIterations: number;
  /**
   * Fatoração: 'aula' (indireta só nas variáveis originais) ou 'completa'. O padrão do
   * motor é 'completa' (comportamento anterior); a tela começa em 'aula'.
   */
  factoringMode: FactoringMode;
  /**
   * Fatoração: gramática (possivelmente parcial) obtida em aula. O primeiro passo em
   * que cada variável dela tem exatamente as mesmas alternativas recebe um destaque.
   */
  classResult: Cfg | null;
}

export const DEFAULT_OPTIONS: TransformOptions = {
  epsFreeRecursion: false,
  removeUseless: false,
  maxIterations: DEFAULT_MAX_ITERATIONS,
  factoringMode: 'completa',
  classResult: null,
};

/** Posição de uma variável nova dentro da família: A' = 1, A'' = 2, A3 = 3… (= ordem de criação). */
function familyRank(v: string, root: string): number {
  const suffix = v.slice(root.length);
  if (/^'+$/.test(suffix)) return suffix.length;
  if (/^\d+$/.test(suffix)) return Number(suffix);
  return 1000;
}

/**
 * Ordem de exibição: símbolo de partida, depois as variáveis originais na ordem da
 * entrada, cada uma seguida das variáveis novas que derivaram dela (A', A'', A3…, em
 * ordem de criação); as novas sem origem (Xa, Y1…) vão no fim, na ordem em que surgiram.
 */
export function displayOrder(g: Cfg, originals: readonly string[]): Cfg {
  const present = new Set(g.vars);
  const orig = new Set(originals);
  const family = new Map<string, string[]>();
  const tail: string[] = [];
  for (const v of g.vars) {
    if (orig.has(v) || v === g.start) continue;
    const root = familyRoot(v, present);
    if (orig.has(root) && present.has(root)) family.set(root, [...(family.get(root) ?? []), v]);
    else tail.push(v);
  }
  for (const [root, members] of family) members.sort((a, b) => familyRank(a, root) - familyRank(b, root));
  const out = [g.start, ...(family.get(g.start) ?? [])];
  for (const o of originals) if (present.has(o) && o !== g.start) out.push(o, ...(family.get(o) ?? []));
  for (const v of [...tail, ...g.vars]) if (!out.includes(v)) out.push(v);
  return { start: g.start, vars: out, prods: g.prods };
}

export const NO_COMPLETE_FACTORING =
  "Esta gramática não admite fatoração completa: o processo não termina. Use o modo 'como em aula'.";
export const STAGE_RECURSION = 'Etapa 1: retirar a recursão à esquerda';
export const STAGE_FACTORING = 'Etapa 2: fatorar a gramática resultante';

export const CLASS_MATCH_INTERMEDIATE =
  'Resultado da fatoração em aula; os passos seguintes continuam fatorando as variáveis novas.';
export const CLASS_MATCH_FINAL = 'Coincide com o resultado da fatoração em aula.';
export const CLASS_MATCH_INTERMEDIATE_OTHER =
  'Coincide com o resultado visto em aula; os passos seguintes continuam a transformação.';
export const CLASS_MATCH_FINAL_OTHER = 'Coincide com o resultado visto em aula.';

const MAX_RENAMED = 4;
const altSet = (x: Cfg, v: string, ren: (s: string) => string = (s) => s) =>
  altsOf(x, v).map((r) => rhsKey(r.map(ren))).sort().join('\u0002');

/**
 * Cada variável de `ref` tem, em `g`, exatamente as mesmas alternativas. As variáveis
 * que não existiam na entrada (criadas pela transformação: S', Xa, Y1…) podem ter
 * nome diferente no gabarito (S', X, Y'): tenta-se renomeá-las, de forma injetiva.
 * Com `full`, `g` também não pode ter variáveis com regras além das de `ref`.
 */
export function matchesPartial(g: Cfg, ref: Cfg, input?: Cfg, full = false): boolean {
  const refVars = ref.vars.filter((v) => altsOf(ref, v).length);
  if (!refVars.length) return false;
  const gVars = g.vars.filter((v) => altsOf(g, v).length);
  if (full && gVars.length !== refVars.length) return false;
  const old = new Set(input?.vars ?? []);
  const refNew = ref.vars.filter((v) => !old.has(v));
  const gNew = g.vars.filter((v) => !old.has(v));
  const test = (m: Map<string, string>) => {
    const ren = (s: string) => m.get(s) ?? s;
    return refVars.every((v) => altSet(g, ren(v)) === altSet(ref, v, ren));
  };
  if (test(new Map())) return true;
  if (!input || !refNew.length || refNew.length > MAX_RENAMED || refNew.length > gNew.length) return false;
  // tentativas de renomeação: cada variável nova do gabarito ↔ uma variável nova distinta da bancada
  const tryFrom = (i: number, m: Map<string, string>, used: Set<string>): boolean => {
    if (i === refNew.length) return test(m);
    for (const t of gNew) {
      if (used.has(t)) continue;
      m.set(refNew[i], t); used.add(t);
      if (tryFrom(i + 1, m, used)) return true;
      m.delete(refNew[i]); used.delete(t);
    }
    return false;
  };
  return tryFrom(0, new Map(), new Set());
}

/**
 * Marca o passo que coincide com o resultado de aula (texto do passo + destaque).
 * Prefere o primeiro passo em que a gramática INTEIRA coincide; se o gabarito for
 * parcial (só algumas variáveis), vale o primeiro passo em que elas coincidem.
 */
function markClassResult(kind: TransformKind, steps: Step[], ref: Cfg, input: Cfg): void {
  let i = steps.findIndex((s) => matchesPartial(s.grammar, ref, input, true));
  if (i < 0) i = steps.findIndex((s) => matchesPartial(s.grammar, ref, input));
  if (i < 0) return;
  const last = i === steps.length - 1;
  const note = kind === 'factoring'
    ? (last ? CLASS_MATCH_FINAL : CLASS_MATCH_INTERMEDIATE)
    : (last ? CLASS_MATCH_FINAL_OTHER : CLASS_MATCH_INTERMEDIATE_OTHER);
  steps[i] = { ...steps[i], explanation: `${steps[i].explanation} ${note}`, highlight: note };
}

export interface TransformResult {
  kind: TransformKind;
  input: Cfg;
  steps: Step[];
  /** Gramática do último passo (a entrada, se nada foi feito). */
  result: Cfg;
  warnings: string[];
  /** Motivo da recusa (ex.: fatoração com recursão à esquerda); null se executou. */
  refused: string | null;
  /** true quando um limite foi atingido e o resultado é parcial. */
  aborted: boolean;
}

export function runTransform(kind: TransformKind, input: Cfg, options: Partial<TransformOptions> = {}): TransformResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const log = new StepLog(input);
  const warnings: string[] = [];
  const warn = (m: string) => { if (!warnings.includes(m)) warnings.push(m); };
  if (isLanguageEmpty(input)) warn(EMPTY_LANGUAGE_WARNING(input.start));

  const done = (refused: string | null = null, aborted = false): TransformResult =>
    ({ kind, input, steps: log.steps, result: log.current, warnings, refused, aborted });

  if (kind === 'factoring' && hasLeftRecursion(input)) {
    const lr = leftRecursion(input);
    const msg = `A gramática tem recursão à esquerda (${[...lr.direct, ...lr.indirect].join(', ')}). `
      + 'Remova-a antes de fatorar: com ela, a fatoração indireta não termina.';
    warn(msg);
    return done(msg);
  }

  let aborted = false;
  try {
    switch (kind) {
      case 'simplify': simplify(input, log); break;
      case 'useless': removeUseless(input, log); break;
      case 'epsilon': removeEpsilon(input, log, 'always'); break;
      case 'unit': removeUnits(input, log); break;
      case 'left-recursion': {
        const out = removeLeftRecursion(input, log, opts.epsFreeRecursion);
        if (hasLeftRecursion(out)) {
          warn('Ainda há recursão à esquerda escondida atrás de variável anulável (A → BAα com B ⇒* ε). '
            + 'Aplique ε-livre antes e repita a remoção.');
        }
        break;
      }
      case 'factoring': factor(input, log, opts.maxIterations, opts.factoringMode, warn); break;
      case 'cnf': toCnf(input, log, opts); break;
      case 'gnf': toGnf(input, log, opts, warn); break;
    }
  } catch (e) {
    if (!(e instanceof GlcLimitError)) throw e;
    warn(e.message);
    if (kind === 'factoring' && opts.factoringMode === 'completa') warn(NO_COMPLETE_FACTORING);
    aborted = true;
  }
  if (opts.classResult) markClassResult(kind, log.steps, opts.classResult, input);
  for (let i = 0; i < log.steps.length; i++) log.steps[i] = { ...log.steps[i], grammar: displayOrder(log.steps[i].grammar, input.vars) };
  return { ...done(null, aborted), result: displayOrder(log.current, input.vars) };
}

/**
 * Fatoração com a resolução que a aba mostra. Sem recursão à esquerda, é a própria
 * fatoração. Com recursão (que a fatoração recusa), a resolução tem duas etapas:
 * 1) retirar a recursão à esquerda; 2) fatorar a gramática resultante, na opção
 * escolhida. Os algoritmos não mudam: é só a composição das duas transformações.
 */
export function resolveFactoring(input: Cfg, options: Partial<TransformOptions> = {}): TransformResult {
  const direct = runTransform('factoring', input, options);
  if (!direct.refused) return direct;
  const recursion = runTransform('left-recursion', input, { ...options, classResult: null });
  const factoring = runTransform('factoring', recursion.result, options);
  if (factoring.refused) return direct; // recursão escondida que a etapa 1 não remove: fica a recusa
  const warnings: string[] = [];
  for (const w of [...direct.warnings, ...recursion.warnings, ...factoring.warnings]) if (!warnings.includes(w)) warnings.push(w);
  const order = (g: Cfg) => displayOrder(g, input.vars);
  return {
    kind: 'factoring',
    input,
    steps: [
      ...recursion.steps.map((s) => ({ ...s, grammar: order(s.grammar), stage: STAGE_RECURSION })),
      ...factoring.steps.map((s) => ({ ...s, grammar: order(s.grammar), stage: STAGE_FACTORING })),
    ],
    result: order(factoring.result),
    warnings,
    refused: null,
    aborted: factoring.aborted,
  };
}
