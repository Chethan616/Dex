/**
 * Generative UI: the shapes the planner may emit, and the rules for when it
 * should.
 *
 * The model outputs a structured tree, never HTML or CSS. Every node here maps
 * onto a component DEX already draws — the same vendored rust-ui component the
 * hand-written screens use — which is the point: a generated table and a
 * hand-written one are the same table. Adding a component means adding a row
 * to COMPONENTS below and a branch in the client's renderer, nothing else.
 *
 * The client mirror is `RUST-APP/app/src/genui/spec.rs` and
 * `RUST-APP/app/src/genui/render.rs`. Keep all three together.
 *
 * ## Scope: display, not a live form
 *
 * Every input-shaped node (checkbox, slider, select, radio group, and so on)
 * renders a **read-only picture of a value** — a checked box, a chosen option,
 * a slider at a position — not a control wired back to the core. Building a
 * second, generated-UI submission channel alongside `submit`/`respond` is a
 * real feature with its own safety questions (an untrusted value arriving
 * through a new path needs the same confirmation-tier treatment every other
 * input gets) and is out of scope here. What ships is what the spec's own
 * examples actually need: showing structure, not collecting it. The one node
 * that *does* act is `confirmation`, and it acts through the existing
 * approval path, not a new one.
 *
 * A few components are deliberately not registry rows because a static tree
 * cannot honestly represent them: `dialog`/`drawer`/`sheet`/`popover`/
 * `hover_card`/`context_menu`/`command` open on a click or a hover that
 * nothing here can perform; `theme_toggle` is chrome, not content;
 * `animate`/`marquee`/`mask`/`expandable`/`faq_transition`/`pressable`/
 * `shimmer`/`direction_provider` are presentation wrappers with no content of
 * their own. `tooltip` and `disclosure` (built on `collapsible`) are kept
 * because a generated node can genuinely own "a hint on hover" or "collapsed
 * by default" without pretending to be interactive in a way it is not.
 */

/** What a component may be handed, and what it may contain. */
export interface ComponentSpec {
  /** The `type` string the planner emits. */
  type: string;
  /** One line for the planner: what this is for. */
  purpose: string;
  /** Property names this component reads. Anything else is ignored. */
  props: readonly string[];
  /** Node types allowed inside. Empty means a leaf. */
  children: readonly string[];
  /**
   * Whether the owner must approve before anything happens. Only
   * `confirmation` sets this; a card that merely describes a destructive act
   * is not an approval, and the real gate is the Orchestrator's, not the UI's.
   */
  requiresConfirmation: boolean;
  /** False for anything that is a building block rather than a whole reply. */
  userFacing: boolean;
}

/**
 * The registry.
 *
 * Generated into the planner prompt rather than restated there, so a component
 * cannot be documented in one place and missing from the other — the same rule
 * the capability catalogue follows.
 */
