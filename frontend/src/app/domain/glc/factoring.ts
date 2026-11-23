/**
 * Fatoração à esquerda (direta e indireta).
 *
 * Direta: A → αβ1 | αβ2 | γ vira A → αA' | γ e A' → β1 | β2, com α = maior
 * prefixo comum das alternativas que começam com o mesmo símbolo (ε no lugar
 * de um resto vazio).
 *
 * Indireta: CRITÉRIO DE SUBSTITUIÇÃO (exibido também no texto dos passos):
 *   uma alternativa que começa com a variável B só é substituída pelas
 *   alternativas de B quando FIRST(alternativa) cruza com o FIRST de OUTRA
 *   alternativa da mesma variável que começa com símbolo diferente.
 *   - alternativas que começam com terminal nunca são substituídas;
 *   - alternativas que começam com variável, mas sem cruzamento, ficam como estão;
 *   - duas alternativas com o MESMO primeiro símbolo (mesmo variável) são
 *     fatoradas diretamente, sem substituir;
 *   - a alternativa ε não entra na comparação (exigiria FOLLOW).
 *
 * Ordem: as variáveis são tratadas "de baixo para cima" (quem é usado no início
 * de uma alternativa antes de quem usa). Assim, ao substituir B, as
 * alternativas de B já estão fatoradas. Em cada variável: primeiro as
 * substituições (indireta), depois a fatoração direta, e repete até não sobrar
 * conflito. As variáveis novas (A', A'') entram na fila logo em seguida e são
 * fatoradas do mesmo jeito. Tudo sob um limite de iterações.
 *
 * Pré-condição: sem recursão à esquerda (senão a substituição não termina). O
 * chamador recusa a transformação e avisa.
 */
import { Cfg, GlcLimitError, StepLog, addVar, altsOf, freshPrime, rhsKey, setAlts, showRhs, varSet } from './cfg';
import { bottomUpOrder, firstOfSeq, firstSets, nullableInfo, prefixConflicts } from './analysis';

export const FACTORING_CRITERION =
  'Critério da substituição: uma alternativa que começa com variável só é substituída quando o FIRST dela (terminais com '
  + 'que pode começar) cruza com o FIRST de outra alternativa que começa com símbolo diferente. Alternativas que começam '
  + 'com terminal, e as que começam com variável sem cruzamento, ficam como estão; a alternativa ε não entra na comparação.';

export const DEFAULT_MAX_ITERATIONS = 60;

function longestCommonPrefix(rhss: readonly string[][]): string[] {
  const out: string[] = [];
  for (let k = 0; ; k++) {
    const s = rhss[0][k];
    if (s === undefined || rhss.some((r) => r[k] !== s)) return out;
    out.push(s);
  }
}

const setText = (xs: Iterable<string>) => `{${[...xs].join(', ')}}`;

