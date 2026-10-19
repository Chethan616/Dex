/**
 * Gen-UI the agent shapes itself, beyond the fixed kit (shared/widgets.ts).
 *
 * Asked for "a hexagon graph of my personality", an agent rendered a PNG with
 * matplotlib and put a table in prose: nothing in the chat could draw it. Two
 * kinds close that gap, on the PC and the phone alike:
 *
 * - `chart`: radar (a hexagon for six axes), bar, line, area, pie, donut and
 *   gauge, drawn natively by each app in its own theme's colours.
 * - `custom`: anything else. The agent writes the HTML; each app renders it in
 *   a locked sandbox (scripts only, no app or network access beyond a CDN for
 *   libraries) with DEX's colours injected as `--dex-*` CSS variables, and
 *   `dex.reply(text)` / `dex.open(url)` to talk back.
 *
 * DEX can't rewrite its own installed code for a request (the desktop app is
 * packaged and the phone's is signed), so these are how it builds new UI on
 * the fly instead — themed, interactive, and the same on both screens.
 */
import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);

export const CHART_KINDS = ['radar', 'bar', 'line', 'area', 'pie', 'donut', 'gauge'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

const ChartSeriesSchema = z.object({
  name: text(40).optional(),
  values: z.array(z.number().finite()).min(1).max(24),
});

export const ChartWidgetSchema = z.object({
  type: z.literal('chart'),
  title: text(120).optional(),
  note: text(300).optional(),
  kind: z.enum(CHART_KINDS),
  labels: z.array(text(40)).min(1).max(24),
  series: z.array(ChartSeriesSchema).min(1).max(4),
  /** The scale's top: radar rings and gauges run 0..max (default: the data's own max, rounded up). */
  max: z.number().positive().finite().optional(),
  unit: text(12).optional(),
}).superRefine((w, ctx) => {
  w.series.forEach((s, i) => {
    if (s.values.length !== w.labels.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['series', i, 'values'], message: `has ${s.values.length} values for ${w.labels.length} labels — one value per label` });
    }
  });
  if (w.kind === 'radar' && w.labels.length < 3) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['labels'], message: 'a radar needs at least 3 axes' });
  if ((w.kind === 'pie' || w.kind === 'donut' || w.kind === 'gauge') && w.series.length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['series'], message: `a ${w.kind} takes one series` });
  }
});
export type ChartWidget = z.infer<typeof ChartWidgetSchema>;

/** The HTML an agent may send: big enough for a real interface, small enough for the chat and the phone sync. */
export const CUSTOM_HTML_MAX = 60_000;

export const CustomWidgetSchema = z.object({
  type: z.literal('custom'),
  title: text(120).optional(),
  html: z.string().min(1).max(CUSTOM_HTML_MAX),
  /** A starting height in px; the frame then follows its content. */
  height: z.number().int().min(80).max(1200).optional(),
});
export type CustomWidget = z.infer<typeof CustomWidgetSchema>;

/**
 * The colours a custom widget is given, as CSS variables. Each app fills them
 * from its own theme (light or dark), so a widget written once looks native on
 * both. Names here are the contract ui.md documents.
 */
export const DEX_TOKENS = [
  'bg', 'surface', 'surface-2', 'line', 'fg', 'muted', 'accent', 'accent-fg', 'good', 'warn', 'bad',
  'series-1', 'series-2', 'series-3', 'series-4',
] as const;
export type DexTokens = Record<(typeof DEX_TOKENS)[number], string>;

/* ── Reading what agents write ─────────────────────────────────────── */

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const firstOf = (o: Loose, ...keys: string[]): unknown => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== '');
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[%,\s]/g, '')) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

const KIND_ALIASES: Record<string, ChartKind> = {
  radar: 'radar', spider: 'radar', web: 'radar', hexagon: 'radar', hexagonal: 'radar', polygon: 'radar', star: 'radar', polar: 'radar',
  bar: 'bar', bars: 'bar', column: 'bar', columns: 'bar', histogram: 'bar',
  line: 'line', lines: 'line', trend: 'line', timeline: 'line',
  area: 'area',
  pie: 'pie',
  donut: 'donut', doughnut: 'donut', ring: 'donut',
  gauge: 'gauge', meter: 'gauge', dial: 'gauge', progress: 'gauge',
};

/**
 * A chart spec from the shapes agents write: `data` as [{label, value}] or a
 * plain map, `scores`/`dimensions`/`axes`, one series as bare `values`,
 * `datasets` (Chart.js), and kind names like hexagon, spider or doughnut.
 */
