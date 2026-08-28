/**
 * The deterministic ladder, end to end, against a real Windows application.
 *
 * Tier 1 launches. Tier 2 drives the app through UI Automation — setting fields
 * and invoking controls *by name*, then reading the result back out of the live
 * accessibility tree. No screenshot, no vision model, no GPU, no tokens.
 *
 * The target is a WinForms fixture this test starts and closes itself
 * (tests/uia_fixture.ps1). That is a deliberate choice, arrived at the hard way:
 *
 *   * Notepad on Windows 11 uses tabs, so launching it joins whatever window is
 *     already open. In development that was the owner's own document with
 *     unsaved work, and `set_text` would have overwritten it. The ambiguity
 *     guard could not help — there genuinely was only one window.
 *   * Calculator is UWP/WinUI and drives unreliably through UIA for reasons
 *     unrelated to Dex: digits registered while operators were silently
 *     dropped, so "5 + 3 =" produced 53 with an empty expression.
 *
 * A test that owns its target destroys nothing and proves more.
 *
 * Needs both servers running:
 *   python daemon/DexDaemon.py
 *   python agents/app/server.py
 *
 * Run: npm run test:e2e
 */
import './support/isolate';
import { spawnSync } from 'child_process';

import { AppAgent } from '../agents/app/app_agent';
import { SystemAgent } from '../agents/system/system_agent';
import { AgentContext, AgentResult } from '../core/events/types';
import { bus } from '../core/events/bus';

const WINDOW = 'DEX_UIA_Fixture';
const TEXT = 'hello world from dex';

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

function why(result: AgentResult): string {
  return result.success ? JSON.stringify(result.data).slice(0, 140) : `FAILED: ${result.error}`;
}

function startFixture(): void {
  // Routed through Start-Process because a PowerShell spawned directly from
  // this process runs, blocks on ShowDialog, and never puts a window on the
  // interactive desktop. spawnSync is safe despite opening a GUI: Start-Process
  // returns as soon as the child launches.
  //
  // Two details that cost an hour between them: a detached spawn() silently
  // produced no window (Node's Windows quoting mangles the nested
  // -ArgumentList), and the title must be a single token — Start-Process splits
  // "DEX UIA Fixture" and the window comes up called just "DEX".
  //
  // Forward slash deliberately: a backslash makes `\u` a unicode escape here
  // and the file stops compiling. PowerShell accepts either separator.
  spawnSync('powershell', [
    '-NoProfile', '-Command',
    `Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','tests/uia_fixture.ps1','-Title','${WINDOW}'`,
  ], { encoding: 'utf8' });
}

function closeFixture(): void {
  spawnSync('python', ['-c',
    'import sys;sys.path.insert(0,"daemon/handlers");' +
    'from app_handler import _close_windows_titled;_close_windows_titled("DEX_UIA_Fixture")',
  ], { encoding: 'utf8' });
}

