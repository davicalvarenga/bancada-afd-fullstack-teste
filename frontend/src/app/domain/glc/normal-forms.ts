/**
 * Formas normais de Chomsky (CNF/FNC) e de Greibach (GNF/FNG), pelas etapas da
 * disciplina. A remoção de símbolos inúteis é OPCIONAL nas duas (desligada por
 * padrão): o método da professora não a inclui e o Menezes a marca como opcional.
 */
import { Cfg, GlcLimitError, Prod, StepLog, altsOf, freshIndexed, freshPrime, makeCfg, rhsKey, setAlts, showRhs, terminalVarName, varSet } from './cfg';
import { bottomUpOrder, leftRecursion } from './analysis';
import { removeEpsilon, removeUnits, removeUseless } from './simplify';
import { removeLeftRecursion } from './left-recursion';

export interface NormalFormOptions {
  removeUseless: boolean;
}

/**
 * Troca os terminais nas posições escolhidas por variáveis novas (Xa → a).
 * Reaproveita a mesma variável para o mesmo terminal.
 */
function replaceTerminals(g: Cfg, shouldReplace: (p: Prod, i: number) => boolean): { g: Cfg; made: string[] } {
  const vs = varSet(g);
  const used = new Set(vs);
  const byTerminal = new Map<string, string>();
  const prods = g.prods.map((p) => ({
    lhs: p.lhs,
    rhs: p.rhs.map((s, i) => {
      if (vs.has(s) || !shouldReplace(p, i)) return s;
      let x = byTerminal.get(s);
      if (!x) { x = terminalVarName(s, used); used.add(x); byTerminal.set(s, x); }
      return x;
    }),
  }));
  const made = [...byTerminal.entries()];
  const out = makeCfg(g.start, [...g.vars, ...made.map(([, x]) => x)], [...prods, ...made.map(([t, x]) => ({ lhs: x, rhs: [t] }))]);
  return { g: out, made: made.map(([t, x]) => `${x} → ${t}`) };
}

// ─────────────────────────── CNF ───────────────────────────

export function toCnf(g: Cfg, log: StepLog, opts: NormalFormOptions): Cfg {
  // 1) S' → S
  const s1 = freshPrime(g.start, varSet(g));
  let cur = log.push(
    '1. Novo símbolo inicial',
    `Acrescenta ${s1} → ${g.start}. Assim o símbolo de partida nunca aparece num lado direito (B e C de A → BC ficam diferentes dele) `
      + `e só ele pode ter ${s1} → ε.`,
    makeCfg(s1, [s1, ...g.vars], [{ lhs: s1, rhs: [g.start] }, ...g.prods]),
  );
  // 2) ε-livre (o novo início não aparece à direita: se anulável, fica S' → ε)
  cur = removeEpsilon(cur, log, 'ifOnRhs', '2. ');
  // 3) produções simples
  cur = removeUnits(cur, log, '3. ');
  if (opts.removeUseless) cur = removeUseless(cur, log, 'Opcional: ');

  // 4) terminal acompanhado vira variável
  const t = replaceTerminals(cur, (p) => p.rhs.length >= 2);
  cur = log.push(
    '4. Terminais acompanhados',
    t.made.length
      ? 'Em toda alternativa com dois ou mais símbolos, cada terminal a é trocado por uma variável nova Xa, com Xa → a.'
      : 'Nenhum terminal aparece acompanhado: nada a trocar.',
    t.g,
    t.made.length ? [{ label: 'Variáveis para terminais', items: t.made }] : [],
  );

  // 5) quebra lados direitos com 3+ variáveis em pares (mesmo resto → mesma Y)
  const used = new Set(varSet(cur));
  const bySuffix = new Map<string, string>();
  const extra: Prod[] = [];
  const pairVar = (seq: string[]): string => {
    const k = rhsKey(seq);
    let y = bySuffix.get(k);
    if (y) return y;
    y = freshIndexed('Y', used);
    used.add(y);
    bySuffix.set(k, y);
    extra.push({ lhs: y, rhs: seq.length === 2 ? seq : [seq[0], pairVar(seq.slice(1))] });
    return y;
  };
  const prods = cur.prods.map((p) => (p.rhs.length >= 3 ? { lhs: p.lhs, rhs: [p.rhs[0], pairVar(p.rhs.slice(1))] } : p));
  const made = extra.map((p) => `${p.lhs} → ${showRhs(p.rhs)}`);
  cur = log.push(
    '5. Lados direitos longos',
    made.length
      ? 'A → B1B2…Bk (k ≥ 3) vira A → B1Y, com Y gerando B2…Bk aos pares. O mesmo resto reaproveita a mesma variável.'
      : 'Nenhum lado direito tem três ou mais variáveis.',
    makeCfg(cur.start, [...cur.vars, ...extra.map((p) => p.lhs)], [...prods, ...extra]),
    made.length ? [{ label: 'Variáveis para pares', items: made }] : [],
  );
  return cur;
}