export function normalizeChart(raw: Loose): Loose {
  const w: Loose = { ...raw, type: 'chart' };
  const given = String(firstOf(raw, 'kind', 'chart', 'chartType', 'style', 'shape') ?? '').toLowerCase();
  w.kind = KIND_ALIASES[given] ?? (given || undefined);

  let labels = firstOf(raw, 'labels', 'axes', 'categories', 'dimensions', 'keys');
  let series = firstOf(raw, 'series', 'datasets');
  const data = firstOf(raw, 'data', 'scores', 'points', 'items', 'values');

  // A map: {"Problem-solving": 9, "Learning": 9, …}
  if (labels === undefined && isObj(data)) {
    labels = Object.keys(data);
    series = [{ values: Object.values(data) }];
  }
  // A list of rows: [{label, value}] or [{name, score}]
  if (Array.isArray(data) && data.length && isObj(data[0])) {
    const rows = data as Loose[];
    if (labels === undefined) labels = rows.map((r) => String(firstOf(r, 'label', 'name', 'dimension', 'axis', 'key', 'x') ?? ''));
    if (series === undefined) series = [{ values: rows.map((r) => firstOf(r, 'value', 'score', 'y', 'v', 'count')) }];
  }
  // Labels given as objects (axes with names).
  if (Array.isArray(labels)) labels = labels.map((l) => (isObj(l) ? String(firstOf(l, 'label', 'name', 'title') ?? '') : String(l)));
  // One series as a bare array of numbers.
  if (series === undefined && Array.isArray(data) && data.every((v) => typeof v === 'number' || typeof v === 'string')) series = [{ values: data }];
  if (Array.isArray(series)) {
    series = (series as unknown[]).map((s) => {
      if (Array.isArray(s)) return { values: s.map(num) };
      if (!isObj(s)) return s;
      const vals = firstOf(s, 'values', 'data', 'scores', 'points');
      return { name: firstOf(s, 'name', 'label', 'title'), values: Array.isArray(vals) ? vals.map((v) => (isObj(v) ? num(firstOf(v, 'value', 'y')) : num(v))) : vals };
    });
  }
  if (isObj(series)) series = [series];
  w.labels = labels;
  w.series = series;
  const max = num(firstOf(raw, 'max', 'scale', 'outOf', 'out_of', 'maxValue'));
  if (max !== undefined) w.max = max; else delete w.max;
  for (const k of ['data', 'scores', 'points', 'items', 'values', 'axes', 'categories', 'dimensions', 'keys', 'datasets', 'chart', 'chartType', 'style', 'shape', 'scale', 'outOf', 'out_of', 'maxValue']) delete w[k];
  if (w.note === undefined) w.note = firstOf(raw, 'subtitle', 'caption', 'description');
  if (w.note === undefined) delete w.note;
  return w;
}

/** A custom spec: the HTML may arrive as `html`, `content`, `body` or `markup`. */
export function normalizeCustom(raw: Loose): Loose {
  const w: Loose = { type: 'custom' };
  const html = firstOf(raw, 'html', 'content', 'body', 'markup', 'source');
  if (html !== undefined) w.html = html;
  if (raw.title !== undefined) w.title = raw.title;
  const h = num(raw.height);
  if (h !== undefined) w.height = Math.round(Math.max(80, Math.min(1200, h)));
  return w;
}

/** The scale a chart is drawn against: its max, or the data's top rounded to a tidy step. */
export function chartMax(w: ChartWidget): number {
  if (w.max) return w.max;
  const top = Math.max(0, ...w.series.flatMap((s) => s.values));
  if (top <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(top));
  return Math.ceil(top / step) * step;
}

export function chartLine(w: ChartWidget): string {
  const s = w.series[0];
  const best = s.values.reduce((bi, v, i) => (v > s.values[bi] ? i : bi), 0);
  return w.title ?? `${w.kind} chart · ${w.labels.length} ${w.labels.length === 1 ? 'value' : 'values'}, highest ${w.labels[best]}`;
}

/** The page a custom widget runs in: CSP, the tokens, the bridge, then the agent's HTML. */
export function customDocument(html: string, tokens: DexTokens, frameId: string, font = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'): string {
  const vars = DEX_TOKENS.map((k) => `--dex-${k}:${tokens[k]};`).join('');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: https:; style-src 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src data: https://fonts.gstatic.com https://cdn.jsdelivr.net; script-src 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'none'; frame-src 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>:root{${vars}--dex-radius:14px;--dex-font:${font};color-scheme:light dark}
html,body{margin:0;padding:0;background:transparent;color:var(--dex-fg);font-family:var(--dex-font);font-size:14px;line-height:1.45}
*{box-sizing:border-box}button{font:inherit;cursor:pointer}a{color:var(--dex-accent)}</style>
<script>(function(){var id=${JSON.stringify(frameId)};function send(m){m.dexFrame=id;try{parent.postMessage(m,'*')}catch(e){}try{window.DexBridge&&window.DexBridge.post(JSON.stringify(m))}catch(e){}}
window.dex={reply:function(t){if(typeof t==='string'&&t.trim())send({kind:'reply',text:t.slice(0,2000)})},open:function(u){if(typeof u==='string'&&/^https?:\\/\\//i.test(u))send({kind:'open',url:u})}};
function size(){send({kind:'height',height:Math.ceil(document.documentElement.scrollHeight)})}
window.addEventListener('load',size);new ResizeObserver(size).observe(document.documentElement);
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(a){e.preventDefault();window.dex.open(a.href)}});})();</script>
</head><body>${html}</body></html>`;
}
