/**
 * The Generative UI validator.
 *
 * A spec is model output, so it is untrusted. These cover the things a model
 * actually gets wrong — an invented component, a tree that never ends, a
 * hundred children, props nobody declared — and check they are dropped here
 * rather than handed to the client and hoped about.
 *
 * Run: npm run test:genui
 */
import {
  COMPONENTS,
  MAX_CHILDREN,
  MAX_DEPTH,
  catalogueForPrompt,
  validate,
} from '../core/genui/schema';

let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('Generative UI schema');

// --- what should survive ---

const text = validate({ type: 'text', props: { text: '1,000' } });
check('a plain text node survives intact', text?.props?.text === '1,000');

const table = validate({
  type: 'table',
  props: { title: 'Products', columns: ['Name', 'Price'], rows: [['A', '1'], ['B', '2']] },
});
check(
  'a table keeps its columns and rows',
  Array.isArray(table?.props?.rows) && (table?.props?.rows as unknown[]).length === 2,
);

// --- what should not ---

check(
  'an invented component is dropped',
  validate({ type: 'holographic_dashboard', props: {} }) === undefined,
);

const stripped = validate({
  type: 'text',
  props: { text: 'hi', onClick: 'rm -rf /', style: 'position:fixed' },
});
check(
  'undeclared props are stripped',
  JSON.stringify(stripped?.props) === JSON.stringify({ text: 'hi' }),
  JSON.stringify(stripped?.props),
);

let deep: unknown = { type: 'text', props: { text: 'bottom' } };
for (let i = 0; i < MAX_DEPTH + 3; i += 1) deep = { type: 'group', children: [deep] };
let depth = 0;
let cursor = validate(deep);
while (cursor?.children?.[0]) {
  depth += 1;
  cursor = cursor.children[0];
}
check(`a tree deeper than ${MAX_DEPTH} is truncated`, depth < MAX_DEPTH, `nested ${depth}`);

const many = validate({
  type: 'group',
  children: Array.from({ length: MAX_CHILDREN + 25 }, (_, i) => ({
    type: 'text',
    props: { text: String(i) },
  })),
});
check(
  `children beyond ${MAX_CHILDREN} are dropped`,
  (many?.children?.length ?? 0) <= MAX_CHILDREN,
  String(many?.children?.length),
);

const steps = validate({
  type: 'steps',
  props: { title: 'Trip' },
  children: [
    { type: 'step', props: { text: 'Fly to Tokyo' } },
    { type: 'table', props: { columns: [], rows: [] } },
  ],
});
check(
  'a child the container does not allow is refused',
  steps?.children?.length === 1 && steps.children[0]?.type === 'step',
);

check(
  'nonsense input is no UI rather than an error',
  validate(null) === undefined &&
    validate('a string') === undefined &&
    validate({}) === undefined &&
    validate({ type: 42 }) === undefined,
);

// --- the contract with the planner ---

const gating = COMPONENTS.filter((c) => c.requiresConfirmation).map((c) => c.type);
check(
  'confirmation is the only node that gates an action',
  gating.length === 1 && gating[0] === 'confirmation',
  gating.join(', '),
);

const catalogue = catalogueForPrompt();
const missing = COMPONENTS.filter((c) => c.userFacing).filter(
  (c) => !catalogue.includes(`- ${c.type}:`),
);
check(
  'every user-facing component reaches the prompt catalogue',
  missing.length === 0,
  missing.map((c) => c.type).join(', '),
);
check(
  'the restraint rules travel with the catalogue',
  catalogue.includes('Plain text is the default') && catalogue.includes('change my DNS'),
);

console.log(failed > 0 ? `\n${failed} failed` : '\nall passed');
process.exit(failed > 0 ? 1 : 0);
