import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteNavComponent } from '../../shared/site-nav.component';
import { SymBarComponent } from '../../shared/sym-bar.component';
import { ThemeService } from '../../core/services/theme.service';
import { Cfg, Step, cfgLines, parseCfg, prodKey, showCfg, showProd, showRhs, terminalsOf } from '../../domain/glc/cfg';
import { DEFAULT_MAX_LEN, EquivalenceReport, FormCheck, checkForms, compareUpTo } from '../../domain/glc/checks';
import { TRANSFORMS, TransformKind, TransformResult, runTransform } from '../../domain/glc/transforms';
import { GLC_EXAMPLES, GLC_EXAMPLE_GROUPS } from '../../domain/glc/examples';

const STORE_KEY = 'bancada-glc-v1';
const MAX_N = 10;
const KINDS = new Set<string>(TRANSFORMS.map((t) => t.id));

interface Saved { example: string; grammar: string; kind: TransformKind; epsFree: boolean; useless: boolean; n: number }

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
      n,
    };
  } catch { return null; }
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
}
interface CheckRow { label: string; input: FormCheck; output: FormCheck }

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
      return { r: runTransform(this.kind(), g, { epsFreeRecursion: this.epsFree(), removeUseless: this.useless(), classResult }), error: null };
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
    return [
      { label: 'Forma Normal de Chomsky', input: a.cnf, output: b.cnf },
      { label: 'Forma Normal de Greibach', input: a.gnf, output: b.gnf },
      { label: 'ε-livre', input: a.epsFree, output: b.epsFree },
      { label: 'Sem recursão à esquerda', input: a.leftRecursion, output: b.leftRecursion },
      { label: 'Sem prefixo comum', input: a.commonPrefix, output: b.commonPrefix },
    ];
  });
  readonly equivalence = computed<EquivalenceReport | null>(() => {
    const r = this.run().r;
    return r && !r.refused ? compareUpTo(r.input, r.result, this.n()) : null;
  });
  readonly words = words;

  constructor() {
    effect(() => {
      const data: Saved = {
        example: this.exampleId(), grammar: this.grammarText(), kind: this.kind(),
        epsFree: this.epsFree(), useless: this.useless(), n: this.n(),
      };
      try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* modo privado */ }
    });
  }

  // ─── ações ───
  selectExample(id: string): void {
    const ex = GLC_EXAMPLES.find((e) => e.id === id);
    this.exampleId.set(id);
    if (!ex) return; // "personalizada": mantém o texto
    this.grammarText.set(ex.gramatica);
    this.kind.set(ex.transformacao); // abre a aba sugerida; tudo roda no navegador
  }
  editGrammar(v: string): void { this.grammarText.set(v); }
  setN(v: string): void {
    const x = Math.trunc(Number(v));
    if (Number.isFinite(x)) this.n.set(Math.min(MAX_N, Math.max(0, x)));
  }
  /** Leva o resultado para a entrada, para encadear transformações. */
  useResult(): void {
    const r = this.run().r;
    if (!r) return;
    this.grammarText.set(showCfg(r.result).replace(/ → /g, ' -> '));
    this.exampleId.set('');
  }
}
