/**
 * Testes da lógica de GLC: `npm test` (no frontend/).
 * Os resultados são comparados por FORMA (mesmo conjunto de produções, a menos
 * de renomear as variáveis criadas) e por EQUIVALÊNCIA até n, nunca por texto.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Cfg, altsOf, parseCfg, prodKey, showCfg, showRhs, varSet } from './cfg';
import { hasLeftRecursion, isLanguageEmpty, nullableInfo, prefixConflicts, productiveRounds } from './analysis';
import { checkCnf, checkEpsFree, checkForms, checkGnf, checkLeftRecursion, compareUpTo, languageUpTo } from './checks';
import { CLASS_MATCH_FINAL, CLASS_MATCH_INTERMEDIATE, TransformKind, TransformResult, runTransform } from './transforms';
import { GLC_EXAMPLES, GLC_EXAMPLE_GROUPS } from './examples';

// ─────────────────────────── utilitários ───────────────────────────

function g(text: string): Cfg {
  const r = parseCfg(text);
  assert.deepEqual(r.problems, [], `gramática de teste inválida: ${JSON.stringify(r.problems)}`);
  return r.grammar!;
}

function assertEquivalent(a: Cfg, b: Cfg, n = 7): void {
  const r = compareUpTo(a, b, n);
  assert.ok(r.complete, 'enumeração incompleta');
  assert.ok(r.equivalent, `divergem até ${n}: só na 1ª ${r.onlyA.slice(0, 5)}; só na 2ª ${r.onlyB.slice(0, 5)}\n${showCfg(b)}`);
}

/** Mesmas produções, a menos de renomear as variáveis que só existem de um lado (A' ↔ A', Xa ↔ X, Y1 ↔ Y). */
function sameUpToRenaming(a: Cfg, b: Cfg): boolean {
  const used = (x: Cfg) => [...new Set(x.prods.flatMap((p) => [p.lhs, ...p.rhs]).filter((s) => varSet(x).has(s)))];
  const va = used(a);
  const vb = used(b);
  const freeA = va.filter((v) => !vb.includes(v));
  const freeB = vb.filter((v) => !va.includes(v));
  if (freeA.length !== freeB.length || a.prods.length !== b.prods.length) return false;
  const kb = new Set(b.prods.map(prodKey));
  const perms = (xs: string[]): string[][] => (xs.length <= 1 ? [xs]
    : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])));
  for (const perm of perms(freeB)) {
    const m = new Map(freeA.map((v, i) => [v, perm[i]]));
    const ren = (s: string) => m.get(s) ?? s;
    if (ren(a.start) !== b.start) continue;
    if (a.prods.every((p) => kb.has(prodKey({ lhs: ren(p.lhs), rhs: p.rhs.map(ren) })))) return true;
  }
  return false;
}

function assertShape(actual: Cfg, expectedText: string): void {
  assert.ok(sameUpToRenaming(actual, g(expectedText)), `forma diferente da esperada. Obtido:\n${showCfg(actual)}`);
}

function altSet(x: Cfg, v: string): string[] {
  return altsOf(x, v).map(showRhs).sort();
}

function run(kind: Parameters<typeof runTransform>[0], text: string, opts = {}): TransformResult {
  const r = runTransform(kind, g(text), opts);
  assert.equal(r.refused, null, `recusada: ${r.refused}`);
  assert.equal(r.aborted, false, `interrompida: ${r.warnings.join(' | ')}`);
  assert.ok(r.steps.length > 0, 'sem passos');
  return r;
}

const ETF = 'E -> E+T | T\nT -> T*F | F\nF -> (E) | a';
const SABC = 'S -> A | B | AB\nA -> aB | bS | b\nB -> bB | Ba';

// ─────────────────────────── parser ───────────────────────────

