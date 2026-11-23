/**
 * Verificadores automáticos: forma (CNF, GNF, ε-livre, recursão à esquerda,
 * prefixo comum), linguagem vazia e equivalência até um comprimento n.
 */
import { Cfg, Prod, showProd, showRhs, terminalsOf, varSet } from './cfg';
import { isLanguageEmpty, leadingEdges, leftRecursion, nullableInfo, prefixConflicts, reachFrom } from './analysis';

export interface FormCheck {
  ok: boolean;
  /** Alternativas que violam a forma, já como texto ("A → aB: …"). */
  violations: string[];
}

const check = (violations: string[]): FormCheck => ({ ok: violations.length === 0, violations });
const startOnRhs = (g: Cfg) => g.prods.some((p) => p.rhs.includes(g.start));

/** A → BC (B, C variáveis diferentes da partida), A → a, ou S → ε só na partida. */
export function checkCnf(g: Cfg): FormCheck {
  const vs = varSet(g);
  const out: string[] = [];
  for (const p of g.prods) {
    const r = p.rhs;
    if (r.length === 0) { if (p.lhs !== g.start) out.push(`${showProd(p)}: ε só é permitido no símbolo de partida`); continue; }
    if (r.length === 1) { if (vs.has(r[0])) out.push(`${showProd(p)}: produção simples`); continue; }
    if (r.length > 2) { out.push(`${showProd(p)}: mais de dois símbolos`); continue; }
    if (!vs.has(r[0]) || !vs.has(r[1])) { out.push(`${showProd(p)}: terminal acompanhado`); continue; }
    if (r.includes(g.start)) out.push(`${showProd(p)}: usa o símbolo de partida à direita`);
  }
  return check(out);
}

/** A → aα (α só variáveis), ou S → ε só na partida (que não aparece à direita). */
export function checkGnf(g: Cfg): FormCheck {
  const vs = varSet(g);
  const out: string[] = [];
  for (const p of g.prods) {
    const r = p.rhs;
    if (r.length === 0) {
      if (p.lhs !== g.start) out.push(`${showProd(p)}: ε só é permitido no símbolo de partida`);
      else if (startOnRhs(g)) out.push(`${showProd(p)}: ${g.start} → ε com ${g.start} aparecendo à direita`);
      continue;
    }
    if (vs.has(r[0])) { out.push(`${showProd(p)}: começa com variável`); continue; }
    if (r.slice(1).some((s) => !vs.has(s))) out.push(`${showProd(p)}: terminal fora da 1ª posição`);
  }
  return check(out);
}

/** Sem A → ε, exceto S → ε com S fora dos lados direitos. */
export function checkEpsFree(g: Cfg): FormCheck {
  const out: string[] = [];
  for (const p of g.prods) {
    if (p.rhs.length) continue;
    if (p.lhs !== g.start) out.push(`${showProd(p)}: produção vazia`);
    else if (startOnRhs(g)) out.push(`${showProd(p)}: ${g.start} → ε com ${g.start} aparecendo à direita`);
  }
  return check(out);
}

/** Alternativas que iniciam uma recursão à esquerda (direta ou indireta, inclusive atrás de anulável). */
export function checkLeftRecursion(g: Cfg): FormCheck {
  const lr = leftRecursion(g);
  const rec = new Set([...lr.direct, ...lr.indirect]);
  const vs = varSet(g);
  const nul = nullableInfo(g).all;
  const edges = leadingEdges(g, true);
  const out: string[] = [];
  for (const p of g.prods) {
    if (!rec.has(p.lhs)) continue;
    for (const s of p.rhs) {
      if (!vs.has(s)) break;
      if (s === p.lhs) { out.push(`${showProd(p)}: recursão direta`); break; }
      if (reachFrom(edges, s).has(p.lhs)) { out.push(`${showProd(p)}: recursão indireta (${s} ⇒+ ${p.lhs}…)`); break; }
      if (!nul.has(s)) break;
    }
  }
  return check(out);
}

/** Duas alternativas da mesma variável com o mesmo início (visível ou via FIRST). */
export function checkCommonPrefix(g: Cfg): FormCheck {
  return check(prefixConflicts(g).map((c) => (c.kind === 'direta'
    ? `${c.lhs} → ${showRhs(c.a)} e ${c.lhs} → ${showRhs(c.b)}: mesmo primeiro símbolo ${c.common[0]}`
    : `${c.lhs} → ${showRhs(c.a)} e ${c.lhs} → ${showRhs(c.b)}: ambas podem começar com {${c.common.join(', ')}}`)));
}

