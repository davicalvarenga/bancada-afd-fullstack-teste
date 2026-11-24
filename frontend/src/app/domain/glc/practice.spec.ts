/**
 * Testes do modo treino (correção da resposta do aluno): `npm test`.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Cfg, parseCfg, showCfg } from './cfg';
import { runTransform } from './transforms';
import { GLC_EXAMPLES } from './examples';
import { EMPTY_LANGUAGE_PRACTICE, GNF_EPS_NOTE, PracticeReport, checkAnswer } from './practice';

function g(text: string): Cfg {
  const r = parseCfg(text);
  assert.deepEqual(r.problems, []);
  return r.grammar!;
}

const ex = (id: string) => GLC_EXAMPLES.find((e) => e.id === id)!;

/** Confere a resposta para o exercício `id`, com a resolução da bancada e o gabarito de aula como na tela. */
function corrigir(id: string, resposta: string, n = 7): PracticeReport {
  const e = ex(id);
  const original = g(e.gramatica);
  const bancada = runTransform(e.transformacao, original).result;
  return checkAnswer(e.transformacao, original, resposta, { n, bancada, gabarito: e.gabaritoAula ? g(e.gabaritoAula) : null });
}

const erros = (r: PracticeReport) => r.issues.filter((i) => i.severity === 'erro').map((i) => i.message);
const avisos = (r: PracticeReport) => r.issues.filter((i) => i.severity === 'aviso').map((i) => i.message);

// ─────────────────────────── positivos: gabaritos de aula ───────────────────────────

// Gabaritos completos: entram como estão. F0 e F1 têm gabarito parcial (só as variáveis
// que mudam); a resposta é a gramática inteira, então eles vão completos.
const RESPOSTAS_AULA: Record<string, string> = {
  inuteis: ex('inuteis').gabaritoAula!,
  eps: ex('eps').gabaritoAula!,
  simples: ex('simples').gabaritoAula!,
  etf: ex('etf').gabaritoAula!,
  fat1: "S -> aS'\nS' -> aA'b | baA\nA -> aaA'\nA' -> b | ε",
  fat2: "S -> aS' | c\nS' -> A | B | C\nA -> aA' | cA\nA' -> CA | ε\nB -> bB'\nB' -> B | C\nC -> aC | c",
  cnf1: ex('cnf1').gabaritoAula!,
  'gnf-etf': ex('gnf-etf').gabaritoAula!,
};

for (const [id, resposta] of Object.entries(RESPOSTAS_AULA)) {
  test(`treino: gabarito de aula de ${ex(id).rotulo} passa`, () => {
    const r = corrigir(id, resposta);
    assert.deepEqual(r.parseProblems, []);
    assert.deepEqual(erros(r), []);
    assert.equal(r.formOk, true);
    assert.equal(r.language?.status, 'equivalente');
    assert.equal(r.verdict, 'pleno');
    assert.equal(r.comparison, 'gabarito');
  });
}

test('treino: F1 com S\' -> A | B | C passa com aviso de prefixo indireto', () => {
  const r = corrigir('fat2', RESPOSTAS_AULA.fat2);
  assert.equal(r.verdict, 'pleno');
  assert.deepEqual(avisos(r), ["S' → A e S' → C: A e C podem começar com a ou c; S' é variável nova, e na fatoração como em aula a substituição fica de fora (não reprova)."]);
  assert.deepEqual(erros(r), []);
});

test('treino: resposta igual à da bancada (com nomes diferentes) é reconhecida', () => {
  // GNF E/T/F com X1 no lugar de X: mesma resolução, outro nome
  const r = corrigir('gnf-etf', ex('gnf-etf').gabaritoAula!.replace(/X/g, 'Z'));
  assert.equal(r.verdict, 'pleno');
  assert.ok(r.comparison === 'gabarito' || r.comparison === 'bancada');
  // resposta equivalente, mas com forma diferente da resolução
  const d = corrigir('etf', "E -> TE' | T\nE' -> +TE' | +T\nT -> FT' | F\nT' -> *FT' | *F\nF -> (E) | a");
  assert.equal(d.verdict, 'pleno');
  assert.equal(d.comparison, 'diferente');
});

// ─────────────────────────── negativos ───────────────────────────

