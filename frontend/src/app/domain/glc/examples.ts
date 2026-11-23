/** Exemplos pré-carregados no seletor da página GLC (os casos do enunciado). Dado estático. */
import { TransformKind } from './transforms';

export interface GlcExample {
  id: string;
  label: string;
  grammar: string;
  transform: TransformKind;
  note: string;
  /** Resultado visto em aula (pode ser parcial); o passo que coincidir com ele é destacado. */
  classResult?: string;
}

export interface GlcExampleGroup { label: string; items: GlcExample[] }

const ETF = 'E -> E+T | T\nT -> T*F | F\nF -> (E) | a';
const SABC = 'S -> A | B | AB\nA -> aB | bS | b\nB -> bB | Ba';

export const GLC_EXAMPLE_GROUPS: GlcExampleGroup[] = [
  {
    label: 'Simplificação',
    items: [
      { id: 'inuteis', label: 'Inúteis · S → aA, …, D → dD', transform: 'useless',
        grammar: 'S -> aA\nA -> a | bB\nB -> b | dD\nC -> cC | c\nD -> dD',
        note: 'D é estéril; C é inalcançável. Resultado: S → aA, A → a | bB, B → b.' },
      { id: 'eps', label: 'ε-livre · S → bCDe | DC', transform: 'epsilon',
        grammar: 'S -> bCDe | DC\nD -> dD | ε\nC -> cD | ε',
        note: 'Anuláveis {D, C, S}: como S é anulável, nasce S\' → S | ε.' },
      { id: 'simples', label: 'Simples · S → aSb | B | b', transform: 'unit',
        grammar: 'S -> aSb | B | b\nB -> ab | ba',
        note: 'fecho(S) = {B}: S → B vira S → ab | ba.' },
      { id: 'vazia', label: 'Linguagem vazia · S → LS | SL', transform: 'simplify',
        grammar: 'S -> LS | SL\nL -> aC | CL\nC -> La | a | b',
        note: 'S é estéril: L(G) = ∅. A transformação segue de forma mecânica.' },
    ],
  },
  {
    label: 'Recursão à esquerda',
    items: [
      { id: 'etf', label: 'E → E+T | T (expressões)', transform: 'left-recursion', grammar: ETF,
        note: 'Recursão direta em E e T: E → TE\', E\' → +TE\' | ε, …' },
      { id: 'lista', label: 'S → [L] | a, L → LS | S', transform: 'left-recursion',
        grammar: 'S -> [L] | a\nL -> LS | S',
        note: 'L → LS | S vira L → SL\', L\' → SL\' | ε.' },
      { id: 'rec-vazia', label: 'S → D | B, D → dB | Sb (vazia)', transform: 'left-recursion',
        grammar: 'S -> D | B\nD -> dB | Sb\nB -> bB | Bd',
        note: 'Recursão indireta (S ⇒ D ⇒ Sb) e direta (B → Bd); a linguagem é vazia, mas a transformação completa.' },
    ],
  },
  {
    label: 'Fatoração à esquerda',
    items: [
      { id: 'fat1', label: 'S → Ab | abaA, A → aab | aa', transform: 'factoring',
        grammar: 'S -> Ab | abaA\nA -> aab | aa',
        note: 'Direta: A → aaA\', A\' → b | ε. Indireta: S → aS\', S\' → aA\'b | baA.',
        classResult: "S -> aS'\nS' -> aA'b | baA\nA -> aaA'\nA' -> b | ε" },
      { id: 'fat2', label: 'S → aA | aB | C, …', transform: 'factoring',
        grammar: 'S -> aA | aB | C\nA -> CA | a\nB -> bB | bC\nC -> aC | c',
        note: 'C começa com a: S → aS\' | c, S\' → A | B | C, e as novas continuam sendo fatoradas.',
        classResult: "S -> aS' | c\nS' -> A | B | C" },
      { id: 'fat3', label: 'S → bAS | a, A → SaA | SS | ab', transform: 'factoring',
        grammar: 'S -> bAS | a\nA -> SaA | SS | ab',
        note: 'Exige fatorar as variáveis novas várias vezes.' },
      { id: 'fat-rec', label: 'Com recursão (recusada)', transform: 'factoring',
        grammar: 'S -> A | B | AB\nA -> aB | bS | b\nB -> bB | Ba | C\nC -> AS | AB | b',
        note: 'B → Ba é recursiva à esquerda: a fatoração é recusada até a recursão sair.' },
    ],
  },
  {
    label: 'Forma Normal de Chomsky',
    items: [
      { id: 'cnf1', label: 'S → ASA | aB, A → B | S, B → b | ε', transform: 'cnf',
        grammar: 'S -> ASA | aB\nA -> B | S\nB -> b | ε',
        note: 'Resultado esperado: S\' → AY | XB | a | SA | AS, …, X → a, Y → SA.' },
      { id: 'cnf2', label: 'E → E+E | E*E | [E] | x', transform: 'cnf',
        grammar: 'E -> E+E | E*E | [E] | x',
        note: 'Terminais acompanhados (+, *, [, ]) viram variáveis.' },
    ],
  },
  {
    label: 'Forma Normal de Greibach',
    items: [
      { id: 'gnf-etf', label: 'E → E+T | T (expressões)', transform: 'gnf', grammar: ETF,
        note: 'Recursão → ε-livre → simples → substituição de baixo para cima → X → ).' },
      { id: 'gnf-menezes', label: 'S → AA | a, A → SS | b (Menezes 6.14)', transform: 'gnf',
        grammar: 'S -> AA | a\nA -> SS | b',
        note: 'Recursão indireta: A → SS → AAS.' },
      { id: 'gnf-sabc', label: 'S → A | B | AB (B estéril)', transform: 'gnf', grammar: SABC,
        note: 'Com “remover símbolos inúteis” ligado, o resultado é S → bS | b.' },
    ],
  },
];

export const GLC_EXAMPLES: GlcExample[] = GLC_EXAMPLE_GROUPS.flatMap((g) => g.items);
