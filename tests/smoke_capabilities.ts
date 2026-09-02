import './support/isolate';
import * as fs from 'fs';
import * as path from 'path';
/**
 * What the planner is told it can do.
 *
 *   npm run test:capabilities
 *
 * `capabilities.ts` exists because two hand-maintained lists drifted: the
 * Brain's prompt advertised actions the daemon did not implement. Its header
 * says so.
 *
 * It happened again, inside that same file, one level up. `planner.ts` listed
 * nine capability names in its schema enum; `capabilityCatalogue()` described
 * four. So `can_browse_web`, `can_access_email`, `can_access_calendar` and
 * `can_access_drive` were all legal values the model was never shown a single
 * action for — and the browser agent, built and verified and registered, was
 * invisible to planning for three slices.
 *
 * These checks are the guard rail. The enum is now generated from the
 * catalogue, and this asserts they agree, that every capability names actions,
 * and that the prompt still fits in the budget it has to fit in.
 */
import {
  ACTIONS_BY_CAPABILITY,
  CAPABILITY_NAMES,
  FILE_ACTIONS,
  OS_ACTIONS,
  OS_ACTION_NAMES,
  ROUTING_RULES,
  WEB_ACTIONS,
  capabilityCatalogue,
} from '../core/brain/capabilities';
import { isReadShaped } from '../core/orchestrator/orchestrator';
import { renderFacts, worthPhrasing } from '../core/brain/answer';
import { normaliseTitle } from '../core/reliability/verification_policy';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`ok   ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

const catalogue = capabilityCatalogue();

// ---------------------------------------------------------------------------
// The drift that started this
// ---------------------------------------------------------------------------

console.log('— the enum and the catalogue must agree —');

for (const name of CAPABILITY_NAMES) {
  // can_run_workflow is described by workflowCatalogue(), which only has
  // content when workflows are saved, so it is exempt from the prompt check.
  if (name === 'can_run_workflow') continue;
  check(
    `${name} is described in the prompt`,
    catalogue.includes(name),
    'the model may name it but has never been told what it does',
  );
}

for (const name of CAPABILITY_NAMES) {
  if (name === 'can_run_workflow') continue;
  const actions = ACTIONS_BY_CAPABILITY[name];
  check(`${name} names at least one action`, Array.isArray(actions) && actions.length > 0);
}

check(
  'every documented capability is a legal enum value',
  (catalogue.match(/^CAPABILITY: (can_\w+)/gm) ?? [])
    .flatMap((line) => line.replace('CAPABILITY: ', '').split(' / '))
    .every((name) => (CAPABILITY_NAMES as readonly string[]).includes(name.trim())),
);

// ---------------------------------------------------------------------------
// The capability that was missing entirely
// ---------------------------------------------------------------------------

console.log('\n— the web is reachable —');

check('can_browse_web is in the catalogue', catalogue.includes('CAPABILITY: can_browse_web'));
check('with run_task, for anything needing judgement', 'run_task' in WEB_ACTIONS);
check('and navigate, for going somewhere specific', 'navigate' in WEB_ACTIONS);
check('and screenshot', 'screenshot' in WEB_ACTIONS);
check(
  'the routing rules send web work to it, not to a launched browser',
  /can_browse_web/.test(ROUTING_RULES) && /Never launch_app a browser/.test(ROUTING_RULES),
  'without this the planner opens Chrome and clicks through it',
);

// ---------------------------------------------------------------------------
// The new capability surface
// ---------------------------------------------------------------------------

console.log('\n— the 25 use cases have actions to reach —');

const needed: [string, Record<string, unknown>][] = [
  ['run_command', OS_ACTIONS],
  ['classify_command', OS_ACTIONS],
  ['capture_screen', OS_ACTIONS],
  ['get_env', OS_ACTIONS],
  ['set_env', OS_ACTIONS],
  ['get_display', OS_ACTIONS],
  ['set_display', OS_ACTIONS],
  ['get_brightness', OS_ACTIONS],
  ['set_brightness', OS_ACTIONS],
  ['read_file', FILE_ACTIONS],
  ['list_dir', FILE_ACTIONS],
  ['copy_file', FILE_ACTIONS],
  ['move_file', FILE_ACTIONS],
  ['rename_files', FILE_ACTIONS],
  ['delete_file', FILE_ACTIONS],
  ['hash_file', FILE_ACTIONS],
];
for (const [action, table] of needed) {
  check(`${action} is advertised`, action in table);
}

check(
  'rename_files tells the planner to preview before applying',
  /apply=true/.test(FILE_ACTIONS.rename_files.note ?? ''),
  'a bulk rename that acts on the first call is not recoverable',
);
check(
  'delete_file says it uses the Recycle Bin',
  /Recycle Bin/i.test(FILE_ACTIONS.delete_file.note ?? ''),
);
// The routing rule the display failure earned.
//
// Dex planned eight UIA steps to set a resolution — open Settings, wait, click
// Display, click Resolution, click "1920 x 1080" — and failed on the label,
// because Windows writes it with a multiplication sign. The API has existed
// since Windows 95. The ladder now says so before it says anything about
// clicking.
check(
  'the ladder tells the planner to prefer a command over clicking',
  /could a command do this instead/i.test(ROUTING_RULES),
);
check(
  'and names the Settings app specifically, since that is where it happens',
  /Settings app is a front end for APIs/i.test(ROUTING_RULES),
);
check(
  'and tells it to list_elements rather than invent a label',
  /Do not invent a label/i.test(ROUTING_RULES),
);
check(
  'set_display says never to click through Settings',
  /NEVER click through Settings/i.test(OS_ACTIONS.set_display.note ?? ''),
);

check(
  'run_command insists on a list of arguments',
  /LIST/.test(OS_ACTIONS.run_command.note ?? ''),
  'a command as one string is a quoting problem waiting to be a security one',
);

// ---------------------------------------------------------------------------
// The prompt still has to fit
// ---------------------------------------------------------------------------

console.log('\n— the prompt fits the budget —');

const promptSize = (catalogue + ROUTING_RULES).length;
check(
  `the capability prompt is ${promptSize} characters`,
  promptSize < 24_000,
  'Groq\'s small tier has a tokens-per-minute budget and this is most of it',
);

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

console.log('\n— reads are recognised as reads —');

for (const action of ['get_dns', 'get_power_plan', 'get_volume', 'list_processes',
                      'read_file', 'list_dir', 'find_files', 'hash_file',
                      'registry_read', 'run_command', 'read_page', 'screenshot',
                      'get_display', 'get_brightness']) {
  check(`${action} contributes an answer`, isReadShaped(action));
}
for (const action of ['set_dns', 'set_volume', 'launch_app', 'write_file',
                      'delete_file', 'rename_files', 'click_element']) {
  check(`${action} does not`, !isReadShaped(action), 'a write is not an answer');
}

check(
  'every advertised OS action name is snake_case, as isReadShaped assumes',
  OS_ACTION_NAMES.every((a) => /^[a-z][a-z0-9_]*$/.test(a)),
);

console.log('\n— the fallback renderer always produces something —');

check(
  'a power plan reads as a power plan',
  renderFacts([{ action: 'get_power_plan', plan: 'Balanced', guid: 'abc-123' }])
    === 'get power plan: plan Balanced',
);
check(
  'the guid is left out — it is an identifier, not an answer',
  !renderFacts([{ action: 'get_power_plan', plan: 'Balanced', guid: 'abc' }]).includes('abc'),
);
check(
  'volume reports both parts',
  renderFacts([{ action: 'get_volume', level: 35, muted: false }])
    === 'get volume: level 35, muted false',
);
check(
  'nested adapter data survives',
  renderFacts([{ action: 'get_dns', adapters: { 'Wi-Fi': { servers: '1.1.1.1' } } }])
    .includes('1.1.1.1'),
);
check(
  'a long list is truncated with the count kept',
  renderFacts([{ action: 'list_dir', entries: Array.from({ length: 40 }, (_, i) => `f${i}`) }])
    .includes('+32 more'),
);
check('no facts renders as nothing', renderFacts([]) === '');
check('nothing to say is not worth a model call', !worthPhrasing([]));
check(
  'a bare action with no data is not worth a model call',
  !worthPhrasing([{ action: 'get_volume' }]),
);
check('real data is', worthPhrasing([{ action: 'get_volume', level: 35 }]));

// Every advertised file action must actually be handled.
//
// The same drift check the OS actions get from the conformance harness, which
// walks OS_ACTION_NAMES against the live daemon. can_control_files has no
// daemon to interrogate, so its dispatch is read from the source — crude, but
// it catches the exact failure this release exists to fix: an action written
// into the catalogue with nothing behind it.
{
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'agents', 'files', 'file_agent.ts'),
    'utf8',
  );
  console.log('\n— every advertised file action is implemented —');
  for (const action of Object.keys(FILE_ACTIONS)) {
    check(
      `${action} is handled by FileAgent`,
      source.includes(`case '${action}':`),
      'advertised to the planner with nothing behind it',
    );
  }
}

console.log('\n— window titles match on what is visible, not what is encoded —');

// Edge titles its own window with a ZERO WIDTH SPACE between "Microsoft" and
// "Edge". Invisible on screen, survives lowercasing, and makes a plain
// includes() false forever — so Dex launched Edge perfectly and then reported
// that no window had appeared. Found by running it, not by reading it.
const edgeTitle = 'New tab - Profile 1 - Microsoft​ Edge';
check(
  'the raw title does NOT contain "microsoft edge" — this is the trap',
  !edgeTitle.toLowerCase().includes('microsoft edge'),
);
check(
  'normalised, it does',
  normaliseTitle(edgeTitle).includes('microsoft edge'),
);
check(
  'a non-breaking space is also just a space',
  normaliseTitle('Some App') === 'some app',
);
check(
  'runs of whitespace collapse',
  normaliseTitle('  Notepad   ++  ') === 'notepad ++',
);
check(
  'an ordinary title is unchanged apart from case',
  normaliseTitle('Untitled - Notepad') === 'untitled - notepad',
);

console.log();
console.log(failures === 0
  ? 'PASSED  the planner is told the truth about what it can do.'
  : `${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
