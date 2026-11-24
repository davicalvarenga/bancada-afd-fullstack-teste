/**
 * Transformações de GLC: modelo, parser e utilitários. Lógica pura, sem Angular.
 *
 * Diferente do motor das Derivações (domain/grammar.ts), aqui vale a regra de
 * tokenização da disciplina:
 *   - variável = letra maiúscula (A–Z) com sufixos opcionais: S, S', A'', A1, Xa, Y1.
 *     Dígitos e apóstrofos sempre fazem parte do nome; um sufixo minúsculo (Xa)
 *     só vale se a variável tiver regras (aparecer do lado esquerdo);
 *   - terminal = qualquer outro caractere (a, +, (, [, ;, =, ¬, ∨…), um por vez;
 *   - vazio = ε, eps ou &.
 * Formato: `S -> aSb | ab | ε` (também →), uma variável por linha; a primeira
 * linha define o símbolo de partida. Linhas repetidas para a mesma variável
 * somam alternativas.
 *
 * Cada produção guarda o lado direito como LISTA de símbolos ([] = ε). As
 * transformações nunca alteram a gramática recebida: cada passo cria uma `Cfg` nova.
 */

export const EPS = 'ε';

export interface Prod { lhs: string; rhs: string[] }

export interface Cfg {
  start: string;
  /** Variáveis na ordem de exibição (a de partida primeiro, as criadas junto da origem). */
  vars: string[];
  prods: Prod[];
}

export const LIMITS = {
  chars: 4000,      // texto digitado
  rules: 200,       // alternativas digitadas
  rhs: 40,          // símbolos por alternativa digitada
  prods: 4000,      // produções em qualquer passo intermediário
  rhsWork: 300,     // símbolos por alternativa em passo intermediário
};

/** Uma transformação passou do teto de tamanho/iterações: o resultado é parcial. */
export class GlcLimitError extends Error {}

// ─────────────────────────── utilitários ───────────────────────────

const varCache = new WeakMap<Cfg, Set<string>>();
export function varSet(g: Cfg): Set<string> {
  let s = varCache.get(g);
  if (!s) { s = new Set(g.vars); varCache.set(g, s); }
  return s;
}

export const rhsKey = (rhs: readonly string[]): string => rhs.join('\u0001');
export const prodKey = (p: Prod): string => p.lhs + '\u0000' + rhsKey(p.rhs);

export function altsOf(g: Cfg, v: string): string[][] {
  return g.prods.filter((p) => p.lhs === v).map((p) => p.rhs);
}

/** Terminais na ordem em que aparecem. */
export function terminalsOf(g: Cfg): string[] {
  const vs = varSet(g);
  const out = new Set<string>();
  for (const p of g.prods) for (const s of p.rhs) if (!vs.has(s)) out.add(s);
  return [...out];
}

/** Monta uma gramática sem produções repetidas, garantindo que toda variável usada esteja em `vars`. */
export function makeCfg(start: string, vars: readonly string[], prods: readonly Prod[]): Cfg {
  if (prods.length > LIMITS.prods) {
    throw new GlcLimitError(`A gramática passou de ${LIMITS.prods} produções; a transformação foi interrompida.`);
  }
  const seen = new Set<string>();
  const out: Prod[] = [];
  for (const p of prods) {
    if (p.rhs.length > LIMITS.rhsWork) {
      throw new GlcLimitError(`Um lado direito passou de ${LIMITS.rhsWork} símbolos; a transformação foi interrompida.`);
    }
    const k = prodKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ lhs: p.lhs, rhs: [...p.rhs] });
  }
  const vs = [...new Set([start, ...vars])];
  const known = new Set(vs);
  for (const p of out) if (!known.has(p.lhs)) { vs.push(p.lhs); known.add(p.lhs); }
  return { start, vars: vs, prods: out };
}

/** Troca as alternativas de `v`, mantendo a posição dela entre as produções. */
export function setAlts(g: Cfg, v: string, alts: readonly string[][]): Cfg {
  const prods: Prod[] = [];
  let placed = false;
  for (const p of g.prods) {
    if (p.lhs !== v) { prods.push(p); continue; }
    if (!placed) { prods.push(...alts.map((rhs) => ({ lhs: v, rhs }))); placed = true; }
  }
  if (!placed) prods.push(...alts.map((rhs) => ({ lhs: v, rhs })));
  return makeCfg(g.start, g.vars, prods);
}