export interface FormReport {
  cnf: FormCheck;
  gnf: FormCheck;
  epsFree: FormCheck;
  leftRecursion: FormCheck;
  commonPrefix: FormCheck;
  emptyLanguage: boolean;
}

export function checkForms(g: Cfg): FormReport {
  return {
    cnf: checkCnf(g),
    gnf: checkGnf(g),
    epsFree: checkEpsFree(g),
    leftRecursion: checkLeftRecursion(g),
    commonPrefix: checkCommonPrefix(g),
    emptyLanguage: isLanguageEmpty(g),
  };
}

// ─────────────────────────── linguagem até n ───────────────────────────

export const DEFAULT_MAX_LEN = 7;
const WORD_CAP = 200_000;

export interface LanguageSample {
  /** Palavras de comprimento ≤ n, ordenadas por tamanho e depois em ordem alfabética ('' = ε). */
  words: string[];
  /** false quando o teto de palavras foi atingido (amostra incompleta). */
  complete: boolean;
}

/**
 * Todas as palavras de comprimento ≤ n, por iteração de ponto fixo sobre os
 * conjuntos de palavras de cada variável. Cada terminal é codificado num
 * caractere privado, então o comprimento da palavra é o tamanho da string.
 */
export function languageUpTo(g: Cfg, n: number): LanguageSample {
  const vs = varSet(g);
  const terms = terminalsOf(g);
  const enc = new Map(terms.map((t, i) => [t, String.fromCharCode(0xe000 + i)]));
  const dec = new Map(terms.map((t, i) => [String.fromCharCode(0xe000 + i), t]));

  // menor comprimento derivável por variável, para podar cedo
  const minLen = new Map(g.vars.map((v) => [v, Infinity]));
  const symMin = (s: string) => (vs.has(s) ? minLen.get(s)! : 1);
  for (let changed = true; changed;) {
    changed = false;
    for (const p of g.prods) {
      const m = p.rhs.reduce((acc, s) => acc + symMin(s), 0);
      if (m < minLen.get(p.lhs)!) { minLen.set(p.lhs, m); changed = true; }
    }
  }

  // palavras por variável, separadas por comprimento
  const lang = new Map(g.vars.map((v) => [v, Array.from({ length: n + 1 }, () => new Set<string>())]));
  let total = 0;
  let complete = true;
  const prods = g.prods.filter((p: Prod) => p.rhs.reduce((acc, s) => acc + symMin(s), 0) <= n);

  outer:
  for (let changed = true; changed;) {
    changed = false;
    for (const p of prods) {
      const suffix = new Array<number>(p.rhs.length + 1).fill(0);
      for (let i = p.rhs.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + symMin(p.rhs[i]);
      let partial = new Set(['']);
      for (let i = 0; i < p.rhs.length && partial.size; i++) {
        const s = p.rhs[i];
        const next = new Set<string>();
        for (const w of partial) {
          if (!vs.has(s)) {
            if (w.length + 1 + suffix[i + 1] <= n) next.add(w + enc.get(s)!);
            continue;
          }
          const buckets = lang.get(s)!;
          for (let len = 0; w.length + len + suffix[i + 1] <= n; len++) for (const x of buckets[len]) next.add(w + x);
        }
        partial = next;
      }
      const target = lang.get(p.lhs)!;
      for (const w of partial) {
        if (target[w.length].has(w)) continue;
        target[w.length].add(w);
        changed = true;
        if (++total > WORD_CAP) { complete = false; break outer; }
      }
    }
  }

  const words = [...(lang.get(g.start) ?? [])].flatMap((b) => [...b].map((w) => [...w].map((c) => dec.get(c)!).join('')));
  words.sort((a, b) => [...a].length - [...b].length || (a < b ? -1 : a > b ? 1 : 0));
  return { words, complete };
}

export interface EquivalenceReport {
  /** Mesmas palavras até n. */
  equivalent: boolean;
  /** Só a gramática A gera (até n). */
  onlyA: string[];
  /** Só a gramática B gera (até n). */
  onlyB: string[];
  complete: boolean;
  /** Quantas palavras A gera até n. */
  countA: number;
  maxLen: number;
}

export function compareUpTo(a: Cfg, b: Cfg, n: number = DEFAULT_MAX_LEN): EquivalenceReport {
  const la = languageUpTo(a, n);
  const lb = languageUpTo(b, n);
  const sa = new Set(la.words);
  const sb = new Set(lb.words);
  const onlyA = la.words.filter((w) => !sb.has(w));
  const onlyB = lb.words.filter((w) => !sa.has(w));
  return {
    equivalent: !onlyA.length && !onlyB.length,
    onlyA, onlyB,
    complete: la.complete && lb.complete,
    countA: la.words.length,
    maxLen: n,
  };
}
