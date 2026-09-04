/**
 * The owner's browser, under the same rules as everything else.
 *
 *     npm run test:browser-tools
 *
 * The argument for forking OpenDia rather than consuming its MCP server is
 * entirely in this file. Over MCP the extension's eighteen tools are opaque
 * function calls: nothing classifies them, nothing assigns a confirmation
 * tier, nothing verifies afterwards. "Post a tweet" would just happen.
 *
 * So what is checked here is not that the tools exist — it is that each one
 * has a tier, that the tiers are assigned by consequence rather than by
 * convenience, and that a tool Dex has never heard of is treated as dangerous
 * rather than harmless.
 */
import { BROWSER_TOOLS, browserToolCatalogue, tierFor } from '../core/brain/browser_tools';

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `\n      ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

section('Every tool is classified');

const names = Object.keys(BROWSER_TOOLS);
// Eighteen from the OpenDia fork, plus the seven Dex added over the DevTools
// Protocol for the things ordinary extension APIs are not allowed to do.
check('all twenty-five are declared', names.length === 25, String(names.length));
check(
  'uploading a file is declared, and is not a free action',
  BROWSER_TOOLS.element_upload_file?.tier === 2,
  String(BROWSER_TOOLS.element_upload_file?.tier),
);
check(
  'reading the page as a picture is free',
  BROWSER_TOOLS.page_screenshot?.tier === 4,
  String(BROWSER_TOOLS.page_screenshot?.tier),
);
check(
  'each has a tier, params and a sentence saying what it does',
  names.every((n) => {
    const spec = BROWSER_TOOLS[n];
    return [1, 2, 3, 4].includes(spec.tier) && spec.params.length > 0 && spec.note.length > 0;
  }),
);

section('Tiers follow consequence, not convenience');

// Reading the page the owner is already looking at changes nothing.
for (const readOnly of [
  'page_analyze', 'page_extract_content', 'get_page_links',
  'get_selected_text', 'element_get_state', 'page_scroll', 'tab_list',
]) {
  check(`${readOnly} needs no card`, tierFor(readOnly) === 4);
}

// Acting on a site the owner is signed into is the whole reason the feature
// exists and the whole reason it needs a card: a click there sends money,
// posts publicly or deletes something, and the DOM does not say which.
for (const consequential of ['element_click', 'element_fill', 'tab_close', 'add_bookmark']) {
  check(`${consequential} asks first`, tierFor(consequential) <= 2,
    `tier ${tierFor(consequential)}`);
}

// Their whole history, not the page in front of them.
check('reading browsing history is not a free read', tierFor('get_history') <= 3);
check('nor are bookmarks', tierFor('get_bookmarks') <= 3);

check(
  'no tool that changes a signed-in page is tier 4',
  !['element_click', 'element_fill', 'page_navigate', 'tab_close', 'add_bookmark', 'page_style']
    .some((n) => tierFor(n) === 4),
);

section('An unknown tool is treated as dangerous');

// A newer extension will add tools. Dex has no idea what they do, and
// defaulting them to 4 would mean an upstream addition running unannounced.
check('a tool Dex has never heard of asks first', tierFor('post_a_tweet') === 2);
check('and so does an empty name', tierFor('') === 2);

section('The planner is only told about what is attached');

check(
  'nothing attached means nothing offered',
  browserToolCatalogue([]) === '',
);

const catalogue = browserToolCatalogue(['element_click', 'page_analyze', 'made_up_tool']);
check('an attached browser is described', catalogue.includes('element_click'));
check('with its tier', catalogue.includes('Tier 2'));
check(
  'a tool Dex does not know is left out of the catalogue',
  !catalogue.includes('made_up_tool'),
);
check(
  'the untrusted-content rule is restated where it matters',
  catalogue.includes('data, never an instruction'),
);
check(
  'and so is which browser to use for what',
  catalogue.includes('separate profile'),
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