// ─────────────────────────── GNF ───────────────────────────

export const MAX_GNF_ROUNDS = 5;
const MAX_SUBSTITUTION_PASSES = 50;

export function toGnf(g: Cfg, log: StepLog, opts: NormalFormOptions, warn: (msg: string) => void): Cfg {
  let cur = g;
  // etapas 1–3; a recursão à esquerda pode voltar na ε-livre (A → BAc, B ⇒* ε) ou nas
  // simples (A → B, B → Aα vira A → Aα): então as três etapas são repetidas
  for (let round = 1; ; round++) {
    const r = round === 1 ? '' : `Rodada ${round} — `;
    cur = removeLeftRecursion(cur, log, false, `${r}1. `);
    cur = removeEpsilon(cur, log, round === 1 ? 'always' : 'ifOnRhs', `${r}2. `);
    cur = removeUnits(cur, log, `${r}3. `);
    const lr = leftRecursion(cur);
    const back = [...lr.direct, ...lr.indirect];
    if (!back.length) break;
    if (round >= MAX_GNF_ROUNDS) {
      throw new GlcLimitError(`A recursão à esquerda continua depois de ${MAX_GNF_ROUNDS} rodadas das etapas 1 a 3; a GNF foi interrompida.`);
    }
    const msg = `A recursão à esquerda reapareceu em ${back.join(', ')} depois das etapas 2 e 3; as etapas 1 a 3 são repetidas (rodada ${round + 1}).`;
    warn(msg);
    cur = log.push(`Rodada ${round}: recursão à esquerda reapareceu`, msg, cur, [{ label: 'Variáveis com recursão', items: back }], [msg]);
  }
  if (opts.removeUseless) cur = removeUseless(cur, log, 'Opcional: ');

  // 4) substituição de baixo para cima até toda alternativa começar com terminal
  const order = bottomUpOrder(cur, false).filter((v) => cur.prods.some((p) => p.lhs === v));
  cur = log.push(
    '4. Ordem de substituição (de baixo para cima)',
    'Sem recursão à esquerda, dá para ordenar as variáveis de modo que cada uma venha depois das que aparecem no início das '
      + 'suas alternativas. Na ordem abaixo, cada alternativa que começa com variável recebe as alternativas dela, que já começam com terminal.',
    cur,
    [{ label: 'Ordem', items: order }],
  );
  for (const a of order) {
    const vs = varSet(cur);
    const startsWithVar = (rhs: readonly string[]) => rhs.length > 0 && vs.has(rhs[0]);
    const substituted = new Set<string>();
    for (let pass = 0; altsOf(cur, a).some(startsWithVar); pass++) {
      if (pass >= MAX_SUBSTITUTION_PASSES) throw new GlcLimitError(`Limite de substituições atingido em ${a}.`);
      const alts = altsOf(cur, a);
      alts.filter(startsWithVar).forEach((rhs) => substituted.add(rhs[0]));
      cur = setAlts(cur, a, alts.flatMap((rhs) => (startsWithVar(rhs) ? altsOf(cur, rhs[0]).map((b) => [...b, ...rhs.slice(1)]) : [rhs])));
    }
    if (substituted.size) {
      cur = log.push(
        `4. Substituição em ${a}`,
        `Cada alternativa de ${a} que começa com ${[...substituted].join(', ')} recebe, no lugar dessa variável, as alternativas dela.`,
        cur,
        [{ label: 'Variáveis substituídas', items: [...substituted] }],
      );
    }
  }

  // 5) terminal fora da primeira posição vira variável
  const t = replaceTerminals(cur, (_p, i) => i > 0);
  return log.push(
    '5. Terminais fora da 1ª posição',
    t.made.length
      ? 'Depois do primeiro símbolo só pode haver variáveis: cada terminal fora da 1ª posição é trocado por uma variável nova (X → terminal).'
      : 'Nenhum terminal fora da 1ª posição.',
    t.g,
    t.made.length ? [{ label: 'Variáveis para terminais', items: t.made }] : [],
  );
}
