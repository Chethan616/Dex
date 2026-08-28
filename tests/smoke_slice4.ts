/**
 * Slice 4 checks — web and workspace.
 *
 * Covers the two production gates for this slice:
 *   * a CAPTCHA becomes a Tier 1 hand-off and is never retried into the ground
 *   * MCP credentials live in the OS store, not in config
 *
 * plus the plumbing that carries them: hand-off wiring through the
 * Orchestrator, the `retryable` contract, tool resolution against tool names
 * DEX has never seen, and a real MCP handshake with a real child process.
 *
 * Run: npm run test:slice4
 */
import './support/isolate';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

import * as http from 'http';

import { AgentContext, AgentResult, ExecutionPlan, ExecutionStep } from '../core/events/types';
import { AgentRegistry } from '../core/orchestrator/registry';
import { Orchestrator } from '../core/orchestrator/orchestrator';
import { CancellationRegistry } from '../core/orchestrator/cancellation';
import { ConfirmationManager } from '../core/confirmation/confirmation_manager';
import { ReliabilityLayer } from '../core/reliability/observation_engine';
import { EvidenceStore } from '../core/reliability/evidence_store';
import { CredentialStore } from '../core/secrets/credential_store';
import { BrowserAgent } from '../agents/browser/browser_agent';
import { WorkspaceAgent } from '../agents/workspace/workspace_agent';
import { McpServerSpec } from '../agents/workspace/mcp_pool';
import { McpTool, bindArgs, extractId, resolveTool } from '../agents/workspace/tool_binding';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
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

// ── fixtures ─────────────────────────────────────────────────────────────────

const TOOLS: McpTool[] = [
  {
    name: 'gmail_search_messages',
    description: 'Search messages in the mailbox',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        maxResults: { type: 'number' },
        user_google_email: { type: 'string' },
      },
      required: ['q', 'user_google_email'],
    },
  },
  {
    name: 'gmail_send_message',
    description: 'Send an email',
    inputSchema: {
      type: 'object',
      properties: {
        toRecipients: { type: 'string' },
        title: { type: 'string' },
        htmlBody: { type: 'string' },
      },
      required: ['toRecipients', 'title', 'htmlBody'],
    },
  },
  {
    name: 'gmail_list_labels',
    description: 'List labels. You can search and send using labels as filters.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function step(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: 'step_1',
    capability: 'can_browse_web',
    action: 'run_task',
    params: {},
    confirmationTier: 4,
    dependsOn: [],
    ...overrides,
  };
}

function plan(steps: ExecutionStep[]): ExecutionPlan {
  return { requestId: 'req_slice4', intent: 'test', tier: 1, steps };
}

/** An agent that hits a wall on its first run and reports what happened. */
class WallAgent {
  name = 'WallAgent';
  capabilities = ['can_browse_web'];
  calls = 0;
  handoffsAsked = 0;
  handoffCleared: boolean | null = null;

  constructor(private retryableAfterDecline = false) {}

  async execute(
    _action: string,
    _params: Record<string, unknown>,
    _requestId: string,
    _stepId: string,
    ctx?: AgentContext,
  ): Promise<AgentResult> {
    this.calls += 1;
    if (!ctx) return { success: false, error: 'no context', retryable: false };

    this.handoffsAsked += 1;
    const cleared = await ctx.handoff({
      reason: 'CAPTCHA on example.com',
      instruction: 'Solve the CAPTCHA in the open browser window.',
    });
    this.handoffCleared = cleared;

    if (!cleared) {
      return {
        success: false,
        error: 'Not cleared: CAPTCHA on example.com',
        retryable: this.retryableAfterDecline,
      };
    }
    return {
      success: true,
      data: { verification: { passed: true, checks: [{ check: 'url contains ok', passed: true }] } },
    };
  }
}

/** Answers every confirmation with a fixed verdict, like a very decisive owner. */
function autoResponder(
  manager: ConfirmationManager,
  verdict: 'handed_off' | 'rejected',
): () => void {
  return manager.registerProvider({
    name: 'test',
    present: (request) => {
      setImmediate(() =>
        manager.respond(request.requestId, request.stepId, request.stepVersion, verdict),
      );
    },
    withdraw: () => undefined,
  });
}