export function factor(g: Cfg, log: StepLog, maxIterations = DEFAULT_MAX_ITERATIONS): Cfg {
  const order = bottomUpOrder(g, true).filter((v) => g.prods.some((p) => p.lhs === v));
  let cur = log.push(
    'Ordem de processamento',
    'As variáveis são fatoradas de baixo para cima: quem aparece no início das alternativas de outra vem antes. '
      + 'Assim, quando uma variável é substituída, as alternativas dela já estão fatoradas. ' + FACTORING_CRITERION,
    g,
    [{ label: 'Ordem', items: order }],
  );

  let budget = maxIterations;
  const spend = () => {
    if (--budget < 0) {
      throw new GlcLimitError(
        `Limite de ${maxIterations} iterações atingido: a fatoração pode não terminar para esta gramática `
        + '(nem toda GLC pode ser fatorada). O resultado mostrado é parcial.',
      );
    }
  };

  const queue = [...order];
  const processVar = (a: string): void => {
    for (;;) {
      const conflicts = prefixConflicts(cur, a);
      if (!conflicts.length) return;
      spend();
      const vs = varSet(cur);

      // 1) indireta: substitui a variável inicial das alternativas que cruzam com outra de início diferente
      const indirect = conflicts.filter((c) => c.kind === 'indireta');
      const toSubst = new Set<string>();
      for (const c of indirect) {
        if (vs.has(c.a[0])) toSubst.add(rhsKey(c.a));
        if (vs.has(c.b[0])) toSubst.add(rhsKey(c.b));
      }
      if (toSubst.size) {
        const first = firstSets(cur);
        const nul = nullableInfo(cur).all;
        const alts = altsOf(cur, a);
        const substituted = alts.filter((r) => toSubst.has(rhsKey(r)));
        const newAlts = alts.flatMap((r) => (toSubst.has(rhsKey(r))
          ? altsOf(cur, r[0]).map((b) => [...b, ...r.slice(1)])
          : [r]));
        const vars = [...new Set(substituted.map((r) => r[0]))];
        cur = log.push(
          `Fatoração indireta em ${a}: substituir ${vars.join(', ')}`,
          `${FACTORING_CRITERION} Aqui, ${vars.join(', ')} ${vars.length > 1 ? 'são trocadas' : 'é trocada'} pelas suas alternativas `
            + 'nas alternativas marcadas, e o prefixo comum fica visível.',
          setAlts(cur, a, newAlts),
          [
            {
              label: 'Cruzamentos de FIRST',
              items: indirect.map((c) => `FIRST(${showRhs(c.a)}) = ${setText(firstOfSeq(cur, c.a, first, nul))} × `
                + `FIRST(${showRhs(c.b)}) = ${setText(firstOfSeq(cur, c.b, first, nul))}`),
            },
            { label: 'Alternativas substituídas', items: substituted.map((r) => `${a} → ${showRhs(r)}`) },
          ],
        );
        continue;
      }

      // 2) direta: agrupa pelo primeiro símbolo e fatora o maior prefixo comum de cada grupo
      const groups = new Map<string, string[][]>();
      for (const r of altsOf(cur, a)) {
        if (!r.length) continue;
        const k = r[0];
        groups.set(k, [...(groups.get(k) ?? []), r]);
      }
      const multi = [...groups.values()].filter((grp) => grp.length > 1);
      const created: { name: string; alts: string[][]; prefix: string[] }[] = [];
      const used = new Set(varSet(cur));
      const replacement = new Map<string, string[] | null>(); // rhsKey → nova alternativa (ou null = some)
      for (const grp of multi) {
        const prefix = longestCommonPrefix(grp);
        const name = freshPrime(a, used);
        used.add(name);
        created.push({ name, prefix, alts: grp.map((r) => r.slice(prefix.length)) });
        grp.forEach((r, i) => replacement.set(rhsKey(r), i === 0 ? [...prefix, name] : null));
      }
      const newAlts = altsOf(cur, a).flatMap((r) => {
        const rep = replacement.get(rhsKey(r));
        return rep === undefined ? [r] : rep === null ? [] : [rep];
      });
      let next = setAlts(cur, a, newAlts);
      let anchor = a;
      for (const c of created) { next = addVar(next, c.name, c.alts, anchor); anchor = c.name; }
      cur = log.push(
        `Fatoração direta em ${a}`,
        `${a} → αβ1 | αβ2 | γ vira ${a} → α${a}' | γ e ${a}' → β1 | β2, com α = maior prefixo comum (ε quando um resto fica vazio).`,
        next,
        [{ label: 'Prefixo comum → variável nova', items: created.map((c) => `${showRhs(c.prefix)} → ${c.name}`) }],
      );
      queue.unshift(...created.map((c) => c.name)); // as novas são fatoradas logo em seguida
    }
  };

  // repete até nenhuma variável ter conflito; o orçamento de iterações garante o fim
  for (;;) {
    while (queue.length) processVar(queue.shift()!);
    const pending = cur.vars.filter((v) => prefixConflicts(cur, v).length);
    if (!pending.length) return cur;
    queue.push(...pending);
  }
}
