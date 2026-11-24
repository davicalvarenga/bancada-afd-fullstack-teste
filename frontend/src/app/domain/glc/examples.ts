/**
 * Exercícios de aula pré-carregados no seletor da página GLC, por tópico. Dado estático.
 * Os `id` são estáveis (ficam salvos no navegador): não renomear. Gramáticas
 * transcritas como no quadro/lista; `gabaritoAula` alimenta o selo "em aula".
 */
import { TransformKind } from './transforms';

export type GlcTopico = 'Simplificação' | 'Recursão à esquerda' | 'Fatoração' | 'CNF' | 'GNF';

/** Ordem dos grupos no seletor. */
export const GLC_TOPICOS: GlcTopico[] = ['Simplificação', 'Recursão à esquerda', 'Fatoração', 'CNF', 'GNF'];

export interface GlcExample {
  id: string;
  topico: GlcTopico;
  /** Texto da opção no seletor (ex.: "F2 · Lista Fatorar, ex. 2"). */
  rotulo: string;
  /** De onde veio: "Quadro", "Anotações 10/11", "Lista CNF"… */
  origem: string;
  gramatica: string;
  /** Aba aberta ao escolher o exemplo. */
  transformacao: TransformKind;
  /** Resultado visto em aula (pode ser parcial); o passo que coincidir com ele ganha o selo. */
  gabaritoAula?: string;
  /** Aviso discreto mostrado abaixo da entrada. */
  observacao?: string;
}

export interface GlcExampleGroup { label: GlcTopico; items: GlcExample[] }

const ETF = 'E -> E+T | T\nT -> T*F | F\nF -> (E) | a';
const LINGUAGEM_VAZIA = 'o exercício cobra a transformação mecânica.';