test('parser: setas, vazio (ε, eps, &) e variáveis com sufixo', () => {
  const x = g("S' → S | eps\nS -> aA1b | &\nA1 -> XaY1 | ε\nXa -> a\nY1 -> ¬∨");
  assert.equal(x.start, "S'");
  assert.deepEqual(x.vars, ["S'", 'S', 'A1', 'Xa', 'Y1']);
  assert.deepEqual(altsOf(x, 'S'), [['a', 'A1', 'b'], []]);
  assert.deepEqual(altsOf(x, 'A1'), [['Xa', 'Y1'], []]);
  assert.deepEqual(altsOf(x, 'Y1'), [['¬', '∨']]);
  // sufixo minúsculo só vale para variável declarada: aqui X e a
  assert.deepEqual(altsOf(g('S -> Xa\nX -> b'), 'S'), [['X', 'a']]);
});

test('parser: erros claros', () => {
  const msg = (t: string) => parseCfg(t).problems.map((p) => p.message).join(' ');
  assert.match(msg('S aSb'), /Falta a seta/);
  assert.match(msg('s -> a'), /não é uma variável/);
  assert.match(msg(''), /Gramática vazia/);
  assert.match(msg('S -> a ||b'), /Alternativa vazia/);
  assert.equal(parseCfg('S -> a\nx -> b').grammar, null);
  assert.match(parseCfg('S -> aB').notes.join(), /B aparece à direita/);
});

// ─────────────────────────── simplificação ───────────────────────────

test('inúteis: estéreis e depois inalcançáveis', () => {
  const r = run('useless', 'S -> aA\nA -> a | bB\nB -> b | dD\nC -> cC | c\nD -> dD');
  assert.deepEqual(r.steps[0].sets.find((s) => s.label.startsWith('Estéreis'))!.items, ['D']);
  assert.deepEqual(r.steps[1].sets.find((s) => s.label === 'Inalcançáveis')!.items, ['C']);
  assertShape(r.result, 'S -> aA\nA -> a | bB\nB -> b');
  assertEquivalent(r.input, r.result);
});

test('ε-livre: anuláveis {D, C, S} e novo início', () => {
  const r = run('epsilon', 'S -> bCDe | DC\nD -> dD | ε\nC -> cD | ε');
  assert.deepEqual(r.steps[0].sets.find((s) => s.label === 'Anuláveis')!.items, ['D', 'C', 'S']);
  assertShape(r.result, "S' -> S | ε\nS -> bCDe | bDe | bCe | be | DC | C | D\nD -> dD | d\nC -> cD | c");
  assert.ok(checkEpsFree(r.result).ok);
  assertEquivalent(r.input, r.result);
});

test('produções simples: S → B trocada pelas alternativas de B', () => {
  const r = run('unit', 'S -> aSb | B | b\nB -> ab | ba');
  assert.deepEqual(altSet(r.result, 'S'), ['ab', 'aSb', 'b', 'ba'].sort());
  assert.deepEqual(r.steps[0].sets.find((s) => s.label === 'fecho(S)')!.items, ['B']);
  assertEquivalent(r.input, r.result);
});

test('simplificação combinada (ε → simples → inúteis)', () => {
  const r = run('simplify', 'S -> aA | B\nA -> ε | b\nB -> C\nC -> cC');
  assert.ok(checkEpsFree(r.result).ok);
  assertShape(r.result, 'S -> aA | a\nA -> b');
  assertEquivalent(r.input, r.result);
});

// ─────────────────────────── recursão à esquerda ───────────────────────────

test('recursão: E → E+T | T, T → T*F | F', () => {
  const r = run('left-recursion', ETF);
  assertShape(r.result, "E -> TE'\nE' -> +TE' | ε\nT -> FT'\nT' -> *FT' | ε\nF -> (E) | a");
  assert.equal(hasLeftRecursion(r.result), false);
  assertEquivalent(r.input, r.result);
});

test('recursão: versão sem ε', () => {
  const r = run('left-recursion', ETF, { epsFreeRecursion: true });
  assertShape(r.result, "E -> TE' | T\nE' -> +TE' | +T\nT -> FT' | F\nT' -> *FT' | *F\nF -> (E) | a");
  assertEquivalent(r.input, r.result);
});

test('recursão: S → [L] | a, L → LS | S', () => {
  const r = run('left-recursion', 'S -> [L] | a\nL -> LS | S');
  assertShape(r.result, "S -> [L] | a\nL -> SL'\nL' -> SL' | ε");
  assertEquivalent(r.input, r.result);
});

