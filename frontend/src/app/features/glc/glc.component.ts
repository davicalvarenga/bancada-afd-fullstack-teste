import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteNavComponent } from '../../shared/site-nav.component';
import { SymBarComponent } from '../../shared/sym-bar.component';
import { ThemeService } from '../../core/services/theme.service';
import { Cfg, Step, altsOf, cfgLines, parseCfg, prodKey, showCfg, showProd, showRhs, terminalsOf } from '../../domain/glc/cfg';
import { DEFAULT_MAX_LEN, EquivalenceReport, FormCheck, checkForms, compareUpTo } from '../../domain/glc/checks';
import { TRANSFORMS, TransformKind, TransformResult, resolveFactoring, runTransform } from '../../domain/glc/transforms';
import { GLC_EXAMPLES, GLC_EXAMPLE_GROUPS } from '../../domain/glc/examples';
import { PracticeIssue, PracticeReport, checkAnswer, factoringBasis, formIssues } from '../../domain/glc/practice';
import { FactoringMode } from '../../domain/glc/factoring';

const STORE_KEY = 'bancada-glc-v1';
const MAX_N = 10;
const KINDS = new Set<string>(TRANSFORMS.map((t) => t.id));

interface Saved { example: string; grammar: string; kind: TransformKind; epsFree: boolean; useless: boolean; n: number; factoringMode: FactoringMode }

/** Estado salvo no navegador: entrada não confiável, então só tipos esperados e com teto. */
function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Record<keyof Saved, unknown>>;
    const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
    const n = typeof v.n === 'number' && Number.isInteger(v.n) ? Math.min(MAX_N, Math.max(0, v.n)) : DEFAULT_MAX_LEN;
    return {
      example: str(v.example, 40),
      grammar: str(v.grammar, 4000),
      kind: (typeof v.kind === 'string' && KINDS.has(v.kind) ? v.kind : 'simplify') as TransformKind,
      epsFree: v.epsFree === true,
      useless: v.useless === true,
      factoringMode: v.factoringMode === 'completa' ? 'completa' : 'aula', // padrão da tela: como em aula
      n,
    };
  } catch { return null; }
}

// ─── modo treino: estado próprio, numa chave nova e versionada ───
const TREINO_KEY = 'bancada-glc-treino-v1';
const EXAMPLE_IDS = new Set(GLC_EXAMPLES.map((e) => e.id));
interface TreinoEntry { resposta: string; ok: boolean }
interface TreinoStore { ativo: boolean; respostas: Record<string, TreinoEntry> }

/** Respostas salvas: entrada não confiável, então só ids conhecidos, tipos esperados e com teto. */
function loadTreino(): TreinoStore {
  const empty: TreinoStore = { ativo: false, respostas: {} };
  try {
    const raw = localStorage.getItem(TREINO_KEY);
    if (!raw) return empty;
    const v = JSON.parse(raw) as { ativo?: unknown; respostas?: unknown };
    const respostas: Record<string, TreinoEntry> = {};
    if (v.respostas && typeof v.respostas === 'object') {
      for (const [id, e] of Object.entries(v.respostas as Record<string, unknown>)) {
        const entry = e as { resposta?: unknown; ok?: unknown } | null;
        if (EXAMPLE_IDS.has(id) && entry && typeof entry.resposta === 'string') {
          respostas[id] = { resposta: entry.resposta.slice(0, 4000), ok: entry.ok === true };
        }
      }
    }
    return { ativo: v.ativo === true, respostas };
  } catch { return empty; }
}

/** Veredito do treino. Nunca diz "correta": equivalência até n não é prova. */
function verdictLabel(rep: PracticeReport, kind: TransformKind): string {
  if (rep.parseProblems.length) return 'A resposta não pôde ser lida.';
  if (rep.verdict === 'pleno') return `✓ Forma válida e equivalente à gramática original até n = ${rep.language?.maxLen}.`;
  if (rep.verdict === 'parcial') return 'Forma válida; linguagem não verificável.';
  if (!rep.formOk && rep.language?.status === 'equivalente') {
    return kind === 'factoring' ? 'Equivalente, mas a fatoração está incompleta.' : 'Equivalente, mas a forma pedida ainda tem erros.';
  }
  return 'Ainda há o que corrigir.';
}

/**
 * Recalcula os ✓ salvos com o critério atual (as respostas ficam como estão). Usa a
 * transformação sugerida de cada exercício e o n e o modo de fatoração salvos.
 */
