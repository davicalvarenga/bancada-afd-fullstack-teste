/**
 * Simplificação de GLC, pelo método da disciplina:
 *  - símbolos inúteis: primeiro os estéreis, depois os inalcançáveis;
 *  - produções vazias (ε-livre), com novo símbolo inicial se S for anulável;
 *  - produções simples (A → B), pelo fecho de cada variável;
 *  - simplificação combinada: ε → simples → inúteis.
 * Cada função recebe a gramática atual, registra os passos no `StepLog` e
 * devolve a gramática resultante.
 */
import {
  AuxSet, Cfg, GlcLimitError, Prod, StepLog, altsOf, freshPrime, makeCfg, showProd, terminalsOf, varSet,
} from './cfg';
import { nullableInfo, productiveRounds } from './analysis';

export const EMPTY_LANGUAGE_WARNING = (start: string): string =>
  `Linguagem vazia: o símbolo de partida ${start} é estéril (não gera nenhuma palavra). A transformação continua de forma mecânica.`;

const list = (xs: readonly string[]): string => (xs.length ? xs.join(', ') : '∅');

// ─────────────────────────── símbolos inúteis ───────────────────────────

export function removeSterile(g: Cfg, log: StepLog, title = 'Símbolos estéreis'): Cfg {
  const { rounds, productive } = productiveRounds(g);
  const vs = varSet(g);
  const sterile = g.vars.filter((v) => !productive.has(v));
  const prods = g.prods.filter((p) => productive.has(p.lhs) && p.rhs.every((s) => !vs.has(s) || productive.has(s)));
  const out = makeCfg(g.start, g.vars.filter((v) => productive.has(v) || v === g.start), prods);

  const sets: AuxSet[] = rounds.map((r, i) => ({ label: `Marcadas na ${i + 1}ª passada`, items: r }));
  sets.push({ label: 'Estéreis (não marcadas)', items: sterile });
  const method = '1ª passada: marca as variáveis com alguma alternativa só de terminais (ou ε). '
    + 'Passadas seguintes: marca quem tem alternativa só com terminais e variáveis já marcadas, até nada mudar.';
  const result = sterile.length
    ? ` As não marcadas (${list(sterile)}) são estéreis: saem, junto com toda alternativa que as usa.`
    : ' Todas as variáveis foram marcadas: não há estéreis.';
  const warnings = productive.has(g.start) ? [] : [EMPTY_LANGUAGE_WARNING(g.start)];
  return log.push(title, method + result, out, sets, warnings);
}

export function removeUnreachable(g: Cfg, log: StepLog, title = 'Símbolos inalcançáveis'): Cfg {
  const vs = varSet(g);
  const reached = [g.start];
  const seen = new Set(reached);
  for (let i = 0; i < reached.length; i++) {
    for (const rhs of altsOf(g, reached[i])) {
      for (const s of rhs) if (vs.has(s) && !seen.has(s)) { seen.add(s); reached.push(s); }
    }
  }
  const unreachable = g.vars.filter((v) => !seen.has(v));
  const out = makeCfg(g.start, g.vars.filter((v) => seen.has(v)), g.prods.filter((p) => seen.has(p.lhs)));
  const lostTerminals = terminalsOf(g).filter((t) => !terminalsOf(out).includes(t));

  const sets: AuxSet[] = [
    { label: `Alcançadas a partir de ${g.start}`, items: reached },
    { label: 'Inalcançáveis', items: unreachable },
  ];
  if (lostTerminals.length) sets.push({ label: 'Terminais que deixam de aparecer', items: lostTerminals });
  const method = `A partir de ${g.start}, marca as variáveis que aparecem nas alternativas das já marcadas, até nada mudar.`;
  const result = unreachable.length
    ? ` As demais (${list(unreachable)}) nunca aparecem numa derivação: saem com suas produções.`
    : ' Todas são alcançáveis.';
  return log.push(title, method + result, out, sets);
}

/** Estéreis e depois inalcançáveis (a ordem importa). `num` numera os títulos ("3" → "3a)", "3b)"). */
export function removeUseless(g: Cfg, log: StepLog, num = ''): Cfg {
  const a = removeSterile(g, log, `${num}a) Símbolos estéreis`);
  return removeUnreachable(a, log, `${num}b) Símbolos inalcançáveis`);
}

// ─────────────────────────── produções vazias ───────────────────────────

/**
 * `always`: se S for anulável, cria S' → S | ε (método da disciplina).
 * `ifOnRhs`: só cria S' se S aparecer em algum lado direito; senão mantém S → ε
 * (usado na CNF, que já acrescentou S' → S, e nas rodadas seguintes da GNF).
 */
export type StartPolicy = 'always' | 'ifOnRhs';

const MAX_NULLABLE_PER_ALT = 12;