/** Acrescenta a variável `name` logo depois de `after` (e das variantes A', A'' que já estão lá). */
export function addVar(g: Cfg, name: string, alts: readonly string[][], after?: string): Cfg {
  const vars = [...g.vars];
  let at = after !== undefined ? vars.indexOf(after) : -1;
  if (at < 0) vars.push(name);
  else {
    at++;
    // pula as irmãs já criadas (A', A'', A3…), para a nova ficar no fim da família
    while (at < vars.length && vars[at].startsWith(after!) && /^('+|\d+)$/.test(vars[at].slice(after!.length))) at++;
    vars.splice(at, 0, name);
  }
  return makeCfg(g.start, vars, [...g.prods, ...alts.map((rhs) => ({ lhs: name, rhs }))]);
}

/**
 * Raiz da "família" de um nome: A'' → A; A3 → A quando A existe (A3 foi criada a partir de A).
 * Nomes do usuário como A1 e A2 continuam sendo raiz de si mesmos.
 */
export function familyRoot(name: string, used: ReadonlySet<string>): string {
  const noPrimes = name.replace(/'+$/, '');
  const m = /^([A-Z][a-z]*)(\d+)$/.exec(noPrimes);
  return m && Number(m[2]) >= 3 && used.has(m[1]) ? m[1] : noPrimes;
}

/**
 * Nova variável da família de `base`: A', A'' e, a partir da terceira, A3, A4…
 * (sem colidir com nomes existentes). Se a raiz termina em dígito (A1), segue com
 * apóstrofos (A1', A1'', A1'''), para não confundir A1 + 3 com A13.
 */
export function freshPrime(base: string, used: ReadonlySet<string>): string {
  const root = familyRoot(base, used);
  for (const c of [root + "'", root + "''"]) if (!used.has(c)) return c;
  if (/\d$/.test(root)) {
    let n = root + "'''";
    while (used.has(n)) n += "'";
    return n;
  }
  let i = 3;
  while (used.has(root + i)) i++;
  return root + i;
}

/** Prefixo + número (Y1, Y2…) sem colidir com nomes existentes. */
export function freshIndexed(prefix: string, used: ReadonlySet<string>): string {
  let i = 1;
  while (used.has(prefix + i)) i++;
  return prefix + i;
}

/** Variável para um terminal: Xa para letras e dígitos; X1, X2… para os demais (+, ), [ …). */
export function terminalVarName(t: string, used: ReadonlySet<string>): string {
  if (/^[a-z0-9]$/.test(t) && !used.has('X' + t)) return 'X' + t;
  return freshIndexed('X', used);
}

// ─────────────────────────── exibição ───────────────────────────

export const showRhs = (rhs: readonly string[]): string => (rhs.length ? rhs.join('') : EPS);
export const showProd = (p: Prod): string => `${p.lhs} → ${showRhs(p.rhs)}`;

export interface CfgLine { lhs: string; alts: string[][] }

/** Uma linha por variável com regras, na ordem de `vars`. A de partida aparece sempre. */
export function cfgLines(g: Cfg): CfgLine[] {
  return g.vars
    .map((v) => ({ lhs: v, alts: altsOf(g, v) }))
    .filter((l) => l.alts.length || l.lhs === g.start);
}

/** Texto no mesmo formato da entrada (pode ser colado de volta). */
export function showCfg(g: Cfg): string {
  return cfgLines(g)
    .filter((l) => l.alts.length)
    .map((l) => `${l.lhs} → ${l.alts.map(showRhs).join(' | ')}`)
    .join('\n');
}

// ─────────────────────────── passos ───────────────────────────

export interface AuxSet { label: string; items: string[] }

export interface CfgDiff {
  added: Prod[];
  removed: Prod[];
  newVars: string[];
  removedVars: string[];
}

export interface Step {
  title: string;
  explanation: string;
  /** Conjuntos auxiliares (anuláveis, fecho, FIRST…), já como texto. */
  sets: AuxSet[];
  /** Gramática depois deste passo. */
  grammar: Cfg;
  /** O que mudou em relação ao passo anterior. */
  diff: CfgDiff;
  warnings: string[];
  /** Destaque do passo (ex.: coincide com o resultado visto em aula). */
  highlight?: string;
}

export function diffCfg(before: Cfg, after: Cfg): CfgDiff {
  const kb = new Set(before.prods.map(prodKey));
  const ka = new Set(after.prods.map(prodKey));
  const vb = new Set(before.vars);
  const va = new Set(after.vars);
  return {
    added: after.prods.filter((p) => !kb.has(prodKey(p))),
    removed: before.prods.filter((p) => !ka.has(prodKey(p))),
    newVars: after.vars.filter((v) => !vb.has(v)),
    removedVars: before.vars.filter((v) => !va.has(v)),
  };
}

/** Acumula os passos de uma transformação, calculando o diff de cada um. */
export class StepLog {
  readonly steps: Step[] = [];
  private last: Cfg;

  constructor(initial: Cfg) { this.last = initial; }

  get current(): Cfg { return this.last; }

  push(title: string, explanation: string, grammar: Cfg, sets: AuxSet[] = [], warnings: string[] = []): Cfg {
    this.steps.push({ title, explanation, sets, grammar, diff: diffCfg(this.last, grammar), warnings });
    this.last = grammar;
    return grammar;
  }
}

// ─────────────────────────── parser ───────────────────────────

export interface ParseProblem { line: number; message: string }
export interface ParseResult {
  grammar: Cfg | null;
  problems: ParseProblem[];
  /** Observações que não impedem a transformação (variável sem regras…). */
  notes: string[];
}

const ARROW = /->|→/g;
const LHS_RE = /^[A-Z][a-z0-9]*'*$/;
const EPS_ALT = new Set([EPS, 'eps', '&']);
const isUpper = (ch: string) => ch >= 'A' && ch <= 'Z';

/** Quebra uma alternativa em símbolos. `declared` vem ordenado do maior nome para o menor. */
function tokenizeAlt(alt: string, declared: readonly string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < alt.length) {
    const ch = String.fromCodePoint(alt.codePointAt(i)!);
    if (/\s/.test(ch) || ch === EPS || ch === '&') { i += ch.length; continue; }
    if (isUpper(ch)) {
      // forma mínima: maiúscula + dígitos + apóstrofos; um nome declarado mais longo (Xa) tem prioridade
      let j = i + 1;
      while (j < alt.length && /[0-9]/.test(alt[j])) j++;
      while (j < alt.length && alt[j] === "'") j++;
      const basic = alt.slice(i, j);
      const decl = declared.find((n) => alt.startsWith(n, i));
      const name = decl && decl.length > basic.length ? decl : basic;
      out.push(name);
      i += name.length;
      continue;
    }
    out.push(ch);
    i += ch.length;
  }
  return out;
}

export function parseCfg(src: string): ParseResult {
  const problems: ParseProblem[] = [];
  const notes: string[] = [];
  if (src.length > LIMITS.chars) {
    return { grammar: null, problems: [{ line: 0, message: `Gramática grande demais (máx. ${LIMITS.chars} caracteres).` }], notes };
  }

  const raw: { line: number; lhs: string; rhs: string }[] = [];
  src.replace(/[’′]/g, "'").split(/\r?\n/).forEach((text, k) => {
    const line = k + 1;
    const t = text.trim();
    if (!t || t.startsWith('#') || t.startsWith('//')) return;
    const arrows = t.match(ARROW)?.length ?? 0;
    if (arrows === 0) { problems.push({ line, message: 'Falta a seta (-> ou →) entre a variável e as alternativas.' }); return; }
    if (arrows > 1) { problems.push({ line, message: 'Mais de uma seta na mesma linha: escreva uma variável por linha.' }); return; }
    const at = t.search(/->|→/);
    const lhs = t.slice(0, at).trim();
    const rhs = t.slice(at + (t.startsWith('->', at) ? 2 : 1));
    if (!lhs) { problems.push({ line, message: 'Falta a variável antes da seta.' }); return; }
    if (!LHS_RE.test(lhs)) {
      problems.push({ line, message: `Lado esquerdo “${lhs}” não é uma variável: use letra maiúscula com sufixo opcional (S, A', A1, Xa).` });
      return;
    }
    if (!rhs.trim()) { problems.push({ line, message: 'Falta o lado direito: para o vazio, escreva ε, eps ou &.' }); return; }
    raw.push({ line, lhs, rhs });
  });
  if (!raw.length && !problems.length) {
    problems.push({ line: 0, message: 'Gramática vazia: escreva ao menos uma regra, como S -> aSb | ab.' });
  }
  if (problems.length) return { grammar: null, problems, notes };

  const declared = [...new Set(raw.map((r) => r.lhs))];
  const bySize = [...declared].sort((a, b) => b.length - a.length);
  const prods: Prod[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    for (const alt of r.rhs.split('|')) {
      const a = alt.trim();
      if (!a) { problems.push({ line: r.line, message: 'Alternativa vazia entre barras: para o vazio, escreva ε, eps ou &.' }); continue; }
      const rhs = EPS_ALT.has(a) ? [] : tokenizeAlt(a, bySize);
      if (rhs.length > LIMITS.rhs) { problems.push({ line: r.line, message: `Alternativa longa demais (máx. ${LIMITS.rhs} símbolos).` }); continue; }
      const p = { lhs: r.lhs, rhs };
      if (seen.has(prodKey(p))) continue; // repetida não muda a linguagem
      if (prods.length >= LIMITS.rules) { problems.push({ line: r.line, message: `Alternativas demais (máx. ${LIMITS.rules}).` }); break; }
      seen.add(prodKey(p));
      prods.push(p);
    }
  }
  if (problems.length) return { grammar: null, problems, notes };

  const vars = [...declared];
  for (const p of prods) {
    for (const s of p.rhs) {
      if (isUpper(s[0]) && !vars.includes(s)) {
        vars.push(s);
        notes.push(`A variável ${s} aparece à direita mas não tem regras: é estéril.`);
      }
    }
  }
  return { grammar: makeCfg(raw[0].lhs, vars, prods), problems, notes };
}