test('recursão indireta com linguagem vazia completa a transformação', () => {
  const r = run('left-recursion', 'S -> D | B\nD -> dB | Sb\nB -> bB | Bd');
  assert.ok(r.warnings.some((w) => /Linguagem vazia/.test(w)));
  assert.ok(r.steps.some((s) => s.title.startsWith('Substituição de S em D')));
  assert.equal(hasLeftRecursion(r.result), false);
  assert.equal(languageUpTo(r.result, 6).words.length, 0);
});

// ─────────────────────────── fatoração ───────────────────────────

test('fatoração: S → Ab | abaA, A → aab | aa (direta e indireta)', () => {
  const r = run('factoring', 'S -> Ab | abaA\nA -> aab | aa');
  // direta em A
  const afterA = r.steps.find((s) => s.title === 'Fatoração direta em A')!.grammar;
  assert.deepEqual(altSet(afterA, 'A'), ["aaA'"]);
  assert.deepEqual(altSet(afterA, "A'"), ['b', 'ε']);
  // indireta em S, com o critério no texto do passo
  const ind = r.steps.find((s) => s.title.startsWith('Fatoração indireta em S'))!;
  assert.match(ind.explanation, /Critério da substituição/);
  assertShape(r.result, "S -> aS'\nS' -> aA'b | baA\nA -> aaA'\nA' -> b | ε");
  assert.equal(prefixConflicts(r.result).length, 0);
  assertEquivalent(r.input, r.result);
});

test('fatoração: S → aA | aB | C (substitui C e segue nas novas)', () => {
  const r = run('factoring', 'S -> aA | aB | C\nA -> CA | a\nB -> bB | bC\nC -> aC | c');
  const mid = r.steps.find((s) => s.title === 'Fatoração direta em S')!.grammar;
  assert.deepEqual(altSet(mid, 'S'), ["aS'", 'c']);
  assert.deepEqual(altSet(mid, "S'"), ['A', 'B', 'C']);
  assert.equal(prefixConflicts(r.result).length, 0);
  assertEquivalent(r.input, r.result);
});

test('fatoração: S → bAS | a, A → SaA | SS | ab (fatora as novas várias vezes), n = 9', () => {
  const r = run('factoring', 'S -> bAS | a\nA -> SaA | SS | ab');
  assert.equal(prefixConflicts(r.result).length, 0);
  const created = r.steps.flatMap((s) => s.diff.newVars);
  const refactored = r.steps.filter((s) => created.some((v) => s.title.startsWith(`Fatoração direta em ${v}`)
    || s.title.startsWith(`Fatoração indireta em ${v}:`)));
  assert.ok(created.length >= 3 && refactored.length >= 2, 'as variáveis novas deveriam ser fatoradas de novo');
  assertEquivalent(r.input, r.result, 9);
});