function recheckSaved(store: TreinoStore, n: number, factoringMode: FactoringMode): TreinoStore {
  const respostas: Record<string, TreinoEntry> = {};
  for (const [id, e] of Object.entries(store.respostas)) {
    const ex = GLC_EXAMPLES.find((x) => x.id === id);
    const original = ex ? parseCfg(ex.gramatica).grammar : null;
    let ok = false;
    if (ex && original && e.resposta.trim()) {
      try { ok = checkAnswer(ex.transformacao, original, e.resposta, { n, factoringMode }).verdict === 'pleno'; } catch { ok = false; }
    }
    respostas[id] = { resposta: e.resposta, ok };
  }
  return { ...store, respostas };
}

const braces = (xs: readonly string[]) => `{${xs.join(', ')}}`;
const words = (xs: readonly string[]) => braces(xs.slice(0, 12).map((w) => w || 'ε')) + (xs.length > 12 ? ` … (+${xs.length - 12})` : '');

/**
 * Conjunto de símbolos vira {A, B}; sequência (ordem) vira "A, B"; itens que são
 * frases (S → C, FIRST(A) = {a}) viram lista separada por ";", sem chaves em volta.
 */
function setText(label: string, items: readonly string[]): string {
  if (!items.length) return '∅';
  if (label.startsWith('Ordem')) return items.join(', ');
  return items.some((i) => i.includes(' ')) ? items.join('; ') : braces(items);
}

interface AltView { text: string; added: boolean }
interface LineView { lhs: string; isNew: boolean; alts: AltView[] }
interface StepView {
  title: string;
  explanation: string;
  sets: { label: string; text: string }[];
  lines: LineView[];
  removed: string[];
  newVars: string[];
  warnings: string[];
  highlight: string | null;
  stage: string | null;
}
/** Célula da tabela de verificações: erros reprovam; avisos (ex.: prefixo indireto) não. */
interface CheckCell { ok: boolean; violations: string[]; warnings: string[] }
interface CheckRow { label: string; current: boolean; input: CheckCell; output: CheckCell }
const fromCheck = (f: FormCheck): CheckCell => ({ ok: f.ok, violations: f.violations, warnings: [] });
const fromIssues = (xs: PracticeIssue[]): CheckCell => ({
  ok: !xs.some((i) => i.severity === 'erro'),
  violations: xs.filter((i) => i.severity === 'erro').map((i) => i.message),
  warnings: xs.filter((i) => i.severity === 'aviso').map((i) => i.message),
});

function linesOf(g: Cfg, added: Set<string>, newVars: Set<string>): LineView[] {
  return cfgLines(g).map((l) => ({
    lhs: l.lhs,
    isNew: newVars.has(l.lhs),
    alts: l.alts.map((rhs) => ({ text: showRhs(rhs), added: added.has(prodKey({ lhs: l.lhs, rhs })) })),
  }));
}

function stepView(s: Step): StepView {
  return {
    title: s.title,
    // o destaque vira um selo no topo do passo; não repete a frase no fim da explicação
    explanation: s.highlight && s.explanation.endsWith(s.highlight) ? s.explanation.slice(0, -s.highlight.length).trimEnd() : s.explanation,
    sets: s.sets.map((x) => ({ label: x.label, text: setText(x.label, x.items) })),
    lines: linesOf(s.grammar, new Set(s.diff.added.map(prodKey)), new Set(s.diff.newVars)),
    removed: s.diff.removed.map(showProd),
    newVars: s.diff.newVars,
    warnings: s.warnings,
    highlight: s.highlight ?? null,
    stage: s.stage ?? null,
  };
}

/**
 * Transformações de GLC passo a passo. A tela só lê a gramática, escolhe a
 * transformação e mostra o que o motor puro (domain/glc) devolve: os passos,
 * o que mudou em cada um, as verificações de forma e a equivalência até n.
 */
