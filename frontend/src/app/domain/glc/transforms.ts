/**
 * Ponto de entrada das transformações: escolhe o algoritmo, acumula os passos,
 * transforma estouro de limite em aviso (resultado parcial) e avisa quando a
 * linguagem é vazia. É o único arquivo que a tela precisa chamar.
 */
import { Cfg, GlcLimitError, Step, StepLog, altsOf, rhsKey } from './cfg';
import { hasLeftRecursion, isLanguageEmpty, leftRecursion } from './analysis';
import { EMPTY_LANGUAGE_WARNING, removeEpsilon, removeUnits, removeUseless, simplify } from './simplify';
import { removeLeftRecursion } from './left-recursion';
import { DEFAULT_MAX_ITERATIONS, factor } from './factoring';
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
   * Fatoração: gramática (possivelmente parcial) obtida em aula. O primeiro passo em
   * que cada variável dela tem exatamente as mesmas alternativas recebe um destaque.
   */
  classResult: Cfg | null;
}

export const DEFAULT_OPTIONS: TransformOptions = {
  epsFreeRecursion: false,
  removeUseless: false,
  maxIterations: DEFAULT_MAX_ITERATIONS,
  classResult: null,
};

export const CLASS_MATCH_INTERMEDIATE =
  'Resultado da fatoração em aula; os passos seguintes continuam fatorando as variáveis novas.';
export const CLASS_MATCH_FINAL = 'Coincide com o resultado da fatoração em aula.';

/** As variáveis de `ref` têm, em `g`, exatamente as mesmas alternativas (as demais variáveis não importam). */
export function matchesPartial(g: Cfg, ref: Cfg): boolean {
  const set = (x: Cfg, v: string) => altsOf(x, v).map(rhsKey).sort().join('\u0002');
  const vars = ref.vars.filter((v) => altsOf(ref, v).length);
  return vars.length > 0 && vars.every((v) => set(g, v) === set(ref, v));
}

/** Marca o primeiro passo que coincide com o resultado de aula (texto do passo + destaque). */
function markClassResult(steps: Step[], ref: Cfg): void {
  const i = steps.findIndex((s) => matchesPartial(s.grammar, ref));
  if (i < 0) return;
  const note = i < steps.length - 1 ? CLASS_MATCH_INTERMEDIATE : CLASS_MATCH_FINAL;
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
      case 'factoring': factor(input, log, opts.maxIterations); break;
      case 'cnf': toCnf(input, log, opts); break;
      case 'gnf': toGnf(input, log, opts, warn); break;
    }
  } catch (e) {
    if (!(e instanceof GlcLimitError)) throw e;
    warn(e.message);
    aborted = true;
  }
  if (kind === 'factoring' && opts.classResult) markClassResult(log.steps, opts.classResult);
  return done(null, aborted);
}