test('treino: CNF sem S\' quando S aparece à direita', () => {
  const r = corrigir('cnf1', "S -> AY | XB | a | SA | AS\nA -> b | AY | XB | a | SA | AS\nB -> b\nX -> a\nY -> SA");
  assert.equal(r.formOk, false);
  assert.ok(erros(r).includes('S → SA: usa o símbolo de partida à direita'), erros(r).join('\n'));
  assert.equal(r.verdict, 'pendente');
});

test('treino: CNF com terminal acompanhado (A -> aB)', () => {
  const r = corrigir('cnf1', "S' -> AY | aB | a | SA | AS\nS -> AY | aB | a | SA | AS\nA -> b | AY | aB | a | SA | AS\nB -> b\nY -> SA");
  assert.ok(erros(r).includes("S' → aB: terminal acompanhado"), erros(r).join('\n'));
});

test('treino: GNF com terminal no meio (F -> (E) | a)', () => {
  const r = corrigir('gnf-etf', ex('gnf-etf').gabaritoAula!.replace('F -> (EX | a', 'F -> (E) | a'));
  assert.ok(erros(r).includes('F → (E): terminal fora da 1ª posição'), erros(r).join('\n'));
  assert.equal(r.verdict, 'pendente');
});

test('treino: recursão sem o ε em A\' não é equivalente', () => {
  const r = corrigir('etf', "E -> TE'\nE' -> +TE'\nT -> FT'\nT' -> *FT' | ε\nF -> (E) | a");
  assert.equal(r.formOk, true); // a forma está certa: o erro é de linguagem
  assert.equal(r.language?.status, 'diverge');
  assert.ok(r.language!.onlyOriginal.includes('a'), r.language!.onlyOriginal.join(' '));
  assert.equal(r.verdict, 'pendente');
});

test('treino: ε-livre com alternativa vazia', () => {
  const r = corrigir('eps', "S' -> S | ε\nS -> bCDe | DC | bDe | be | bCe | C | D\nD -> dD | d | ε\nC -> cD | c");
  assert.ok(erros(r).includes('D → ε: produção vazia'), erros(r).join('\n'));
});

test('treino: ε-livre esquecendo um anulável', () => {
  // faltam as combinações sem C e sem D em S → bCDe
  const r = corrigir('eps', "S' -> S | ε\nS -> bCDe | DC | C | D\nD -> dD | d\nC -> cD | c");
  assert.equal(r.formOk, true);
  assert.equal(r.language?.status, 'diverge');
  assert.ok(r.language!.onlyOriginal.includes('be'), r.language!.onlyOriginal.join(' '));
});

test('treino: fatoração ainda com prefixo visível', () => {
  const r = corrigir('fat1', "S -> Ab | abaA\nA -> aab | aa");
  assert.ok(erros(r).some((m) => m === 'A → aab e A → aa: prefixo comum visível (a…).'), erros(r).join('\n'));
  assert.equal(r.verdict, 'pendente');
});

test('treino: resposta não equivalente mostra as palavras de cada lado', () => {
  const r = corrigir('simples', 'S -> aSb | ab | b');
  assert.equal(r.language?.status, 'diverge');
  assert.ok(r.language!.onlyOriginal.includes('ba'));
  assert.deepEqual(r.language!.onlyAnswer, []);
  const r2 = corrigir('simples', 'S -> aSb | ab | ba | b | bb');
  assert.ok(r2.language!.onlyAnswer.includes('bb'));
});

test('treino: produção simples e símbolos inúteis apontados por alternativa', () => {
  assert.ok(erros(corrigir('simples', 'S -> aSb | B | b\nB -> ab | ba')).includes('S → B: produção simples (A → B).'));
  const r = corrigir('inuteis', 'S -> aA\nA -> a | bB\nB -> b | dD\nD -> dD');
  assert.ok(erros(r).includes('D é estéril: nenhuma alternativa chega só a terminais.'), erros(r).join('\n'));
  assert.ok(erros(r).includes('B → dD: usa D, estéril.'));
});

test('treino: resposta que não é lida mostra o erro do parser', () => {
  const r = corrigir('simples', 'S aSb');
  assert.equal(r.parseProblems.length, 1);
  assert.equal(r.verdict, 'pendente');
});