function buildOrchestrator(
  agent: { name: string; capabilities: string[]; execute: never } | WallAgent,
  fullAccess = false,
): { orchestrator: Orchestrator; confirmations: ConfirmationManager } {
  const registry = new AgentRegistry();
  registry.register(agent as never);
  const confirmations = new ConfirmationManager(5_000, 5_000);
  const reliability = new ReliabilityLayer(
    new EvidenceStore(path.join(os.tmpdir(), 'dex-slice4-evidence')),
  );
  const orchestrator = new Orchestrator(
    registry,
    reliability,
    fullAccess,
    confirmations,
    new CancellationRegistry(),
  );
  return { orchestrator, confirmations };
}

// ── tests ────────────────────────────────────────────────────────────────────

async function testHandoff(): Promise<void> {
  section('Hand-off — a CAPTCHA reaches the owner and the task continues');

  {
    const agent = new WallAgent();
    const { orchestrator, confirmations } = buildOrchestrator(agent);
    const stop = autoResponder(confirmations, 'handed_off');

    const result = await orchestrator.execute(
      plan([step({ params: { verify_url_contains: 'ok' } })]),
    );
    stop();

    check('owner is asked exactly once', agent.handoffsAsked === 1, `asked ${agent.handoffsAsked}`);
    check('hand-off resolves true when the owner says done', agent.handoffCleared === true);
    check('task completes after the hand-off', result.status === 'COMPLETED', result.summary);
    check('the step is not re-run after a successful hand-off', agent.calls === 1, `${agent.calls} calls`);
  }

  {
    const agent = new WallAgent();
    const { orchestrator, confirmations } = buildOrchestrator(agent);
    const stop = autoResponder(confirmations, 'rejected');

    const result = await orchestrator.execute(plan([step()]));
    stop();

    check('hand-off resolves false when the owner declines', agent.handoffCleared === false);
    check('declined hand-off fails the task', result.status === 'FAILED', result.summary);
    check(
      'a declined hand-off is NOT retried',
      agent.calls === 1,
      `agent ran ${agent.calls} times — a CAPTCHA the owner refused must not be re-asked`,
    );
  }

  {
    // Full Access removes confirmations. It must not remove hand-offs: no
    // amount of privilege lets DEX read a CAPTCHA.
    const agent = new WallAgent();
    const { orchestrator, confirmations } = buildOrchestrator(agent, true);
    const stop = autoResponder(confirmations, 'handed_off');

    const result = await orchestrator.execute(
      plan([step({ confirmationTier: 2, params: { verify_url_contains: 'ok' } })]),
    );
    stop();

    check(
      'Full Access still asks for a hand-off',
      agent.handoffsAsked === 1,
      `asked ${agent.handoffsAsked} times under Full Access`,
    );
    check('Full Access task still completes', result.status === 'COMPLETED', result.summary);
  }

  {
    // No provider attached at all — headless. Must fail fast, not hang.
    const agent = new WallAgent();
    const { orchestrator } = buildOrchestrator(agent);
    const started = Date.now();
    const result = await orchestrator.execute(plan([step()]));
    check(
      'headless hand-off fails immediately instead of hanging',
      result.status === 'FAILED' && Date.now() - started < 2_000,
      `${result.status} after ${Date.now() - started}ms`,
    );
  }
}

async function testRetryable(): Promise<void> {
  section('retryable — the Orchestrator stops asking when asking cannot help');

  const agent = new WallAgent(true);
  const { orchestrator, confirmations } = buildOrchestrator(agent);
  const stop = autoResponder(confirmations, 'rejected');
  await orchestrator.execute(plan([step()]));
  stop();

  check(
    'a failed execute is never retried, retryable or not',
    agent.calls === 1,
    `agent ran ${agent.calls} times`,
  );
}

