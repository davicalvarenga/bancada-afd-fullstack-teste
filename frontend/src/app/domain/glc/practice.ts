/**
 * Modo treino: confere a resposta do aluno para uma transformação. Lógica pura.
 *
 * A resposta é a gramática transformada INTEIRA, no mesmo formato da entrada (a
 * 1ª linha é o símbolo de partida). Três conferências, nesta ordem:
 *  1. formato: o parser aceita a resposta;
 *  2. forma: a resposta atende ao que a transformação exige (mensagem por
 *     alternativa; na fatoração, prefixo só visível após substituir a variável
 *     inicial é AVISO, não erro);
 *  3. linguagem: equivalência com a gramática ORIGINAL até n. Nunca se diz
 *     "correta": equivalência até n não é prova. Na GNF, ε é ignorado quando a
 *     original gera ε. Com linguagem original vazia, a verificação não detecta
 *     erros e o resultado fica "forma válida, linguagem não verificável".
 * Por fim, compara com o gabarito de aula e com a resolução da bancada (aceitando
 * renomear as variáveis criadas).
 */
import { Cfg, ParseProblem, altsOf, parseCfg, showProd, showRhs, varSet } from './cfg';
import { isLanguageEmpty, nullableInfo, prefixConflicts, productiveRounds } from './analysis';
import { DEFAULT_MAX_LEN, checkCnf, checkEpsFree, checkGnf, checkLeftRecursion, compareUpTo } from './checks';
import { TransformKind, matchesPartial } from './transforms';

export type Severity = 'erro' | 'aviso';
export interface PracticeIssue { severity: Severity; message: string }

export type LanguageStatus = 'equivalente' | 'diverge' | 'nao-verificavel' | 'incompleto';
export type Comparison = 'gabarito' | 'bancada' | 'diferente';
/** pleno = forma válida + equivalente até n; parcial = forma válida, linguagem não verificável. */
export type Verdict = 'pleno' | 'parcial' | 'pendente';

export interface PracticeReport {
  parseProblems: ParseProblem[];
  /** Observações do parser (variável sem regras…). */
  notes: string[];
  issues: PracticeIssue[];
  formOk: boolean;
  language: {
    status: LanguageStatus;
    maxLen: number;
    onlyOriginal: string[];
    onlyAnswer: string[];
    count: number;
    notes: string[];
  } | null;
  comparison: Comparison | null;
  verdict: Verdict;
}

export const EMPTY_LANGUAGE_PRACTICE =
  'A linguagem é vazia: a verificação de linguagem não detecta erros neste exercício. Compare sua resposta com a resolução.';
export const GNF_EPS_NOTE =
  'A gramática original gera ε, que não tem forma GNF: ε é ignorado na comparação.';

const erro = (message: string): PracticeIssue => ({ severity: 'erro', message });
const aviso = (message: string): PracticeIssue => ({ severity: 'aviso', message });

function uselessIssues(g: Cfg): PracticeIssue[] {
  const out: PracticeIssue[] = [];
  const vs = varSet(g);
  const productive = productiveRounds(g).productive;
  const sterile = g.vars.filter((v) => !productive.has(v));
  for (const v of sterile) out.push(erro(`${v} é estéril: nenhuma alternativa chega só a terminais.`));
  for (const p of g.prods) {
    const bad = p.rhs.filter((s) => vs.has(s) && !productive.has(s));
    if (bad.length && productive.has(p.lhs)) out.push(erro(`${showProd(p)}: usa ${[...new Set(bad)].join(', ')}, estéril.`));
  }
  const seen = new Set([g.start]);
  const queue = [g.start];
  while (queue.length) {
    for (const rhs of altsOf(g, queue.shift()!)) for (const s of rhs) if (vs.has(s) && !seen.has(s)) { seen.add(s); queue.push(s); }
  }
  for (const v of g.vars) if (!seen.has(v) && altsOf(g, v).length) out.push(erro(`${v} é inalcançável a partir de ${g.start}.`));
  return out;
}

function unitIssues(g: Cfg): PracticeIssue[] {
  const vs = varSet(g);
  return g.prods.filter((p) => p.rhs.length === 1 && vs.has(p.rhs[0])).map((p) => erro(`${showProd(p)}: produção simples (A → B).`));
}