export const COMPONENTS: readonly ComponentSpec[] = [
  // ── prose ──────────────────────────────────────────────────────────────
  { type: 'text', purpose: 'A paragraph. The default, and usually the right answer.', props: ['text'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'markdown', purpose: 'Rich text with bold, italic, links, inline code and lists.', props: ['text'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'heading', purpose: 'A section title.', props: ['text', 'level'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'code', purpose: 'A code or command block.', props: ['text', 'language'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'list', purpose: 'A short bulleted list.', props: ['items'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'kbd', purpose: 'A keyboard key or shortcut, inline.', props: ['text'], children: [], requiresConfirmation: false, userFacing: false },
  { type: 'separator', purpose: 'A divider between sections.', props: [], children: [], requiresConfirmation: false, userFacing: false },

  // ── containers & layout ───────────────────────────────────────────────
  { type: 'group', purpose: 'Stacks children vertically. Use to combine, not to decorate.', props: [], children: ['*'], requiresConfirmation: false, userFacing: false },
  { type: 'grid', purpose: 'Lays children out in a responsive card grid (a bento layout).', props: ['columns'], children: ['card', 'group'], requiresConfirmation: false, userFacing: false },
  { type: 'card', purpose: 'One titled thing: a place, a product, a summary.', props: ['title', 'description'], children: ['*'], requiresConfirmation: false, userFacing: true },
  { type: 'accordion', purpose: 'Named sections the reader opens one at a time.', props: ['title'], children: ['accordion_item'], requiresConfirmation: false, userFacing: true },
  { type: 'accordion_item', purpose: 'One collapsible section, closed by default.', props: ['title', 'text'], children: ['*'], requiresConfirmation: false, userFacing: false },
  { type: 'tabs', purpose: 'Alternative views of the same thing, one visible at a time.', props: [], children: ['tab'], requiresConfirmation: false, userFacing: true },
  { type: 'tab', purpose: 'One tab and its content.', props: ['title'], children: ['*'], requiresConfirmation: false, userFacing: false },
  { type: 'disclosure', purpose: 'One collapsed detail the reader can open — a "show more".', props: ['title', 'text'], children: ['*'], requiresConfirmation: false, userFacing: true },
  { type: 'tooltip', purpose: 'A short label with a hint attached, shown on hover.', props: ['text', 'description'], children: [], requiresConfirmation: false, userFacing: false },
  { type: 'breadcrumb', purpose: 'Where this sits in a hierarchy — a path of names.', props: ['items'], children: [], requiresConfirmation: false, userFacing: false },

  // ── status & feedback ──────────────────────────────────────────────────
  { type: 'alert', purpose: 'Something the owner should notice.', props: ['title', 'description'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'error', purpose: 'Something went wrong, with what and why.', props: ['title', 'description'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'success', purpose: 'A finished action worth confirming visually.', props: ['title', 'description'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'callout', purpose: 'A short aside worth setting apart from the prose around it.', props: ['title', 'text', 'variant'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'toast', purpose: 'A brief, low-weight notice — read once, not dwelt on.', props: ['text', 'variant'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'empty', purpose: 'A search or list that came back with nothing.', props: ['title', 'description'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'status', purpose: 'A named state with a coloured indicator — online, failed, pending.', props: ['text', 'variant'], children: [], requiresConfirmation: false, userFacing: false },
  { type: 'loading', purpose: 'Work still in progress.', props: ['text'], children: [], requiresConfirmation: false, userFacing: false },
  { type: 'skeleton', purpose: 'A placeholder while data loads.', props: [], children: [], requiresConfirmation: false, userFacing: false },
  { type: 'progress', purpose: 'A determinate 0-100 bar.', props: ['title', 'value'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'badge', purpose: 'One short status word.', props: ['text', 'variant'], children: [], requiresConfirmation: false, userFacing: false },
  { type: 'chips', purpose: 'A set of short tags.', props: ['items'], children: [], requiresConfirmation: false, userFacing: true },

  // ── people & files ─────────────────────────────────────────────────────
  { type: 'avatar', purpose: 'A person or account, by initial or picture.', props: ['text', 'src'], children: [], requiresConfirmation: false, userFacing: false },
  { type: 'attachment', purpose: 'A file: name, kind and size, with an optional thumbnail.', props: ['title', 'description', 'src'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'image', purpose: 'A picture or screenshot.', props: ['src', 'alt', 'title'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'artifact', purpose: 'A result card: files found, or a document read. The same card the built-in file search draws.', props: ['title', 'items', 'description'], children: [], requiresConfirmation: false, userFacing: true },

  // ── structured data ────────────────────────────────────────────────────
  { type: 'table', purpose: 'Rows and columns. Use when comparing several things on several attributes.', props: ['title', 'columns', 'rows'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'data_grid', purpose: 'A dense, spreadsheet-like table for many rows.', props: ['title', 'columns', 'rows'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'pagination', purpose: 'A page indicator for a long list — decoration, not a live control.', props: ['value', 'label'], children: [], requiresConfirmation: false, userFacing: false },
  { type: 'area_chart', purpose: 'A trend over time.', props: ['title', 'values', 'labels'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'line_chart', purpose: 'A trend over time, unfilled.', props: ['title', 'values', 'labels'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'bar_chart', purpose: 'Comparing discrete categories.', props: ['title', 'values', 'labels'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'pie_chart', purpose: 'Parts of one whole. Only for a handful of slices.', props: ['title', 'values', 'labels'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'carousel', purpose: 'Several images or cards, one at a time.', props: ['title'], children: ['card', 'image'], requiresConfirmation: false, userFacing: true },

  // ── plans & conversation ───────────────────────────────────────────────
  { type: 'steps', purpose: 'An ordered plan, itinerary or checklist. Children are `step` nodes.', props: ['title'], children: ['step'], requiresConfirmation: false, userFacing: true },
  { type: 'step', purpose: 'One row of a plan.', props: ['text', 'description', 'status'], children: [], requiresConfirmation: false, userFacing: false },
  { type: 'stepper', purpose: 'A numbered, left-to-right wizard view of a short sequence.', props: ['title'], children: ['step'], requiresConfirmation: false, userFacing: true },
  { type: 'message', purpose: 'One turn of a conversation transcript being shown or summarised.', props: ['title', 'text', 'variant'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'marker', purpose: 'A single status line with an icon — "3 files found", "switched branch".', props: ['text', 'status'], children: [], requiresConfirmation: false, userFacing: false },

  // ── form fields (read-only pictures of a value; see the file header) ──
  { type: 'field', purpose: 'A labelled value — one line of a summary or a read-out form.', props: ['title', 'text'], children: [], requiresConfirmation: false, userFacing: true },
  { type: 'checkbox', purpose: 'One yes/no item, shown checked or not.', props: ['text', 'checked'], children: [], requiresConfirmation: false, userFacing: false },
  { type: 'switch', purpose: 'One on/off setting, shown as it stands.', props: ['text', 'checked'], children: [], requiresConfirmation: false, userFacing: false },
  { type: 'radio_group', purpose: 'One choice among named options, with the chosen one marked.', props: ['title', 'items', 'value'], children: [], requiresConfirmation: false, userFacing: false },
  { type: 'select', purpose: 'A chosen value from a set of options.', props: ['title', 'value', 'items'], children: [], requiresConfirmation: false, userFacing: false },
  { type: 'slider', purpose: 'A numeric value on a track, read-only.', props: ['title', 'value'], children: [], requiresConfirmation: false, userFacing: false },
  { type: 'date', purpose: 'A date or date range being shown, not picked.', props: ['title', 'text'], children: [], requiresConfirmation: false, userFacing: false },
  { type: 'form', purpose: 'A group of read-out fields presented together — a filled-in summary.', props: ['title', 'description'], children: ['field', 'checkbox', 'switch', 'radio_group', 'select', 'slider', 'date'], requiresConfirmation: false, userFacing: true },

  // ── action ─────────────────────────────────────────────────────────────
  { type: 'confirmation', purpose: 'Asks before something consequential. The only node that gates an action.', props: ['title', 'description', 'details'], children: [], requiresConfirmation: true, userFacing: true },
] as const;

export type UiNodeType = (typeof COMPONENTS)[number]['type'];

export interface UiNode {
  type: string;
  props?: Record<string, unknown>;
  children?: UiNode[];
}

export interface UiSpec {
  root: UiNode;
  /** Why structure was chosen. Not drawn; read when auditing restraint. */
  reason?: string;
}

/** Matches the client's caps, so a tree that renders here renders there. */
export const MAX_DEPTH = 6;
export const MAX_CHILDREN = 50;

/**
 * When the planner should emit UI, and — more often — when it should not.
 *
 * This is deliberately weighted towards *not*. The failure mode of a
 * generative interface is not too little UI, it is every answer becoming a
 * dashboard.
 */
export const RESTRAINT_RULES = `
Emit a ui spec ONLY when structure genuinely helps the owner understand or
decide. Plain text is the default and is correct for most replies.

Emit UI when:
- Comparing several things on several attributes -> table or data_grid
- Explaining a concept that has stages or parts -> steps, accordion, or card
- Planning something with an order to it: a trip, a timetable, a schedule -> steps or stepper
- Showing a quantity changing over time or split across categories -> a chart
- A search returned nothing -> empty
- Something failed and the owner needs to know what and why -> error
- Summarising a filled-in form or a set of settings -> form, with field/checkbox/switch/select/radio_group/slider/date children
- About to do something consequential -> confirmation

Do NOT emit UI when:
- The answer is a fact, a number, or a sentence. "What is 25 x 40?" is the
  text "1,000" and nothing else.
- The request is a task to perform on this machine. "Change the power plan to
  recommended", "change my DNS", "open Spotify" are executions. The owner gets
  the step stream and a sentence saying what happened. A card describing what
  was already done is noise.
- You are tempted to wrap one sentence in a card to make it look considered.
- The structure would restate what the prose already said.

Every field-shaped node (checkbox, switch, select, slider, radio_group, date)
shows a value — it is not a form the owner fills in through this pane. Do not
expect an answer back through one of these; ask a question in text instead.

Never emit more than one root node. Never nest deeper than ${MAX_DEPTH}.
Prefer the smallest component that carries the meaning.
`.trim();

/**
 * The registry, rendered for the planner prompt.
 *
 * Generated from COMPONENTS rather than written out again, so the prompt cannot
 * drift from what the renderer actually supports.
 */
export function catalogueForPrompt(): string {
  const lines = COMPONENTS.filter((c) => c.userFacing || c.children.length > 0).map((c) => {
    const props = c.props.length > 0 ? ` props: ${c.props.join(', ')}` : '';
    const kids = c.children.length > 0 ? ` children: ${c.children.join(', ')}` : '';
    return `- ${c.type}: ${c.purpose}${props}${kids}`;
  });
  return `${lines.join('\n')}\n\n${RESTRAINT_RULES}`;
}

const BY_TYPE = new Map(COMPONENTS.map((c) => [c.type, c]));

/**
 * Drop anything the renderer does not support, rather than passing it on.
 *
 * A spec is model output, so it is untrusted: an unknown type, an over-deep
 * tree or a hundred children are all things to fix here rather than to hand to
 * the client and hope. Returns undefined when nothing usable survives, which
 * the caller treats as "no UI", not as an error.
 */
export function validate(node: unknown, depth = 0): UiNode | undefined {
  if (depth >= MAX_DEPTH) return undefined;
  if (!node || typeof node !== 'object') return undefined;

  const raw = node as Record<string, unknown>;
  const type = typeof raw.type === 'string' ? raw.type : '';
  const spec = BY_TYPE.get(type);
  if (!spec) return undefined;

  const props: Record<string, unknown> = {};
  if (raw.props && typeof raw.props === 'object') {
    for (const key of spec.props) {
      const value = (raw.props as Record<string, unknown>)[key];
      if (value !== undefined) props[key] = value;
    }
  }

  const children: UiNode[] = [];
  if (Array.isArray(raw.children) && spec.children.length > 0) {
    const allowsAny = spec.children.includes('*');
    for (const child of raw.children.slice(0, MAX_CHILDREN)) {
      const kept = validate(child, depth + 1);
      if (!kept) continue;
      if (allowsAny || spec.children.includes(kept.type)) children.push(kept);
    }
  }

  return { type, props, ...(children.length > 0 ? { children } : {}) };
}