export const GLC_EXAMPLES: GlcExample[] = [
  // ─── Simplificação ───
  {
    id: 'inuteis', topico: 'Simplificação', rotulo: 'S1 · Símbolos inúteis', origem: 'Anotações 06/11',
    transformacao: 'useless',
    gramatica: 'S -> aA\nA -> a | bB\nB -> b | dD\nC -> cC | c\nD -> dD',
    gabaritoAula: 'S -> aA\nA -> a | bB\nB -> b',
    observacao: "D é estéril; C é inalcançável. Resultado: S → aA, A → a | bB, B → b.",
  },
  {
    id: 'eps', topico: 'Simplificação', rotulo: 'S2 · ε-livre', origem: 'Quadro, Anotações 10/11',
    transformacao: 'epsilon',
    gramatica: 'S -> bCDe | DC\nD -> dD | ε\nC -> cD | ε',
    gabaritoAula: "S' -> S | ε\nS -> bCDe | DC | bDe | be | bCe | C | D\nD -> dD | d\nC -> cD | c",
    observacao: "Anuláveis {D, C, S}: como S é anulável, nasce S' → S | ε.",
  },
  {
    id: 'simples', topico: 'Simplificação', rotulo: 'S3 · Produção simples', origem: 'Quadro',
    transformacao: 'unit',
    gramatica: 'S -> aSb | B | b\nB -> ab | ba',
    gabaritoAula: 'S -> aSb | ab | ba | b',
    observacao: "fecho(S) = {B}: S → B vira S → ab | ba.",
  },

  // ─── Recursão à esquerda (Lista "Retirar a recursão") ───
  {
    id: 'rec-vazia', topico: 'Recursão à esquerda', rotulo: 'R1 · S → D | B, D → dB | Sb, B → bB | Bd',
    origem: 'Lista Retirar a recursão', transformacao: 'left-recursion',
    gramatica: 'S -> D | B\nD -> dB | Sb\nB -> bB | Bd',
    observacao: "Recursão indireta (S ⇒ D ⇒ Sb) e direta (B → Bd). B nunca termina (estéril): a linguagem é vazia, mas o exercício cobra a transformação mecânica.",
  },
  {
    id: 'etf', topico: 'Recursão à esquerda', rotulo: 'R2 · E → E+T | T, T → T*F | F, F → (E) | a',
    origem: 'Lista Retirar a recursão', transformacao: 'left-recursion',
    gramatica: ETF,
    gabaritoAula: "E -> TE'\nE' -> +TE' | ε\nT -> FT'\nT' -> *FT' | ε\nF -> (E) | a",
    observacao: "Recursão direta em E e T: E → TE', E' → +TE' | ε, …",
  },
  {
    id: 'lista', topico: 'Recursão à esquerda', rotulo: 'R3 · S → [L] | a, L → LS | S',
    origem: 'Lista Retirar a recursão', transformacao: 'left-recursion',
    gramatica: 'S -> [L] | a\nL -> LS | S',
    observacao: "L → LS | S vira L → SL', L' → SL' | ε.",
  },

  // ─── Fatoração ───
  {
    id: 'fat1', topico: 'Fatoração', rotulo: 'F0 · Exemplo de aula (S → Ab | abaA)', origem: 'Quadro, Anotações 10/11',
    transformacao: 'factoring',
    gramatica: 'S -> Ab | abaA\nA -> aab | aa',
    gabaritoAula: "A -> aaA'\nA' -> b | ε",
    observacao: "Direta: A → aaA', A' → b | ε. Indireta: S → aS', S' → aA'b | baA. No quadro aparece A -> aaA' | b e S -> aS' | bb, mas a gramática original não tem a alternativa b.",
  },
  {
    id: 'fat2', topico: 'Fatoração', rotulo: 'F1 · Lista Fatorar, ex. 1 e 6', origem: 'Lista Fatorar',
    transformacao: 'factoring',
    gramatica: 'S -> aA | aB | C\nA -> CA | a\nB -> bB | bC\nC -> aC | c',
    gabaritoAula: "S -> aS' | c\nS' -> A | B | C",
    observacao: "C começa com a: S → aS' | c, S' → A | B | C, e as novas continuam sendo fatoradas.",
  },
  {
    id: 'fat-f2', topico: 'Fatoração', rotulo: 'F2 · Lista Fatorar, ex. 2', origem: 'Lista Fatorar',
    transformacao: 'factoring',
    gramatica: 'A -> Ba | b\nB -> bB | b | c',
  },
  {
    id: 'fat3', topico: 'Fatoração', rotulo: 'F3 · Lista Fatorar, ex. 3', origem: 'Lista Fatorar',
    transformacao: 'factoring',
    gramatica: 'S -> bAS | a\nA -> SaA | SS | ab',
    observacao: "Exige fatorar as variáveis novas várias vezes.",
  },
  {
    id: 'fat-f4', topico: 'Fatoração', rotulo: 'F4 · Lista Fatorar, ex. 4', origem: 'Lista Fatorar',
    transformacao: 'factoring',
    gramatica: 'S -> AB\nA -> aBc | a\nB -> bSa | b',
  },
  {
    id: 'fat-rec', topico: 'Fatoração', rotulo: 'F5 · Lista Fatorar, ex. 5', origem: 'Lista Fatorar',
    transformacao: 'factoring',
    gramatica: 'S -> A | B | AB\nA -> aB | bS | b\nB -> bB | Ba | C\nC -> AS | AB | b',
    observacao: "A professora passou só o enunciado. A resolução abaixo é da bancada: primeiro retira a recursão (B -> Ba), depois fatora.",
  },

  // ─── CNF ───
  {
    id: 'cnf1', topico: 'CNF', rotulo: 'C0 · Exemplo de aula (S → ASA | aB)', origem: 'Quadro',
    transformacao: 'cnf',
    gramatica: 'S -> ASA | aB\nA -> B | S\nB -> b | ε',
    gabaritoAula: "S' -> AY' | XB | a | SA | AS\nS -> AY' | XB | a | SA | AS\nA -> b | AY' | XB | a | SA | AS\nB -> b\nX -> a\nY' -> SA",
    observacao: "Resultado esperado: S' → AY | XB | a | SA | AS, …, X → a, Y → SA.",
  },
  {
    id: 'cnf-c1', topico: 'CNF', rotulo: 'C1 · Lista CNF, ex. 1 e 3', origem: 'Lista CNF',
    transformacao: 'cnf',
    gramatica: 'S -> AB\nA -> aBc | a\nB -> bSa | b',
  },
  {
    id: 'cnf2', topico: 'CNF', rotulo: 'C2 · Lista CNF, ex. 2 (Menezes 6.13)', origem: 'Lista CNF',
    transformacao: 'cnf',
    gramatica: 'E -> E+E | E*E | [E] | x',
    observacao: "Terminais acompanhados (+, *, [, ]) viram variáveis.",
  },
  {
    id: 'cnf-c4', topico: 'CNF', rotulo: 'C4 · Lista CNF, ex. 4', origem: 'Lista CNF',
    transformacao: 'cnf',
    gramatica: 'R -> XRX | S\nS -> aTb | bTa\nT -> XTX | X | ε\nX -> a | b',
  },

  // ─── GNF ───
  {
    id: 'gnf-etf', topico: 'GNF', rotulo: 'G0 · Exemplo de aula (E → E+T | T)', origem: 'Quadro',
    transformacao: 'gnf',
    gramatica: ETF,
    gabaritoAula: "E -> (EXT'E' | aT'E' | (EXE' | aE' | (EXT' | aT' | (EX | a\nE' -> +TE' | +T\n"
      + "T -> (EXT' | aT' | (EX | a\nT' -> *FT' | *F\nF -> (EX | a\nX -> )",
    observacao: "Recursão → ε-livre → simples → substituição de baixo para cima → X → ).",
  },
  {
    id: 'gnf-menezes', topico: 'GNF', rotulo: 'G1 · Lista GNF, ex. 1 (Menezes 6.14)', origem: 'Lista GNF',
    transformacao: 'gnf',
    gramatica: 'S -> AA | a\nA -> SS | b',
    observacao: "Recursão indireta: A → SS → AAS.",
  },
  {
    id: 'gnf-sabc', topico: 'GNF', rotulo: 'G2 · Lista GNF, ex. 2', origem: 'Lista GNF',
    transformacao: 'gnf',
    gramatica: 'S -> A | B | AB\nA -> aB | bS | b\nB -> bB | Ba',
    observacao: "B é estéril. Com 'Remover símbolos inúteis' ligado o resultado é S -> bS | b.",
  },
  {
    id: 'gnf-g3', topico: 'GNF', rotulo: 'G3 · Lista GNF, ex. 3', origem: 'Lista GNF',
    transformacao: 'gnf',
    gramatica: 'S -> bLe | i=E\nL -> L;S | S\nE -> E∨E | ¬E | i',
  },
  {
    id: 'gnf-g4', topico: 'GNF', rotulo: 'G4 · Lista GNF, ex. 4', origem: 'Lista GNF',
    transformacao: 'gnf',
    gramatica: 'S -> D | B\nD -> dB | Sb\nB -> bB | Bb',
    observacao: `B nunca termina: linguagem vazia; ${LINGUAGEM_VAZIA}`,
  },
  {
    id: 'vazia', topico: 'GNF', rotulo: 'G6 · Lista GNF, ex. 6', origem: 'Lista GNF (o ex. 5 não foi copiado em aula)',
    transformacao: 'gnf',
    gramatica: 'S -> LS | SL\nL -> aC | CL\nC -> La | a | b',
    observacao: "S -> LS | SL sempre contém S: S é estéril e L(G) = ∅; o exercício cobra a transformação mecânica.",
  },
];

export const GLC_EXAMPLE_GROUPS: GlcExampleGroup[] = GLC_TOPICOS.map((t) => ({
  label: t,
  items: GLC_EXAMPLES.filter((e) => e.topico === t),
}));