test('nomes novos: A\', A\'\' e, a partir da terceira, A3, A4…', () => {
  const r = run('factoring', 'S -> bAS | a\nA -> SaA | SS | ab');
  const created = r.steps.flatMap((s) => s.diff.newVars);
  assert.deepEqual(created.slice(0, 4), ["A'", "A''", 'A3', 'A4']);
  assert.ok(created.every((v) => /^A('{1,2}|\d+)$/.test(v)), created.join(' '));
  // A1 do usuário não vira A13: continua com apóstrofos
  const u = run('left-recursion', "A1 -> A1a | b\nA1' -> c\nA1'' -> d");
  assert.ok(u.result.vars.includes("A1'''"), u.result.vars.join(' '));
});

test('fatoração: passo que coincide com o resultado de aula é destacado', () => {
  const ex2 = GLC_EXAMPLES.find((e) => e.id === 'fat2')!;
  const r = runTransform('factoring', g(ex2.gramatica), { classResult: g(ex2.gabaritoAula!) });
  const marked = r.steps.filter((s) => s.highlight);
  assert.equal(marked.length, 1);
  assert.equal(marked[0].title, 'Fatoração direta em S');
  assert.ok(marked[0].explanation.endsWith(CLASS_MATCH_INTERMEDIATE));
  assert.ok(r.steps.indexOf(marked[0]) < r.steps.length - 1);

  // F0: o gabarito de aula é só a fatoração direta de A (passo intermediário)
  const ex1 = GLC_EXAMPLES.find((e) => e.id === 'fat1')!;
  const r1 = runTransform('factoring', g(ex1.gramatica), { classResult: g(ex1.gabaritoAula!) });
  assert.equal(r1.steps.find((s) => s.highlight)?.title, 'Fatoração direta em A');
  // gabarito completo coincide com o último passo
  const full = runTransform('factoring', g(ex1.gramatica), { classResult: g("S -> aS'\nS' -> aA'b | baA\nA -> aaA'\nA' -> b | ε") });
  assert.equal(full.steps[full.steps.length - 1].highlight, CLASS_MATCH_FINAL);
  // sem gabarito, nada é destacado
  assert.equal(runTransform('factoring', g(ex2.gramatica)).steps.filter((s) => s.highlight).length, 0);
});

test('fatoração: recusada quando há recursão à esquerda', () => {
  const r = runTransform('factoring', g('S -> A | B | AB\nA -> aB | bS | b\nB -> bB | Ba | C\nC -> AS | AB | b'));
  assert.ok(r.refused);
  assert.match(r.refused!, /recursão à esquerda/);
  assert.equal(r.steps.length, 0);
  assert.ok(r.warnings.some((w) => /recursão à esquerda/.test(w)));
});

test('fatoração: limite de iterações gera aviso e resultado parcial', () => {
  // {aⁿbⁿ} ∪ {aⁿcⁿ} não pode ser fatorada: o limite padrão (60) tem de parar a transformação
  const r = runTransform('factoring', g('S -> A | B\nA -> aAb | ab\nB -> aBc | ac'));
  assert.equal(r.aborted, true);
  assert.ok(r.warnings.some((w) => /Limite de 60 iterações/.test(w)));
  assert.ok(r.steps.length > 0);
  assertEquivalent(r.input, r.result, 8); // parcial, mas cada passo preserva a linguagem
});

// ─────────────────────────── CNF ───────────────────────────

test('CNF: S → ASA | aB, A → B | S, B → b | ε', () => {
  const r = run('cnf', 'S -> ASA | aB\nA -> B | S\nB -> b | ε');
  assertShape(r.result, "S' -> AY | XB | a | SA | AS\nS -> AY | XB | a | SA | AS\nA -> b | AY | XB | a | SA | AS\nB -> b\nX -> a\nY -> SA");
  assert.ok(checkCnf(r.result).ok, checkCnf(r.result).violations.join('\n'));
  assert.deepEqual(r.steps.find((s) => s.title.startsWith('4.'))!.diff.newVars, ['Xa']);
  assertEquivalent(r.input, r.result);
});

test('CNF: E → E+E | E*E | [E] | x', () => {
  const r = run('cnf', 'E -> E+E | E*E | [E] | x');
  assert.ok(checkCnf(r.result).ok, checkCnf(r.result).violations.join('\n'));
  assertEquivalent(r.input, r.result);
});

test('CNF: S anulável fica com S\' → ε', () => {
  const r = run('cnf', 'S -> aSb | ε');
  assert.ok(checkCnf(r.result).ok);
  assert.ok(altsOf(r.result, r.result.start).some((x) => !x.length));
  assertEquivalent(r.input, r.result, 8);
});

// ─────────────────────────── GNF ───────────────────────────

test('GNF: E/T/F', () => {
  const r = run('gnf', ETF);
  assertShape(r.result, [
    "E -> (EXT'E' | aT'E' | (EXE' | aE' | (EXT' | aT' | (EX | a",
    "E' -> +TE' | +T",
    "T -> (EXT' | aT' | (EX | a",
    "T' -> *FT' | *F",
    'F -> (EX | a',
    'X -> )',
  ].join('\n'));
  assert.ok(checkGnf(r.result).ok, checkGnf(r.result).violations.join('\n'));
  assertEquivalent(r.input, r.result);
});

test('GNF: S → AA | a, A → SS | b (Menezes 6.14)', () => {
  const r = run('gnf', 'S -> AA | a\nA -> SS | b');
  assert.ok(checkGnf(r.result).ok, checkGnf(r.result).violations.join('\n'));
  assertEquivalent(r.input, r.result, 7);
});

test('GNF: S → A | B | AB com e sem remoção de inúteis', () => {
  const off = run('gnf', SABC);
  assert.ok(checkGnf(off.result).ok, checkGnf(off.result).violations.join('\n'));
  assert.ok(!off.steps.some((s) => /inúteis|estéreis/i.test(s.title)), 'inúteis devem ficar de fora por padrão');
  assertEquivalent(off.input, off.result);

  const on = run('gnf', SABC, { removeUseless: true });
  assertShape(on.result, 'S -> bS | b');
  assertEquivalent(on.input, on.result);
});

test('GNF: recursão que reaparece na ε-livre repete as etapas 1 a 3', () => {
  const r = run('gnf', 'S -> BSc | d\nB -> b | ε');
  assert.ok(r.warnings.some((w) => /reapareceu/.test(w)));
  assert.ok(r.steps.some((s) => s.title.startsWith('Rodada 2')));
  assert.ok(checkGnf(r.result).ok, checkGnf(r.result).violations.join('\n'));
  assertEquivalent(r.input, r.result, 8);
});

test('GNF: S anulável', () => {
  const r = run('gnf', 'S -> aSb | SS | ε');
  assert.ok(checkGnf(r.result).ok, checkGnf(r.result).violations.join('\n'));
  assertEquivalent(r.input, r.result, 6);
});

// ─────────────────────────── linguagem vazia ───────────────────────────

test('linguagem vazia: todas as transformações completam e avisam', () => {
  const text = 'S -> LS | SL\nL -> aC | CL\nC -> La | a | b';
  assert.equal(isLanguageEmpty(g(text)), true);
  for (const kind of ['simplify', 'useless', 'epsilon', 'unit', 'left-recursion', 'cnf', 'gnf'] as const) {
    const r = run(kind, text);
    assert.ok(r.warnings.some((w) => /Linguagem vazia: o símbolo de partida S é estéril/.test(w)), kind);
    assert.equal(languageUpTo(r.result, 6).words.length, 0, kind);
  }
});

// ─────────────────────────── verificadores ───────────────────────────

test('equivalência aponta as palavras divergentes', () => {
  const r = compareUpTo(g('S -> aS | ε'), g('S -> aS | a'), 3);
  assert.equal(r.equivalent, false);
  assert.deepEqual(r.onlyA, ['']);
  assert.deepEqual(r.onlyB, []);
});

test('verificadores de forma indicam as alternativas que violam', () => {
  const x = g(ETF);
  assert.equal(checkCnf(x).ok, false);
  assert.equal(checkGnf(x).ok, false);
  assert.deepEqual(checkLeftRecursion(x).violations, ['E → E+T: recursão direta', 'T → T*F: recursão direta']);
  assert.deepEqual(nullableInfo(g('S -> AB\nA -> ε\nB -> A')).indirect, ['B', 'S']);
});

test('o resultado pode ser colado de volta (ida e volta pelo texto)', () => {
  const r = run('gnf', ETF);
  assertEquivalent(r.result, g(showCfg(r.result)));
  assert.ok(sameUpToRenaming(r.result, g(showCfg(r.result))));
});

// ─────────────────────────── exercícios de aula (examples.ts) ───────────────────────────

/** Resultado esperado da transformação sugerida, conferido pelo verificador de forma. */
function formOk(kind: TransformKind, x: Cfg): boolean {
  const f = checkForms(x);
  switch (kind) {
    case 'useless': return productiveRounds(x).productive.size === x.vars.filter((v) => altsOf(x, v).length).length;
    case 'epsilon': return f.epsFree.ok;
    case 'unit': return !x.prods.some((p) => p.rhs.length === 1 && varSet(x).has(p.rhs[0]));
    case 'simplify': return f.epsFree.ok;
    case 'left-recursion': return f.leftRecursion.ok;
    case 'factoring': return f.commonPrefix.ok;
    case 'cnf': return f.cnf.ok;
    case 'gnf': return f.gnf.ok;
  }
}

/** Respostas de referência (comparadas por equivalência até n, nunca por texto). */
const REFERENCIAS: Record<string, { text: string; n: number }> = {
  'rec-vazia': { n: 7, text: "S -> dBS' | BS'\nS' -> bS' | ε\nB -> bBB'\nB' -> dB' | ε" },
  lista: { n: 9, text: "S -> [L] | a\nL -> SL'\nL' -> SL' | ε" },
  fat2: { n: 7, text: "S -> aS' | c\nS' -> A | B | C\nA -> aA' | cA\nA' -> CA | ε\nB -> bB'\nB' -> B | C\nC -> aC | c" },
  'fat-f2': { n: 7, text: "A -> bA' | ca\nA' -> Ba | a | ε\nB -> bB' | c\nB' -> B | ε" },
  fat3: { n: 9, text: 'S -> bAS | a\nA -> bASA1 | aA2\nA1 -> aA3 | bAS\nA2 -> aA3 | bA4\nA3 -> A | ε\nA4 -> AS | ε' },
  'fat-f4': { n: 7, text: "S -> AB\nA -> aA'\nA' -> Bc | ε\nB -> bB'\nB' -> Sa | ε" },
  'cnf-c1': { n: 7, text: "S' -> AB\nS -> AB\nA -> XaY1 | a\nB -> XbY2 | b\nY1 -> BXc\nY2 -> SXa\nXa -> a\nXb -> b\nXc -> c" },
  'cnf-c4': { n: 7, text: "R' -> XY1 | CaY2 | CaCb | CbY3 | CbCa\nR -> XY1 | CaY2 | CaCb | CbY3 | CbCa\nT -> XY4 | XX | a | b\nX -> a | b\nY1 -> RX\nY2 -> TCb\nY3 -> TCa\nY4 -> TX\nCa -> a\nCb -> b" },
  'gnf-sabc': { n: 7, text: "S -> aB | aBB | bS | bSB | bB | bBB' | b\nB -> bBB' | bB\nB' -> aB' | a" },
  'gnf-g3': { n: 9, text: "S -> bLXe | iXqE\nL -> bLXeL' | iXqEL' | bLXe | iXqE\nL' -> ;SL' | ;S\nE -> ¬EE' | ¬E | iE' | i\nE' -> ∨EE' | ∨E\nXe -> e\nXq -> =" },
};
const LINGUAGEM_VAZIA = new Set(['rec-vazia', 'gnf-g4', 'vazia']);
const RECUSADOS = new Set(['fat-rec']);

test('exemplos: ids únicos, agrupados por tópico na ordem pedida', () => {
  assert.equal(new Set(GLC_EXAMPLES.map((e) => e.id)).size, GLC_EXAMPLES.length);
  assert.deepEqual(GLC_EXAMPLE_GROUPS.map((x) => x.label), ['Simplificação', 'Recursão à esquerda', 'Fatoração', 'CNF', 'GNF']);
  assert.equal(GLC_EXAMPLE_GROUPS.flatMap((x) => x.items).length, GLC_EXAMPLES.length);
  for (const id of Object.keys(REFERENCIAS)) assert.ok(GLC_EXAMPLES.some((e) => e.id === id), id);
});

for (const ex of GLC_EXAMPLES) {
  test(`exemplo ${ex.rotulo} (${ex.origem})`, () => {
    const parsed = parseCfg(ex.gramatica);
    assert.deepEqual(parsed.problems, [], 'o parser deve aceitar a gramática');
    const input = parsed.grammar!;
    const classResult = ex.gabaritoAula ? g(ex.gabaritoAula) : null;
    const r = runTransform(ex.transformacao, input, { classResult });

    if (RECUSADOS.has(ex.id)) {
      assert.match(r.refused ?? '', /recursão à esquerda/);
      assert.ok(r.warnings.some((w) => /recursão à esquerda/.test(w)));
      return;
    }
    assert.equal(r.refused, null);
    assert.equal(r.aborted, false, r.warnings.join(' | '));
    assert.ok(r.steps.length > 0);
    assert.ok(formOk(ex.transformacao, r.result), `forma de ${ex.transformacao} não atendida:\n${showCfg(r.result)}`);

    if (LINGUAGEM_VAZIA.has(ex.id)) {
      assert.ok(isLanguageEmpty(input));
      assert.ok(r.warnings.some((w) => /Linguagem vazia/.test(w)), 'aviso de linguagem vazia');
    } else {
      assert.equal(isLanguageEmpty(input), false);
      assertEquivalent(input, r.result, 7);
    }
    const ref = REFERENCIAS[ex.id];
    if (ref) assertEquivalent(g(ref.text), r.result, ref.n);
    if (classResult) assert.ok(r.steps.some((s) => s.highlight), 'o selo "em aula" deveria aparecer em algum passo');
  });
}

// ─────────────────────────── fatoração: como em aula × completa ───────────────────────────

const F1 = 'S -> aA | aB | C\nA -> CA | a\nB -> bB | bC\nC -> aC | c';

test('fatoração como em aula: F1 para em S\' -> A | B | C, com aviso', () => {
  const r = run('factoring', F1, { factoringMode: 'aula' });
  assertShape(r.result, "S -> aS' | c\nS' -> A | B | C\nA -> aA' | cA\nA' -> CA | ε\nB -> bB'\nB' -> B | C\nC -> aC | c");
  assert.deepEqual(r.result.vars, ['S', "S'", 'A', "A'", 'B', "B'", 'C']); // nomes e ordem de exibição
  assert.ok(r.warnings.includes("Ainda há prefixo indireto em S' (A e C podem começar com a ou c). A fatoração completa continua a partir daqui."),
    r.warnings.join('\n'));
  assertEquivalent(r.input, r.result);
});

test('fatoração completa: F1 unifica variáveis idênticas e exibe em ordem de criação', () => {
  const r = run('factoring', F1, { factoringMode: 'completa' });
  const uni = r.steps.find((s) => s.title === 'Unificar variáveis novas idênticas')!;
  assert.ok(uni, 'deveria haver o passo de unificação');
  assert.equal(uni, r.steps[r.steps.length - 1]);
  assert.deepEqual(uni.diff.removedVars, ['S4']);
  assert.deepEqual(r.result.vars, ['S', "S'", "S''", 'S3', 'A', "A'", 'B', "B'", 'C']);
  assert.equal(prefixConflicts(r.result).length, 0);
  assertEquivalent(r.input, r.result);
});

test('fatoração: F0 tem o selo "em aula" nas duas opções', () => {
  const ex = GLC_EXAMPLES.find((e) => e.id === 'fat1')!;
  for (const factoringMode of ['aula', 'completa'] as const) {
    const r = runTransform('factoring', g(ex.gramatica), { factoringMode, classResult: g(ex.gabaritoAula!) });
    assert.equal(r.steps.find((s) => s.highlight)?.title, 'Fatoração direta em A', factoringMode);
  }
});

test('fatoração: F3 equivalente até n = 9 nas duas opções', () => {
  for (const factoringMode of ['aula', 'completa'] as const) {
    const r = run('factoring', 'S -> bAS | a\nA -> SaA | SS | ab', { factoringMode });
    assertEquivalent(r.input, r.result, 9);
  }
});

test('nenhum resultado com variáveis novas idênticas (todos os exercícios, as duas opções)', () => {
  for (const ex of GLC_EXAMPLES) {
    for (const factoringMode of ['aula', 'completa'] as const) {
      for (const removeUseless of [false, true]) {
        const r = runTransform(ex.transformacao, g(ex.gramatica), { factoringMode, removeUseless });
        const fresh = r.result.vars.filter((v) => !r.input.vars.includes(v) && altsOf(r.result, v).length);
        const keys = fresh.map((v) => altsOf(r.result, v).map(showRhs).sort().join(' | '));
        assert.equal(new Set(keys).size, keys.length, `${ex.rotulo} (${factoringMode}): ${fresh.map((v, i) => `${v} → ${keys[i]}`).join('; ')}`);
      }
    }
  }
});

test('ordem de exibição: partida, originais na ordem da entrada, novas após a origem', () => {
  assert.deepEqual(run('epsilon', 'S -> bCDe | DC\nD -> dD | ε\nC -> cD | ε').result.vars, ["S'", 'S', 'D', 'C']);
  assert.deepEqual(run('left-recursion', ETF).result.vars, ['E', "E'", 'T', "T'", 'F']);
});