@Component({
  selector: 'app-glc',
  standalone: true,
  imports: [RouterLink, SiteNavComponent, SymBarComponent],
  templateUrl: './glc.component.html',
  styleUrl: './glc.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlcComponent {
  readonly theme = inject(ThemeService);
  readonly groups = GLC_EXAMPLE_GROUPS;
  readonly transforms = TRANSFORMS;
  readonly maxN = MAX_N;

  private readonly saved = load();
  readonly exampleId = signal(this.saved?.example ?? GLC_EXAMPLES[0].id);
  readonly grammarText = signal(this.saved?.grammar ?? GLC_EXAMPLES[0].gramatica);
  readonly kind = signal<TransformKind>(this.saved?.kind ?? GLC_EXAMPLES[0].transformacao);
  readonly epsFree = signal(this.saved?.epsFree ?? false);
  readonly useless = signal(this.saved?.useless ?? false);
  readonly factoringMode = signal<FactoringMode>(this.saved?.factoringMode ?? 'aula');
  readonly n = signal(this.saved?.n ?? DEFAULT_MAX_LEN);

  /** O exemplo só vale enquanto o texto não for editado ("personalizada" depois). */
  readonly example = computed(() => {
    const ex = GLC_EXAMPLES.find((e) => e.id === this.exampleId());
    return ex && ex.gramatica === this.grammarText() ? ex : null;
  });
  readonly info = computed(() => TRANSFORMS.find((t) => t.id === this.kind())!);

  // ─── gramática ───
  readonly parsed = computed(() => parseCfg(this.grammarText()));
  readonly tuple = computed(() => {
    const g = this.parsed().grammar;
    return g ? { n: braces(g.vars), t: braces(terminalsOf(g)), s: g.start } : null;
  });

  // ─── transformação ───
  readonly run = computed<{ r: TransformResult | null; error: string | null }>(() => {
    const g = this.parsed().grammar;
    if (!g) return { r: null, error: null };
    const ex = this.example();
    const classResult = ex?.gabaritoAula ? parseCfg(ex.gabaritoAula).grammar : null;
    try {
      const opts = { epsFreeRecursion: this.epsFree(), removeUseless: this.useless(), factoringMode: this.factoringMode(), classResult };
      // fatoração com recursão à esquerda: resolução em duas etapas (recursão, depois fatoração)
      return { r: this.kind() === 'factoring' ? resolveFactoring(g, opts) : runTransform(this.kind(), g, opts), error: null };
    } catch (e) {
      return { r: null, error: e instanceof Error ? e.message : String(e) };
    }
  });
  readonly steps = computed(() => this.run().r?.steps.map(stepView) ?? []);
  readonly finalLines = computed(() => {
    const r = this.run().r;
    return r ? linesOf(r.result, new Set(), new Set()) : [];
  });

  // ─── verificações ───
  readonly checks = computed<CheckRow[]>(() => {
    const r = this.run().r;
    if (!r) return [];
    const a = checkForms(r.input);
    const b = checkForms(r.result);
    const k = this.kind();
    // todas as verificações; a(s) da transformação atual sobem para o topo, destacadas
    const rows: (Omit<CheckRow, 'current'> & { kinds: TransformKind[] })[] = [
      { label: 'Sem símbolos inúteis', kinds: ['useless', 'simplify'], input: fromIssues(formIssues('useless', r.input)), output: fromIssues(formIssues('useless', r.result)) },
      { label: 'ε-livre', kinds: ['epsilon', 'simplify'], input: fromCheck(a.epsFree), output: fromCheck(b.epsFree) },
      { label: 'Sem produções simples', kinds: ['unit', 'simplify'], input: fromIssues(formIssues('unit', r.input)), output: fromIssues(formIssues('unit', r.result)) },
      { label: 'Sem recursão à esquerda', kinds: ['left-recursion'], input: fromCheck(a.leftRecursion), output: fromCheck(b.leftRecursion) },
      {
        // mesmo critério do treino: indireto em variável original = erro; em variável nova, depende do modo
        label: 'Sem prefixo comum', kinds: ['factoring'],
        input: fromIssues(formIssues('factoring', r.input)),
        output: fromIssues(formIssues('factoring', r.result, { originals: new Set(r.input.vars.filter((v) => altsOf(r.input, v).length)), factoringMode: this.factoringMode() })),
      },
      { label: 'Forma Normal de Chomsky', kinds: ['cnf'], input: fromCheck(a.cnf), output: fromCheck(b.cnf) },
      { label: 'Forma Normal de Greibach', kinds: ['gnf'], input: fromCheck(a.gnf), output: fromCheck(b.gnf) },
    ];
    const out = rows.map(({ kinds, ...row }) => ({ ...row, current: kinds.includes(k) }));
    return [...out.filter((x) => x.current), ...out.filter((x) => !x.current)];
  });
  readonly equivalence = computed<EquivalenceReport | null>(() => {
    const r = this.run().r;
    return r && !r.refused ? compareUpTo(r.input, r.result, this.n()) : null;
  });
  readonly words = words;

  // ─── modo treino ───
  private readonly treinoStore = signal<TreinoStore>(recheckSaved(loadTreino(), this.n(), this.factoringMode()));
  readonly treino = computed(() => this.treinoStore().ativo);
  readonly answer = signal(this.treinoStore().respostas[this.exampleId()]?.resposta ?? '');
  readonly report = signal<PracticeReport | null>(null);
  readonly showSolution = signal(false);
  /** Exercícios com forma válida + equivalência até n (o ✓ do seletor). */
  readonly doneIds = computed(() => new Set(Object.entries(this.treinoStore().respostas).filter(([, e]) => e.ok).map(([id]) => id)));
  readonly verdictLabel = verdictLabel;
  readonly comparisonText = computed(() => {
    const rep = this.report();
    if (!rep?.comparison) return null;
    if (rep.comparison === 'gabarito') return 'Igual ao gabarito de aula.';
    if (rep.comparison === 'bancada') return 'Igual à resolução da bancada (as variáveis novas podem ter outro nome).';
    return rep.language?.status === 'nao-verificavel'
      ? 'Forma diferente da resolução: compare as duas.'
      : `Equivalente até n = ${rep.language?.maxLen}, com forma diferente da resolução.`;
  });

  constructor() {
    effect(() => {
      const data = this.treinoStore();
      try { localStorage.setItem(TREINO_KEY, JSON.stringify(data)); } catch { /* modo privado */ }
    });
    effect(() => {
      const data: Saved = {
        example: this.exampleId(), grammar: this.grammarText(), kind: this.kind(),
        epsFree: this.epsFree(), useless: this.useless(), n: this.n(), factoringMode: this.factoringMode(),
      };
      try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* modo privado */ }
    });
  }

  // ─── ações ───
  selectExample(id: string): void {
    const ex = GLC_EXAMPLES.find((e) => e.id === id);
    this.exampleId.set(id);
    this.resetPractice();
    if (!ex) return; // "personalizada": mantém o texto
    this.grammarText.set(ex.gramatica);
    this.kind.set(ex.transformacao); // abre a aba sugerida; tudo roda no navegador
    this.answer.set(this.treinoStore().respostas[ex.id]?.resposta ?? '');
  }
  editGrammar(v: string): void { this.grammarText.set(v); this.report.set(null); }
  setKind(k: TransformKind): void { this.kind.set(k); this.report.set(null); }
  setN(v: string): void {
    const x = Math.trunc(Number(v));
    if (Number.isFinite(x)) this.n.set(Math.min(MAX_N, Math.max(0, x)));
    this.report.set(null);
  }

  // ─── ações: modo treino ───
  setTreino(on: boolean): void {
    this.treinoStore.update((s) => ({ ...s, ativo: on }));
    this.resetPractice();
  }
  editAnswer(v: string): void {
    this.answer.set(v);
    this.report.set(null);
    const ex = this.example();
    if (ex) this.saveAnswer(ex.id, { resposta: v, ok: false }); // o ✓ só volta depois de conferir de novo
  }
  /** Confere a resposta contra a gramática da entrada, na transformação da aba atual. */
  check(): void {
    const g = this.parsed().grammar;
    if (!g) return;
    const ex = this.example();
    const r = this.run().r;
    const gabarito = ex?.gabaritoAula && ex.transformacao === this.kind() ? parseCfg(ex.gabaritoAula).grammar : null;
    // na fatoração, a base é a resolução da opção escolhida (ou "como em aula", se a completa não termina)
    const basis = this.kind() === 'factoring'
      ? factoringBasis(g, { epsFreeRecursion: this.epsFree(), factoringMode: this.factoringMode() })
      : { factoringMode: this.factoringMode(), bancada: r && !r.refused ? r.result : null, notes: [] };
    const rep = checkAnswer(this.kind(), g, this.answer(), { n: this.n(), gabarito, ...basis });
    this.report.set(rep);
    if (ex) this.saveAnswer(ex.id, { resposta: this.answer(), ok: rep.verdict === 'pleno' });
  }
  private saveAnswer(id: string, entry: TreinoEntry): void {
    this.treinoStore.update((s) => ({ ...s, respostas: { ...s.respostas, [id]: entry } }));
  }
  private resetPractice(): void {
    this.report.set(null);
    this.showSolution.set(false);
  }
  /** Leva o resultado para a entrada, para encadear transformações. */
  useResult(): void {
    const r = this.run().r;
    if (!r) return;
    this.grammarText.set(showCfg(r.result).replace(/ → /g, ' -> '));
    this.exampleId.set('');
  }
}