function testToolBinding(): void {
  section('Tool binding — DEX adapts to the server, not the other way round');

  const send = resolveTool('send_email', TOOLS);
  check(
    'resolves send_email to the sending tool, not the label lister',
    'tool' in send && send.tool.name === 'gmail_send_message',
    JSON.stringify(send),
  );

  const search = resolveTool('search_email', TOOLS);
  check(
    'resolves search_email by exact preferred name',
    'tool' in search && search.tool.name === 'gmail_search_messages',
    JSON.stringify(search),
  );

  const renamed: McpTool[] = [
    { name: 'mail_dispatch', description: 'Send an email message to recipients', inputSchema: { type: 'object', properties: {} } },
    { name: 'labels_enumerate', description: 'List labels', inputSchema: { type: 'object', properties: {} } },
  ];
  const scored = resolveTool('send_email', renamed);
  check(
    'resolves a tool name DEX has never seen, by meaning',
    'tool' in scored && scored.tool.name === 'mail_dispatch',
    JSON.stringify(scored),
  );

  const missingTool = resolveTool('create_calendar_event', TOOLS);
  check(
    'reports a readable error when no tool fits',
    'error' in missingTool && missingTool.error.includes('gmail_send_message'),
    JSON.stringify(missingTool),
  );

  const bound = bindArgs(
    TOOLS[0],
    { query: 'from:alice', max: 10, subject: 'ignored' },
    'owner@example.com',
  );
  check('binds query → q', bound.args.q === 'from:alice');
  check('binds max → maxResults', bound.args.maxResults === 10);
  check('fills the identity property', bound.args.user_google_email === 'owner@example.com');
  check(
    'never sends a property the schema did not declare',
    !('subject' in bound.args) && Object.keys(bound.args).length === 3,
    JSON.stringify(bound.args),
  );
  check('nothing required is missing', bound.missing.length === 0, bound.missing.join(','));

  const incomplete = bindArgs(TOOLS[1], { to: 'bob@example.com' });
  check(
    'names exactly what the plan failed to supply',
    incomplete.missing.join(',') === 'title,htmlBody',
    incomplete.missing.join(','),
  );

  check(
    'finds an id nested in a JSON string',
    extractId('{"ok":true,"messageId":"msg_1_abcdef"}') === 'msg_1_abcdef',
    String(extractId('{"ok":true,"messageId":"msg_1_abcdef"}')),
  );
  check(
    'finds an id inside MCP content blocks',
    extractId([{ type: 'text', text: '{"eventId":"evt_99xyz"}' }]) === 'evt_99xyz',
    String(extractId([{ type: 'text', text: '{"eventId":"evt_99xyz"}' }])),
  );
  check('returns undefined when there is no id to find', extractId('sent!') === undefined);
}

