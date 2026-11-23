/**
 * Conteúdo do aviso de novidades. Para a próxima atualização: troque `versao`
 * (quem já viu a anterior vê de novo) e edite as listas.
 */
export type NovidadeIcone = 'exercicios' | 'barra' | 'separar' | 'resolucao' | 'automato' | 'simbolo' | 'teoria' | 'pdf' | 'arvore' | 'glc';

export interface Novidade {
  icone: NovidadeIcone;
  titulo: string;
  texto: string;
  link?: { path: string; label: string };
}

export const NOVIDADES = {
  versao: '2026-11-23.1',
  quando: 'Novembro de 2026',
  mudou: [
    {
      icone: 'barra',
      titulo: 'GLC entra na barra',
      texto: 'As páginas no topo agora são seis: GLC fica ao lado de Derivações. No celular, continuam no botão ⋯.',
      link: { path: '/glc', label: 'Abrir' },
    },
    {
      icone: 'teoria',
      titulo: 'Página inicial com três atalhos',
      texto: 'Ao lado de Teoria e Exercícios, um card leva direto às Transformações de GLC.',
      link: { path: '/', label: 'Ver' },
    },
  ] as Novidade[],
  novo: [
    {
      icone: 'glc',
      titulo: 'Transformações de GLC passo a passo',
      texto: 'Inúteis, ε-livre, simples, recursão, fatoração, Chomsky e Greibach pelo método da aula, com o que muda em cada passo.',
      link: { path: '/glc', label: 'Abrir' },
    },
    {
      icone: 'exercicios',
      titulo: 'Confira a sua resposta',
      texto: 'Verificador de forma (CNF, GNF, ε-livre, recursão, prefixo comum) e equivalência até n palavras.',
      link: { path: '/glc', label: 'Testar' },
    },
  ] as Novidade[],
};
