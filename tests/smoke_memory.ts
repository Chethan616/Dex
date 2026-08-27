/**
 * Slice 6 — memory and cross-channel continuity.
 *
 * The production gate is the interesting one: a reference that fits two things
 * equally well must force a question, never a guess. A resolver that quietly
 * picks the newer candidate is right most of the time and silently wrong the
 * rest — and the owner cannot tell which happened, because they asked for "the
 * report" and got *a* report.
 *
 * Run: npm run test:memory
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { closeDb, db, quietSqliteWarning } from '../core/memory/db';

const TEMP_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dex-mem-')), 'test.db');
quietSqliteWarning();
db(TEMP_DB);

// eslint-disable-next-line import/first
import { AgentResult, ExecutionStep } from '../core/events/types';
// eslint-disable-next-line import/first
import { ArtifactStore } from '../core/memory/artifacts';
// eslint-disable-next-line import/first
import { ReferenceResolver } from '../core/memory/references';
// eslint-disable-next-line import/first
import { SessionStore } from '../core/memory/sessions';
// eslint-disable-next-line import/first
import { SemanticCache } from '../core/memory/semantic_cache';
// eslint-disable-next-line import/first
import { ExecutionPlan } from '../core/events/types';

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

function step(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: 'step_1',
    capability: 'can_control_gui',
    action: 'run_task',
    params: {},
    confirmationTier: 4,
    dependsOn: [],
    ...overrides,
  };
}

const ok: AgentResult = { success: true, data: {} };

// ── artifacts ────────────────────────────────────────────────────────────────

function testArtifacts(): void {
  section('Artifacts — what a task actually left behind');

  const store = new ArtifactStore();

  const file = store.recordFromStep(
    step({ params: { verify_file: 'C:\\Users\\me\\Documents\\Q3_Report.pdf' } }),
    ok, 'req1', 's1',
  );
  check('a written file is recorded', file[0]?.kind === 'file', JSON.stringify(file));
  check('under the name a person would use', file[0]?.name === 'Q3_Report.pdf', file[0]?.name);

  const page = store.recordFromStep(
    step({ capability: 'can_browse_web', action: 'run_task' }),
    { success: true, data: { url: 'https://example.com/flights', title: 'Flights' } },
    'req2', 's1',
  );
  check('a browser task records where it ended up', page[0]?.kind === 'page', JSON.stringify(page));

  const email = store.recordFromStep(
    step({ capability: 'can_access_email', action: 'send_email', params: { subject: 'Invoice' } }),
    { success: true, data: { readBack: { verified: true, id: 'msg_abc123' } } },
    'req3', 's1',
  );
  check('a verified email is recorded with its id', email[0]?.locator === 'msg_abc123');

  // The rule that keeps references honest.
  const failedStep = store.recordFromStep(
    step({ params: { verify_file: 'C:\\never\\written.pdf' } }),
    { success: false, error: 'nope' }, 'req4', 's1',
  );
  check(
    'a step that failed leaves NO artifact',
    failedStep.length === 0,
    'otherwise "the report" resolves to a file that was never written',
  );

  const unverified = store.recordFromStep(
    step({ capability: 'can_access_email', action: 'send_email', params: { subject: 'x' } }),
    { success: true, data: { readBack: { verified: false, id: 'msg_maybe' } } },
    'req5', 's1',
  );
  check(
    'an unverified write leaves no artifact either',
    unverified.length === 0,
    '"probably sent" is not something to let the owner refer back to',
  );

  check('artifacts come back newest first', store.recent(10)[0]?.locator === 'msg_abc123');
}

// ── references ───────────────────────────────────────────────────────────────

function testReferences(): void {
  section('References — "the report" has to mean one thing');

  const store = new ArtifactStore();
  const resolver = new ReferenceResolver(store);
  db().prepare('DELETE FROM artifacts').run();

  store.save({ requestId: 'r', sessionId: 's', kind: 'file', name: 'Q3_Report.pdf', locator: 'C:\\docs\\Q3_Report.pdf' });

  const one = resolver.resolve('email me the report');
  check('a lone candidate resolves', one.resolved[0]?.match.name === 'Q3_Report.pdf', JSON.stringify(one));
  check('and nothing is ambiguous', one.ambiguous.length === 0);

  check(
    'the locator is substituted in, so agents get something concrete',
    resolver.substitute('email me the report', one.resolved).includes('C:\\docs\\Q3_Report.pdf'),
    resolver.substitute('email me the report', one.resolved),
  );

  // THE PRODUCTION GATE: two equally good candidates, made close in time so
  // recency cannot break the tie.
  const now = Date.now();
  db().prepare('UPDATE artifacts SET created_at = ?').run(now - 60_000);
  store.save({ requestId: 'r', sessionId: 's', kind: 'file', name: 'Q4_Report.pdf', locator: 'C:\\docs\\Q4_Report.pdf' });
  db().prepare("UPDATE artifacts SET created_at = ? WHERE name = 'Q4_Report.pdf'").run(now - 30_000);

  const two = resolver.resolve('email me the report');
  check(
    'two equal candidates force a question',
    two.ambiguous.length === 1 && two.resolved.length === 0,
    JSON.stringify({ resolved: two.resolved.length, ambiguous: two.ambiguous.length }),
  );
  check(
    'nothing is picked in the meantime',
    two.resolved.length === 0,
    'guessing here is the failure this gate exists to prevent',
  );
  const question = two.ambiguous.length ? ReferenceResolver.question(two.ambiguous[0]) : '';
  check(
    'the question lists both, by name and locator',
    question.includes('Q3_Report.pdf') && question.includes('Q4_Report.pdf'),
    question,
  );

  // Naming one resolves it — a stronger match beats a tie on kind.
  const named = resolver.resolve('email me the q4_report.pdf');
  check(
    'naming it exactly resolves despite the other candidate',
    named.resolved[0]?.match.name === 'Q4_Report.pdf' && named.ambiguous.length === 0,
    JSON.stringify(named.resolved.map((r) => r.match.name)),
  );

  // A tie in *kind* is not a tie if one is obviously fresher.
  db().prepare("UPDATE artifacts SET created_at = ? WHERE name = 'Q3_Report.pdf'")
    .run(now - 6 * 60 * 60 * 1000);
  const fresh = resolver.resolve('email me the report');
  check(
    'a candidate from hours ago does not make it ambiguous',
    fresh.resolved[0]?.match.name === 'Q4_Report.pdf',
    'asking about things nobody is confused by trains the owner to click through questions',
  );

  // The same thing recorded twice is one thing the owner could mean. Opening
  // an app twice must not produce "which Calculator do you mean?".
  db().prepare('DELETE FROM artifacts').run();
  for (let i = 0; i < 3; i += 1) {
    store.save({
      requestId: `r${i}`, sessionId: 's', kind: 'app',
      name: 'Calculator', locator: 'Calculator',
    });
  }
  const repeated = resolver.resolve('close the app');
  check(
    'the same artifact recorded repeatedly is not ambiguous',
    repeated.ambiguous.length === 0 && repeated.resolved[0]?.match.name === 'Calculator',
    JSON.stringify({ resolved: repeated.resolved.length, ambiguous: repeated.ambiguous.length }),
  );

  // Identity is kind-dependent: an app IS its name, so the same app recorded
  // with a different locator (older builds stored the launcher stub) is still
  // one app.
  store.save({
    requestId: 'r8', sessionId: 's', kind: 'app',
    name: 'Calculator', locator: 'calc.exe',
  });
  const legacy = resolver.resolve('close the app');
  check(
    'an app recorded under two different locators is still one app',
    legacy.ambiguous.length === 0,
    JSON.stringify(legacy.ambiguous[0]?.candidates.map((c) => `${c.name}|${c.locator}`)),
  );

  // But two files sharing a name in different folders are genuinely different.
  db().prepare('DELETE FROM artifacts').run();
  const t = Date.now();
  store.save({ requestId: 'a', sessionId: 's', kind: 'file', name: 'notes.txt', locator: 'C:\a\notes.txt' });
  store.save({ requestId: 'b', sessionId: 's', kind: 'file', name: 'notes.txt', locator: 'C:\b\notes.txt' });
  db().prepare('UPDATE artifacts SET created_at = ?').run(t - 60_000);
  db().prepare("UPDATE artifacts SET created_at = ? WHERE locator LIKE '%b%'").run(t - 30_000);
  check(
    'two files with the same name in different folders stay a real choice',
    resolver.resolve('open the notes.txt').ambiguous.length === 1,
  );

  // But two genuinely different apps still are.
  db().prepare('DELETE FROM artifacts').run();
  store.save({ requestId: 'r7', sessionId: 's', kind: 'app', name: 'Calculator', locator: 'Calculator' });
  store.save({ requestId: 'r9', sessionId: 's', kind: 'app', name: 'Notepad', locator: 'Notepad' });
  const twoApps = resolver.resolve('close the app');
  check(
    'two different apps still force a question',
    twoApps.ambiguous.length === 1,
    JSON.stringify(twoApps.ambiguous[0]?.candidates.map((c) => c.name)),
  );

  section('References — what should NOT be treated as one');

  check('"the volume" is not an artifact', resolver.resolve('turn the volume down').resolved.length === 0);
  check('"the internet" is not an artifact', resolver.resolve('check the internet').resolved.length === 0);
  check('"the same" is not an artifact', resolver.resolve('do the same again').resolved.length === 0);
  check(
    'an unknown noun resolves to nothing rather than the nearest file',
    resolver.resolve('open the sandwich').resolved.length === 0,
  );
  check(
    'with no artifacts at all, nothing resolves',
    (() => {
      db().prepare('DELETE FROM artifacts').run();
      return resolver.resolve('email me the report').resolved.length === 0;
    })(),
  );
}

// ── sessions ─────────────────────────────────────────────────────────────────

function testSessions(): void {
  section('Sessions — one conversation, whatever device it arrives on');

  db().prepare('DELETE FROM sessions').run();
  const sessions = new SessionStore(90 * 60 * 1000);

  const first = sessions.current('whatsapp');
  const second = sessions.current('telegram');

  check(
    'a follow-up on another channel joins the SAME session',
    first.id === second.id,
    `${first.id} vs ${second.id}`,
  );
  check(
    'and both channels are recorded on it',
    second.channels.includes('whatsapp') && second.channels.includes('telegram'),
    JSON.stringify(second.channels),
  );

  // Long enough after, it is a new conversation — otherwise tomorrow's first
  // request inherits last night's references.
  const shortLived = new SessionStore(1);
  const before = shortLived.current('cli', Date.now() - 10_000);
  const after = shortLived.current('cli', Date.now());
  check('an idle gap starts a new session', before.id !== after.id);

  check('sessions survive a restart', new SessionStore().get(second.id) !== undefined,
    'the old in-memory map lost every conversation on restart');
}

// ── semantic cache ───────────────────────────────────────────────────────────

function planAt(tier: 1 | 2 | 3 | 4, action = 'search_email'): ExecutionPlan {
  return {
    requestId: 'r', intent: 'test', tier: 1,
    steps: [{
      id: 'step_1', capability: 'can_access_email', action,
      params: {}, confirmationTier: tier, dependsOn: [],
    }],
  };
}

async function testSemanticCache(): Promise<void> {
  section('Semantic cache — safe by construction, not by threshold');

  const cache = new SemanticCache();
  db().prepare('DELETE FROM plan_cache').run();

  // Embeddings need Ollama. Without it the cache must be inert, not broken.
  await cache.remember('check my unread email', planAt(4));
  const enabled = cache.stats().entries > 0;

  if (!enabled) {
    check(
      'with no embedding model the cache degrades to nothing',
      (await cache.lookup('check my unread email', 'r2')) === null,
      'it is an optimisation; absent, everything simply goes to the Brain',
    );
    console.log('  [90m—[0m Ollama/nomic-embed-text unavailable; similarity checks skipped');
    return;
  }

  check('a silent plan is cached', cache.stats().entries === 1);
  check(
    'and an identical request hits it',
    (await cache.lookup('check my unread email', 'r2')) !== null,
  );

  // THE SAFETY RULE. Embedding similarity measures topic, not intent:
  // "archive my unread email" scores 90.8% against "check my unread email",
  // higher than four genuine paraphrases. No threshold separates them, so
  // anything that is not Tier 4 never enters the cache at all.
  for (const [tier, label] of [[2, 'always-confirm'], [3, 'pre-approve'], [1, 'hand-off']] as const) {
    db().prepare('DELETE FROM plan_cache').run();
    await cache.remember('delete all my emails', planAt(tier));
    check(
      `a Tier ${tier} (${label}) plan is NEVER cached`,
      cache.stats().entries === 0,
      'a wrongly served destructive plan deletes something; a read-only one wastes an action',
    );
  }

  db().prepare('DELETE FROM plan_cache').run();
  await cache.remember('do nothing much', { requestId: 'r', intent: 'x', tier: 1, steps: [] });
  check(
    'an empty plan is not cached',
    cache.stats().entries === 0,
    'serving "do nothing" for a familiar-looking request is a silent failure',
  );

  // A plan stored before the rule existed must not be served now.
  db().prepare('DELETE FROM plan_cache').run();
  await cache.remember('check my unread email', planAt(4));
  db().prepare("UPDATE plan_cache SET plan = ?").run(JSON.stringify(planAt(2, 'delete_email')));
  check(
    'a cached plan that is no longer safe is refused and evicted on read',
    (await cache.lookup('check my unread email', 'r3')) === null &&
      cache.stats().entries === 0,
  );

  db().prepare('DELETE FROM plan_cache').run();
  await cache.remember('check my unread email', planAt(4));
  check(
    'an unrelated request misses',
    (await cache.lookup('set my volume to 30', 'r4')) === null,
  );
}

async function main(): Promise<void> {
  console.log('\x1b[1mDEX Slice 6 — memory and cross-channel continuity\x1b[0m');
  testArtifacts();
  testReferences();
  testSessions();
  await testSemanticCache();

  console.log(`\n${passed} passed, ${failed} failed`);
  closeDb();
  try {
    fs.rmSync(path.dirname(TEMP_DB), { recursive: true, force: true });
  } catch {
    /* a leftover temp file is not worth failing a green run over */
  }
  if (failed > 0) process.exit(1);
  console.log('\x1b[32mAll checks passed\x1b[0m');
  process.exit(0);
}

void main();