function testCredentialStore(): void {
  section('Credentials — encrypted by Windows, never in config');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-cred-'));
  const store = new CredentialStore(dir);

  try {
    store.set('test_secret', 'hunter2-with-ünicode');
    check('round-trips a secret through DPAPI', store.get('test_secret') === 'hunter2-with-ünicode');
    check('reports what is stored', store.list().includes('test_secret'));

    const onDisk = fs.readFileSync(path.join(dir, 'test_secret.dpapi'), 'utf8');
    check(
      'the plaintext is not on disk',
      !onDisk.includes('hunter2'),
      onDisk.slice(0, 60),
    );

    check('unset credentials read as undefined', store.get('never_set') === undefined);
    check('deletes', store.delete('test_secret') && !store.has('test_secret'));

    let rejected = false;
    try {
      store.set('../../evil', 'x');
    } catch {
      rejected = true;
    }
    check('refuses a name that would escape the store directory', rejected);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testMcpEndToEnd(): Promise<void> {
  section('MCP — a real handshake with a real child process');

  const tsNode = path.join('node_modules', '.bin', process.platform === 'win32' ? 'ts-node.cmd' : 'ts-node');
  if (!fs.existsSync(tsNode)) {
    console.log('  \x1b[33m—\x1b[0m ts-node not found, skipping');
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-mcp-'));
  const credentials = new CredentialStore(dir);
  credentials.set('google_account_email', 'owner@example.com');

  const spec: McpServerSpec = {
    key: 'google',
    label: 'Fake Workspace',
    command: tsNode,
    args: ['tests/fake_mcp_server.ts'],
    secrets: {},
    identityCredential: 'google_account_email',
    identityEnv: 'USER_GOOGLE_EMAIL',
  };

  const agent = new WorkspaceAgent({ servers: [spec], credentials });

  try {
    const listed = await agent.execute('list_tools', { server: 'google' }, 'req', 'step_0');
    check(
      'completes an MCP handshake and lists tools',
      listed.success && Array.isArray(listed.data) && (listed.data as unknown[]).length === 4,
      JSON.stringify(listed).slice(0, 200),
    );

    const sent = await agent.execute(
      'send_email',
      { to: 'bob@example.com', subject: 'Slice 4', body: 'hello' },
      'req',
      'step_1',
    );
    const sentData = sent.data as { tool?: string; readBack?: { verified: boolean; id?: string } };
    check('routes send_email to mail_dispatch', sentData?.tool === 'mail_dispatch', sentData?.tool);
    check(
      'reads the sent message back and confirms it exists',
      sent.success && sentData?.readBack?.verified === true,
      JSON.stringify(sentData?.readBack),
    );

    const searched = await agent.execute(
      'search_email',
      { query: 'Slice 4', max: 5 },
      'req',
      'step_2',
    );
    const searchData = searched.data as { summary?: string };
    check(
      'search passes the identity the credential store holds',
      Boolean(searchData?.summary?.includes('owner@example.com')),
      searchData?.summary?.slice(0, 160),
    );
    check(
      'a read action needs no read-back to count as verified',
      (searched.data as { readBack?: { verified: boolean } })?.readBack?.verified === true,
    );

    const unsupported = await agent.execute(
      'create_calendar_event',
      { subject: 'x', start: 'a', end: 'b' },
      'req',
      'step_3',
    );
    check(
      'an action the server cannot do fails as not-retryable',
      !unsupported.success && unsupported.retryable === false,
      unsupported.error,
    );

    const underspecified = await agent.execute('read_email', {}, 'req', 'step_4');
    check(
      'a step missing a required argument says which one',
      !underspecified.success && Boolean(underspecified.error?.includes('messageId')),
      underspecified.error,
    );
  } finally {
    await agent.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Runs only when the browser server is already up. It drives a real Chrome
 * through the real Node bridge — the part that no amount of unit testing
 * reaches, because the interesting failures live in CDP and HTTP, not in
 * TypeScript.
 */
async function testBrowserLive(): Promise<void> {
  section('Browser bridge — against a real browser, if one is running');

  const up = await browserServerUp();
  if (!up) {
    console.log('  [33m—[0m server not running (python agents/browser/server.py) — skipped');
    return;
  }

  const agent = new BrowserAgent();

  const navigated = await agent.execute(
    'navigate',
    { url: 'https://example.com' },
    'req',
    'step_1',
  );
  const navData = navigated.data as { url?: string; text?: string };
  check(
    'navigates and reads the live page',
    navigated.success && Boolean(navData?.text?.includes('Example Domain')),
    JSON.stringify(navigated).slice(0, 200),
  );

  const extracted = await agent.execute('extract', { selector: 'h1' }, 'req', 'step_2');
  check(
    'extracts by CSS selector',
    extracted.success && (extracted.data as { matches?: string[] })?.matches?.[0] === 'Example Domain',
    JSON.stringify(extracted.data).slice(0, 200),
  );

  const form =
    'data:text/html,<input id=u name=user><input id=p type=password name=pass>';
  await agent.execute('navigate', { url: form }, 'req', 'step_3');

  const typed = await agent.execute(
    'type_text',
    { selector: '#u', text: 'chethan' },
    'req',
    'step_4',
  );
  check('types into an ordinary field', typed.success, typed.error);

  // The safety rule that matters most here: DEX must refuse the password box
  // and offer the owner the hand-off instead of typing into it.
  let handoffAsked = '';
  const ctx: AgentContext = {
    handoff: async (request) => {
      handoffAsked = request.reason;
      return true;
    },
    isCancelled: () => false,
  };
  const secret = await agent.execute(
    'type_text',
    { selector: '#p', text: 'hunter2' },
    'req',
    'step_5',
    ctx,
  );
  check(
    'refuses to type into a password field',
    handoffAsked.includes('password'),
    handoffAsked || 'no hand-off was raised',
  );
  check(
    'offers the owner the hand-off instead of failing',
    secret.success && (secret.data as { handedOff?: boolean })?.handedOff === true,
    JSON.stringify(secret).slice(0, 200),
  );

  const value = await agent.execute('extract', { selector: '#p' }, 'req', 'step_6');
  check(
    'the password field is genuinely still empty',
    value.success && ((value.data as { matches?: string[] })?.matches?.length ?? 0) === 0,
    JSON.stringify(value.data),
  );
}

function browserServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port: parseInt(process.env.BROWSER_AGENT_PORT ?? '8766', 10), path: '/health', timeout: 2_000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function testWalls(): void {
  section('Wall detection (Python)');

  const result = spawnSync('python', ['tests/test_walls.py'], { encoding: 'utf8' });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  const ok = result.status === 0;
  check('python wall detector passes its cases', ok, output.trim().slice(0, 800));
  if (ok) {
    for (const line of output.trim().split('\n').filter(Boolean)) {
      console.log(`      ${line}`);
    }
  }
}

async function main(): Promise<void> {
  console.log('\x1b[1mDEX Slice 4 — web and workspace\x1b[0m');

  testToolBinding();
  testCredentialStore();
  await testHandoff();
  await testRetryable();
  await testMcpEndToEnd();
  await testBrowserLive();
  testWalls();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('\x1b[32mAll checks passed\x1b[0m');
  process.exit(0);
}

void main();
