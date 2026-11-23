/**
 * Remoção de recursão à esquerda.
 *
 * Direta:   A → Aα | β   vira   A → βA'  e  A' → αA' | ε
 *           (versão sem ε:     A → βA' | β  e  A' → αA' | α).
 *
 * Indireta (ordenação A1..An, Menezes §6.6): as variáveis são numeradas na
 * ordem em que aparecem. Para cada Ai, uma alternativa Ai → Ajγ com j < i só é
 * substituída pelas alternativas de Aj quando Aj volta a Ai pela esquerda
 * (Aj ⇒+ Ai…), isto é, quando ela é a "variável intermediária" de uma recursão
 * indireta; as demais ficam como estão. Repete até não haver mais substituição
 * a fazer e então remove a recursão direta de Ai.
 *
 * Recursão escondida atrás de variável anulável (A → BAc, B ⇒* ε) não é tratada
 * aqui: o chamador avisa e sugere aplicar ε-livre antes.
 */
import { Cfg, GlcLimitError, StepLog, addVar, altsOf, freshPrime, setAlts, showRhs, varSet } from './cfg';
import { leadingEdges, leftRecursion, reachFrom } from './analysis';

const MAX_SUBSTITUTIONS = 200;

/** Remove a recursão direta de `a` (se houver), registrando um passo. */
export function removeDirect(g: Cfg, a: string, epsFree: boolean, log: StepLog, num = ''): Cfg {
  const alts = altsOf(g, a);
  const rec = alts.filter((r) => r[0] === a);
  if (!rec.length) return g;
  const alphas = rec.map((r) => r.slice(1)).filter((x) => x.length);
  const betas = alts.filter((r) => r[0] !== a);

  if (!alphas.length) { // só A → A
    return log.push(`${num}Recursão trivial em ${a}`, `${a} → ${a} não gera nada novo e é removida.`, setAlts(g, a, betas));
  }
  const a1 = freshPrime(a, varSet(g));
  const newA = betas.map((b) => [...b, a1]);
  const newA1 = alphas.map((x) => [...x, a1]);
  if (epsFree) { newA.push(...betas); newA1.push(...alphas); } else newA1.push([]);

  const out = addVar(setAlts(g, a, newA), a1, newA1, a);
  const rule = epsFree
    ? `${a} → ${a}α | β vira ${a} → β${a1} | β e ${a1} → α${a1} | α (versão sem ε).`
    : `${a} → ${a}α | β vira ${a} → β${a1} e ${a1} → α${a1} | ε.`;
  const warnings = betas.length ? [] : [`${a} não tem alternativa sem recursão (β): fica sem produções, ou seja, estéril.`];
  return log.push(
    `${num}Recursão direta em ${a}`,
    rule,
    out,
    [{ label: 'α (o que vem depois de ' + a + ')', items: alphas.map(showRhs) }, { label: 'β (alternativas sem recursão)', items: betas.map(showRhs) }],
    warnings,
  );
}

export function removeLeftRecursion(g: Cfg, log: StepLog, epsFree: boolean, num = ''): Cfg {
  const lr = leftRecursion(g);
  if (!lr.direct.length && !lr.indirect.length) {
    return log.push(`${num}Recursão à esquerda`, 'Nenhuma variável deriva a si mesma pela esquerda (A ⇒+ Aα): nada a fazer.', g);
  }
  const order = g.vars.filter((v) => g.prods.some((p) => p.lhs === v));
  const idx = new Map(order.map((v, i) => [v, i]));
  let cur = log.push(
    `${num}Ordenação das variáveis`,
    'Numera as variáveis A1..An. Para cada Ai, em ordem: se Ai → Ajγ com j < i e Aj volta a Ai pela esquerda, '
      + 'troca Aj pelas suas alternativas (a recursão fica direta); depois remove a recursão direta de Ai.',
    g,
    [
      { label: 'Ordem', items: order.map((v, i) => `A${i + 1} = ${v}`) },
      { label: 'Recursão direta', items: lr.direct },
      { label: 'Recursão indireta', items: lr.indirect },
    ],
  );

  let guard = 0;
  for (let i = 0; i < order.length; i++) {
    const ai = order[i];
    for (;;) {
      const edges = leadingEdges(cur, false);
      const leadsBack = (rhs: readonly string[]) => rhs.length > 0 && rhs[0] !== ai
        && (idx.get(rhs[0]) ?? Infinity) < i && reachFrom(edges, rhs[0]).has(ai);
      const target = altsOf(cur, ai).find(leadsBack);
      if (!target) break;
      if (++guard > MAX_SUBSTITUTIONS) throw new GlcLimitError(`Limite de ${MAX_SUBSTITUTIONS} substituições atingido na recursão indireta.`);
      const aj = target[0];
      const replaced = altsOf(cur, ai).filter((r) => r[0] === aj && leadsBack(r));
      const newAlts = altsOf(cur, ai).flatMap((r) => (r[0] === aj && leadsBack(r) ? altsOf(cur, aj).map((b) => [...b, ...r.slice(1)]) : [r]));
      cur = log.push(
        `${num}Substituição de ${aj} em ${ai}`,
        `${ai} → ${aj}… volta a ${ai} pela esquerda (${ai} ⇒ ${aj}… ⇒+ ${ai}…). ${aj} é trocada pelas suas alternativas `
          + 'para a recursão ficar direta.',
        setAlts(cur, ai, newAlts),
        [{ label: 'Alternativas substituídas', items: replaced.map((r) => `${ai} → ${showRhs(r)}`) }],
      );
    }
    cur = removeDirect(cur, ai, epsFree, log, num);
  }
  return cur;
}
