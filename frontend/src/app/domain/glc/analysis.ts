/**
 * Análises de GLC que não alteram a gramática: férteis, anuláveis, grafo do
 * "primeiro símbolo", recursão à esquerda, FIRST e conflitos de prefixo.
 * Usadas pelas transformações e pelos verificadores de forma.
 */
import { Cfg, varSet } from './cfg';

/** Marcação de variáveis férteis (não estéreis), passada a passada, como no método da disciplina. */
export function productiveRounds(g: Cfg): { rounds: string[][]; productive: Set<string> } {
  const vs = varSet(g);
  const marked = new Set<string>();
  const rounds: string[][] = [];
  for (;;) {
    // cada passada só enxerga o que foi marcado nas passadas anteriores
    const fresh = g.vars.filter((v) => !marked.has(v)
      && g.prods.some((p) => p.lhs === v && p.rhs.every((s) => !vs.has(s) || marked.has(s))));
    if (!fresh.length) break;
    fresh.forEach((v) => marked.add(v));
    rounds.push(fresh);
  }
  return { rounds, productive: marked };
}

/** L(G) = ∅ exatamente quando o símbolo de partida é estéril. */
export const isLanguageEmpty = (g: Cfg): boolean => !productiveRounds(g).productive.has(g.start);

/** Anuláveis: diretos (A → ε) e indiretos (alternativa só com anuláveis), na ordem em que são descobertos. */
export function nullableInfo(g: Cfg): { direct: string[]; indirect: string[]; all: Set<string> } {
  const direct = g.vars.filter((v) => g.prods.some((p) => p.lhs === v && p.rhs.length === 0));
  const all = new Set(direct);
  const indirect: string[] = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const v of g.vars) {
      if (all.has(v)) continue;
      if (g.prods.some((p) => p.lhs === v && p.rhs.length > 0 && p.rhs.every((s) => all.has(s)))) {
        all.add(v);
        indirect.push(v);
        changed = true;
      }
    }
  }
  return { direct, indirect, all };
}

/**
 * Arestas A → B quando alguma alternativa de A pode começar com B. Com
 * `throughNullable`, olha também depois de prefixos anuláveis (A → CBx, C ⇒* ε).
 */
export function leadingEdges(g: Cfg, throughNullable: boolean): Map<string, Set<string>> {
  const vs = varSet(g);
  const nul = throughNullable ? nullableInfo(g).all : new Set<string>();
  const edges = new Map(g.vars.map((v) => [v, new Set<string>()]));
  for (const p of g.prods) {
    for (const s of p.rhs) {
      if (!vs.has(s)) break;
      edges.get(p.lhs)!.add(s);
      if (!nul.has(s)) break;
    }
  }
  return edges;
}

/** Variáveis alcançáveis a partir de `from` em um ou mais passos. */
export function reachFrom(edges: Map<string, Set<string>>, from: string): Set<string> {
  const out = new Set<string>();
  const stack = [...(edges.get(from) ?? [])];
  while (stack.length) {
    const v = stack.pop()!;
    if (out.has(v)) continue;
    out.add(v);
    stack.push(...(edges.get(v) ?? []));
  }
  return out;
}

export interface LeftRecursionInfo {
  /** A → Aα visível. */
  direct: string[];
  /** A ⇒+ Aα passando por outras variáveis ou por prefixo anulável. */
  indirect: string[];
}

export function leftRecursion(g: Cfg): LeftRecursionInfo {
  const edges = leadingEdges(g, true);
  const direct: string[] = [];
  const indirect: string[] = [];
  for (const v of g.vars) {
    if (!reachFrom(edges, v).has(v)) continue;
    if (g.prods.some((p) => p.lhs === v && p.rhs[0] === v)) direct.push(v);
    else indirect.push(v);
  }
  return { direct, indirect };
}

export const hasLeftRecursion = (g: Cfg): boolean => {
  const lr = leftRecursion(g);
  return lr.direct.length + lr.indirect.length > 0;
};

/**
 * Ordem "de baixo para cima": cada variável vem depois das variáveis com que
 * suas alternativas podem começar (pós-ordem no grafo de `leadingEdges`). Só é
 * uma ordem topológica de verdade quando não há recursão à esquerda.
 */
export function bottomUpOrder(g: Cfg, throughNullable: boolean): string[] {
  const edges = leadingEdges(g, throughNullable);
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (v: string): void => {
    if (seen.has(v)) return;
    seen.add(v);
    for (const w of edges.get(v) ?? []) visit(w);
    order.push(v);
  };
  g.vars.forEach(visit);
  return order;
}

/** FIRST(A): terminais com que as palavras de A podem começar (sem ε). */
export function firstSets(g: Cfg): Map<string, Set<string>> {
  const vs = varSet(g);
  const nul = nullableInfo(g).all;
  const first = new Map(g.vars.map((v) => [v, new Set<string>()]));
  for (let changed = true; changed;) {
    changed = false;
    for (const p of g.prods) {
      const f = first.get(p.lhs)!;
      for (const s of p.rhs) {
        const add = vs.has(s) ? first.get(s)! : new Set([s]);
        for (const t of add) if (!f.has(t)) { f.add(t); changed = true; }
        if (!vs.has(s) || !nul.has(s)) break;
      }
    }
  }
  return first;
}

export function firstOfSeq(g: Cfg, seq: readonly string[], first: Map<string, Set<string>>, nullable: Set<string>): Set<string> {
  const vs = varSet(g);
  const out = new Set<string>();
  for (const s of seq) {
    if (!vs.has(s)) { out.add(s); return out; }
    first.get(s)!.forEach((t) => out.add(t));
    if (!nullable.has(s)) return out;
  }
  return out;
}

export interface PrefixConflict {
  lhs: string;
  a: string[];
  b: string[];
  /** direta: mesmo primeiro símbolo; indireta: primeiros símbolos diferentes, mas FIRST se cruzam. */
  kind: 'direta' | 'indireta';
  /** Símbolo comum (direta) ou terminais em comum (indireta). */
  common: string[];
}

/**
 * Pares de alternativas da mesma variável que começam igual. A alternativa ε
 * não entra (decidir entre ε e outra exigiria FOLLOW, fora do método).
 */
export function prefixConflicts(g: Cfg, only?: string): PrefixConflict[] {
  const first = firstSets(g);
  const nul = nullableInfo(g).all;
  const out: PrefixConflict[] = [];
  for (const v of g.vars) {
    if (only !== undefined && v !== only) continue;
    const alts = g.prods.filter((p) => p.lhs === v && p.rhs.length).map((p) => p.rhs);
    const firsts = alts.map((r) => firstOfSeq(g, r, first, nul));
    for (let i = 0; i < alts.length; i++) {
      for (let j = i + 1; j < alts.length; j++) {
        if (alts[i][0] === alts[j][0]) {
          out.push({ lhs: v, a: alts[i], b: alts[j], kind: 'direta', common: [alts[i][0]] });
          continue;
        }
        const common = [...firsts[i]].filter((t) => firsts[j].has(t));
        if (common.length) out.push({ lhs: v, a: alts[i], b: alts[j], kind: 'indireta', common });
      }
    }
  }
  return out;
}