async function main(): Promise<void> {
  console.log('\x1b[1mTier 1 + Tier 2 end to end — no vision anywhere\x1b[0m\n');

  bus.subscribe('e2e', (event) => {
    console.log(`      \x1b[90m[${event.type}] ${event.message}\x1b[0m`);
  });

  const app = new AppAgent();
  const system = new SystemAgent();

  closeFixture();          // in case an earlier run left one open
  startFixture();

  // ── Tier 2: wait for it, deterministically ────────────────────────────────
  console.log('  TIER 2 — wait for a real control, not a guessed sleep');
  const ready = await app.execute(
    'wait_for', { window: WINDOW, name: 'Apply Button', timeout: 20 }, 'e2e', 'step_1',
  );
  check(
    'the window became driveable',
    (ready.data as { appeared?: boolean })?.appeared === true,
    why(ready),
  );
  if ((ready.data as { appeared?: boolean })?.appeared !== true) return finish();

  // ── Tier 2: set a field ───────────────────────────────────────────────────
  console.log('  TIER 2 — set_text through ValuePattern');
  const typed = await app.execute(
    'set_text', { window: WINDOW, name: 'Input Field', text: TEXT }, 'e2e', 'step_2',
  );
  const typedData = typed.data as { verified?: boolean; read_back?: string };
  check('the field was set', typed.success, why(typed));
  check(
    'and reads back byte-for-byte',
    typedData?.verified === true,
    `read_back=${JSON.stringify(typedData?.read_back)}`,
  );

  // ── Tier 2: invoke, and prove the app processed it ────────────────────────
  console.log('  TIER 2 — click_element by name');
  const clicked = await app.execute(
    'click_element', { window: WINDOW, name: 'Apply Button' }, 'e2e', 'step_3',
  );
  check(
    'invoked through a UIA pattern, not a mouse coordinate',
    (clicked.data as { method?: string })?.method === 'InvokePattern',
    why(clicked),
  );

  const result = await app.execute(
    'read_element', { window: WINDOW, name: 'Result Field' }, 'e2e', 'step_4',
  );
  const value = (result.data as { value?: string })?.value ?? '';
  // The fixture uppercases on click. A copied value could be explained by the
  // textbox alone; a transformed one proves the handler actually ran.
  check(
    'the application really processed the click',
    value === TEXT.toUpperCase(),
    `result field reads ${JSON.stringify(value)}`,
  );

  // ── Tier 2: toggle, verified both ways ────────────────────────────────────
  console.log('  TIER 2 — toggle');
  const on = await app.execute(
    'toggle', { window: WINDOW, name: 'Enable Option', on: true }, 'e2e', 'step_5',
  );
  const off = await app.execute(
    'toggle', { window: WINDOW, name: 'Enable Option', on: false }, 'e2e', 'step_6',
  );
  check(
    'toggling on and off both verify against real state',
    (on.data as { verified?: boolean })?.verified === true &&
      (off.data as { verified?: boolean })?.verified === true,
    `${JSON.stringify(on.data)} / ${JSON.stringify(off.data)}`,
  );

  // ── the safety rule, at the point of action ───────────────────────────────
  console.log('  TIER 2 — a password field');
  let handoffReason = '';
  const ctx: AgentContext = {
    handoff: async (request) => {
      handoffReason = request.reason;
      return false;               // decline, so nothing is typed either way
    },
    isCancelled: () => false,
  };
  const secret = await app.execute(
    'set_text', { window: WINDOW, name: 'Password Field', text: 'hunter2' }, 'e2e', 'step_7', ctx,
  );
  check('refuses to type into a password field', handoffReason.includes('password'), handoffReason);
  check('and does not silently succeed', !secret.success, why(secret));

  const stillEmpty = await app.execute(
    'read_element', { window: WINDOW, name: 'Password Field' }, 'e2e', 'step_8',
  );
  check(
    'the password field is genuinely untouched',
    ((stillEmpty.data as { value?: string })?.value ?? '') === '',
    JSON.stringify(stillEmpty.data),
  );

  // ── a control that is not there ───────────────────────────────────────────
  console.log('  TIER 2 — a control that does not exist');
  const missing = await app.execute(
    'click_element', { window: WINDOW, name: 'Definitely Not A Button' }, 'e2e', 'step_9',
  );
  check(
    'fails without escalating to vision',
    !missing.success && missing.escalate === undefined,
    why(missing),
  );
  check(
    'and names what the window actually offers',
    (missing.error ?? '').includes('Apply Button'),
    missing.error?.slice(0, 140),
  );

  // ── Tier 1 knows how to close it ──────────────────────────────────────────
  console.log('  TIER 1 — close');
  const closed = await system.execute('close_app', { name: WINDOW }, 'e2e', 'step_10');
  check('closed gracefully via WM_CLOSE, not force-killed', closed.success, why(closed));

  finish();
}

function finish(): void {
  closeFixture();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\x1b[33mAre the daemon and App Agent server running?\x1b[0m');
    process.exit(1);
  }
  console.log('\x1b[32mA real Windows app driven and verified with zero screenshots\x1b[0m');
  process.exit(0);
}

void main();