export function removeEpsilon(g: Cfg, log: StepLog, policy: StartPolicy, num = ''): Cfg {
  const { direct, indirect, all } = nullableInfo(g);
  if (!all.size) {
    return log.push(`${num}Produções vazias`, 'Nenhuma variável é anulável: a gramática já é ε-livre.', g);
  }
  log.push(
    `${num}Anuláveis`,
    'Diretos: variáveis com alternativa A → ε. Indiretos: variáveis com alternativa formada só por anuláveis (repete até nada mudar).',
    g,
    [
      { label: 'Diretos', items: direct },
      { label: 'Indiretos', items: indirect },
      { label: 'Anuláveis', items: [...direct, ...indirect] },
    ],
  );

  const prods: Prod[] = [];
  for (const p of g.prods) {
    if (!p.rhs.length) continue;
    const pos = p.rhs.flatMap((s, i) => (all.has(s) ? [i] : []));
    if (pos.length > MAX_NULLABLE_PER_ALT) {
      throw new GlcLimitError(`${showProd(p)} tem ${pos.length} anuláveis: ${2 ** pos.length} combinações passam do limite.`);
    }
    for (let mask = 0; mask < 1 << pos.length; mask++) {
      const drop = new Set(pos.filter((_, k) => mask & (1 << k)));
      const rhs = p.rhs.filter((_, i) => !drop.has(i));
      if (rhs.length) prods.push({ lhs: p.lhs, rhs }); // nunca cria alternativa vazia
    }
  }
  const removedEps = g.prods.filter((p) => !p.rhs.length).map(showProd);
  const startNullable = all.has(g.start);
  const startOnRhs = g.prods.some((p) => p.rhs.includes(g.start));
  const newStart = startNullable && (policy === 'always' || startOnRhs);
  const keepStartEps = startNullable && !newStart;
  if (keepStartEps) prods.push({ lhs: g.start, rhs: [] });

  let cur = makeCfg(g.start, g.vars, prods);
  const kept = keepStartEps ? ` ${g.start} → ε é mantida: ${g.start} é o símbolo de partida e não aparece à direita.` : '';
  cur = log.push(
    `${num}Combinações sem os anuláveis`,
    'Para cada alternativa, gera todas as combinações com e sem cada ocorrência de anulável, nunca criando alternativa vazia. '
      + `Depois remove as produções A → ε.${kept}`,
    cur,
    [{ label: 'Produções vazias removidas', items: removedEps }],
  );

  if (newStart) {
    const s1 = freshPrime(g.start, varSet(cur));
    cur = makeCfg(s1, [s1, ...cur.vars], [{ lhs: s1, rhs: [g.start] }, { lhs: s1, rhs: [] }, ...cur.prods]);
    cur = log.push(
      `${num}Novo símbolo inicial`,
      `${g.start} é anulável, então ε ∈ L(G). Cria-se ${s1} → ${g.start} | ε, e ${s1} passa a ser o símbolo de partida.`,
      cur,
      [{ label: 'Novo símbolo de partida', items: [s1] }],
    );
  }
  return cur;
}

// ─────────────────────────── produções simples ───────────────────────────

export function removeUnits(g: Cfg, log: StepLog, num = ''): Cfg {
  const vs = varSet(g);
  const isUnit = (rhs: readonly string[]) => rhs.length === 1 && vs.has(rhs[0]);
  const units = g.prods.filter((p) => isUnit(p.rhs));
  if (!units.length) return log.push(`${num}Produções simples`, 'Não há produções simples (A → B).', g);

  const prods: Prod[] = [];
  const sets: AuxSet[] = [];
  for (const a of g.vars) {
    // percorre as alternativas de A na ordem; cada A → B é trocada, no lugar, pelas
    // alternativas não simples de B (e, recursivamente, das variáveis do fecho de B)
    const visited = new Set([a]);
    const closure: string[] = [];
    const walk = (x: string): void => {
      for (const rhs of altsOf(g, x)) {
        if (!isUnit(rhs)) { prods.push({ lhs: a, rhs }); continue; }
        const b = rhs[0];
        if (visited.has(b)) continue; // A → A (trivial) ou variável já expandida
        visited.add(b);
        closure.push(b);
        walk(b);
      }
    };
    walk(a);
    if (closure.length) sets.push({ label: `fecho(${a})`, items: closure });
  }
  sets.push({ label: 'Produções simples removidas', items: units.map(showProd) });
  const out = makeCfg(g.start, g.vars, prods);
  return log.push(
    `${num}Produções simples`,
    'fecho(A) = variáveis alcançáveis a partir de A só por produções simples (A → B). Cada A → B é trocada pelas '
      + 'alternativas não simples das variáveis do fecho; A → A é removida por ser trivial.',
    out,
    sets,
  );
}

// ─────────────────────────── combinada ───────────────────────────

/** Ordem da disciplina: ε, depois simples, depois inúteis. */
export function simplify(g: Cfg, log: StepLog): Cfg {
  let cur = removeEpsilon(g, log, 'always', '1. ');
  cur = removeUnits(cur, log, '2. ');
  return removeUseless(cur, log, '3');
}