function factoringIssues(g: Cfg): PracticeIssue[] {
  return prefixConflicts(g).map((c) => (c.kind === 'direta'
    ? erro(`${c.lhs} → ${showRhs(c.a)} e ${c.lhs} → ${showRhs(c.b)}: prefixo comum visível (${c.common[0]}…).`)
    : aviso(`${c.lhs} → ${showRhs(c.a)} e ${c.lhs} → ${showRhs(c.b)}: só depois de substituir a variável inicial `
      + `ambas podem começar com {${c.common.join(', ')}} (fatoração indireta; não reprova).`)));
}

/** Exigências de forma de cada transformação, com mensagem por alternativa. */
export function formIssues(kind: TransformKind, g: Cfg): PracticeIssue[] {
  const fromCheck = (v: string[]) => v.map(erro);
  switch (kind) {
    case 'useless': return uselessIssues(g);
    case 'epsilon': return fromCheck(checkEpsFree(g).violations);
    case 'unit': return unitIssues(g);
    case 'simplify': return [...fromCheck(checkEpsFree(g).violations), ...unitIssues(g), ...uselessIssues(g)];
    case 'left-recursion': return fromCheck(checkLeftRecursion(g).violations);
    case 'factoring': return factoringIssues(g);
    case 'cnf': return fromCheck(checkCnf(g).violations);
    case 'gnf': return fromCheck(checkGnf(g).violations);
  }
}

export interface PracticeOptions {
  /** Comprimento máximo da comparação de linguagens. */
  n?: number;
  /** Resultado da bancada para a mesma transformação. */
  bancada?: Cfg | null;
  /** Gabarito de aula (pode ser parcial). */
  gabarito?: Cfg | null;
}

export function checkAnswer(kind: TransformKind, original: Cfg, answerText: string, opts: PracticeOptions = {}): PracticeReport {
  const n = opts.n ?? DEFAULT_MAX_LEN;
  const parsed = parseCfg(answerText);
  const base: PracticeReport = {
    parseProblems: parsed.problems, notes: parsed.notes, issues: [], formOk: false,
    language: null, comparison: null, verdict: 'pendente',
  };
  const answer = parsed.grammar;
  if (!answer) return base;

  const issues = formIssues(kind, answer);
  const formOk = !issues.some((i) => i.severity === 'erro');

  // linguagem
  const notes: string[] = [];
  let language: PracticeReport['language'];
  if (isLanguageEmpty(original)) {
    language = { status: 'nao-verificavel', maxLen: n, onlyOriginal: [], onlyAnswer: [], count: 0, notes: [EMPTY_LANGUAGE_PRACTICE] };
  } else {
    const eq = compareUpTo(original, answer, n);
    // na GNF, ε não tem forma A → aα: se a original gera ε, ele sai da comparação
    const ignoreEps = kind === 'gnf' && nullableInfo(original).all.has(original.start);
    if (ignoreEps) notes.push(GNF_EPS_NOTE);
    const onlyOriginal = ignoreEps ? eq.onlyA.filter((w) => w !== '') : eq.onlyA;
    const onlyAnswer = ignoreEps ? eq.onlyB.filter((w) => w !== '') : eq.onlyB;
    const status: LanguageStatus = !eq.complete ? 'incompleto' : onlyOriginal.length || onlyAnswer.length ? 'diverge' : 'equivalente';
    language = { status, maxLen: n, onlyOriginal, onlyAnswer, count: eq.countA, notes };
  }

  // comparação com as resoluções (só faz sentido quando a resposta não diverge)
  let comparison: Comparison | null = null;
  if (formOk && (language.status === 'equivalente' || language.status === 'nao-verificavel')) {
    if (opts.gabarito && matchesPartial(answer, opts.gabarito, original)) comparison = 'gabarito';
    else if (opts.bancada && matchesPartial(answer, opts.bancada, original, true)) comparison = 'bancada';
    else comparison = 'diferente';
  }

  const verdict: Verdict = !formOk ? 'pendente'
    : language.status === 'equivalente' ? 'pleno'
      : language.status === 'nao-verificavel' ? 'parcial' : 'pendente';
  return { ...base, issues, formOk, language, comparison, verdict };
}