// ─────────────────────────── linguagem vazia e GNF com ε ───────────────────────────

test('treino: linguagem original vazia → forma válida, linguagem não verificável', () => {
  for (const [id, resposta] of [
    ['rec-vazia', "S -> dBS' | BS'\nS' -> bS' | ε\nB -> bBB'\nB' -> dB' | ε"],
    ['gnf-g4', runTransform('gnf', g(ex('gnf-g4').gramatica)).result],
    ['vazia', runTransform('gnf', g(ex('vazia').gramatica)).result],
  ] as const) {
    const text = typeof resposta === 'string' ? resposta : showCfg(resposta);
    const r = corrigir(id, text);
    assert.equal(r.formOk, true, `${id}: ${erros(r).join(' | ')}`);
    assert.equal(r.language?.status, 'nao-verificavel');
    assert.deepEqual(r.language?.notes, [EMPTY_LANGUAGE_PRACTICE]);
    assert.equal(r.verdict, 'parcial', id); // não é acerto pleno
  }
});

test('treino: GNF ignora ε quando a original gera ε', () => {
  const original = g('S -> aSb | ε');
  const bancada = runTransform('gnf', original).result;
  // resposta sem ε nenhum: aceita, com aviso
  const r = checkAnswer('gnf', original, 'S -> aSX | aX\nX -> b', { bancada });
  assert.equal(r.formOk, true);
  assert.equal(r.language?.status, 'equivalente');
  assert.ok(r.language?.notes.includes(GNF_EPS_NOTE));
  assert.equal(r.verdict, 'pleno');
});


test('treino: comparação usa a opção de fatoração selecionada', () => {
  const e = ex('fat2');
  const original = g(e.gramatica);
  const completa = runTransform('factoring', original, { factoringMode: 'completa' }).result;
  const aula = runTransform('factoring', original, { factoringMode: 'aula' }).result;
  const resposta = showCfg(completa);
  // mesma resposta: igual à resolução "completa", diferente da "como em aula"
  assert.equal(checkAnswer('factoring', original, resposta, { bancada: completa }).comparison, 'bancada');
  assert.equal(checkAnswer('factoring', original, resposta, { bancada: aula }).comparison, 'diferente');
});

// ─────────────────────────── critério do prefixo indireto ───────────────────────────

test('treino: F1 com prefixo indireto em variáveis originais reprova com 2 erros (S e A)', () => {
  const r = corrigir('fat2', "S -> aS' | C\nS' -> A | B\nA -> CA | a\nB -> bB'\nB' -> B | C\nC -> aC | c");
  assert.deepEqual(erros(r), [
    "S → aS' e S → C: C pode começar com a. Substitua C e fatore (fatoração indireta).",
    'A → CA e A → a: C pode começar com a. Substitua C e fatore (fatoração indireta).',
  ]);
  assert.equal(r.formOk, false);
  assert.equal(r.verdict, 'pendente');
});

test('treino: gabarito de aula de F1 passa com 1 aviso (em S\')', () => {
  const r = corrigir('fat2', RESPOSTAS_AULA.fat2);
  assert.equal(avisos(r).length, 1);
  assert.ok(avisos(r)[0].startsWith("S' → A e S' → C"));
  assert.equal(r.verdict, 'pleno');
});

test('treino: prefixo indireto em variável nova é ERRO na fatoração completa', () => {
  const e = ex('fat2');
  const r = checkAnswer('factoring', g(e.gramatica), RESPOSTAS_AULA.fat2, { factoringMode: 'completa' });
  assert.deepEqual(avisos(r), []);
  assert.deepEqual(erros(r), ["S' → A e S' → C: A e C podem começar com a ou c. Substitua A e C e fatore (fatoração indireta)."]);
  assert.equal(r.verdict, 'pendente'); // equivalente, mas a fatoração está incompleta
  assert.equal(r.language?.status, 'equivalente');
});

test('treino: F0 continua passando nas duas opções', () => {
  for (const factoringMode of ['aula', 'completa'] as const) {
    const e = ex('fat1');
    const r = checkAnswer('factoring', g(e.gramatica), RESPOSTAS_AULA.fat1, { factoringMode });
    assert.equal(r.verdict, 'pleno', factoringMode);
  }
});
