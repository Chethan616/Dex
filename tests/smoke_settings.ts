import './support/isolate';
/**
 * Settings, the Claude Code brain, and the .env writer.
 *
 *   npm run test:settings
 *
 * Three properties are worth defending here, and only one of them is obvious.
 *
 *   1. **A stored secret never comes back out.** Settings shows a key's last
 *      four characters and nothing more. A settings screen that populates its
 *      own text field by decrypting the key would quietly undo the reason the
 *      credential store exists.
 *   2. **`.env` survives being edited.** The file is heavily commented and
 *      those comments are the only documentation several settings have. A
 *      naive parse-and-rewrite destroys them on the first checkbox change.
 *   3. **The Claude Code reply parser copes with what a text CLI actually
 *      returns** — the JSON envelope, a code fence, a sentence of preamble, or
 *      all three at once. This is the weakest link in that provider and the
 *      cheapest place to test it.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EnvStore } from '../core/settings/env_store';
import { SettingsService, PUBLIC_ENV_KEYS } from '../core/settings/settings_service';
import { CREDENTIALS, CREDENTIALS_BY_NAME, BRAIN_PROVIDERS } from '../core/settings/provider_catalog';
import { resolveCommand } from '../core/settings/which';
import { OpenAiCompatProvider, extractJsonObject, buildJsonPrompt } from '../core/llm/providers';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`ok   ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

function throws(label: string, fn: () => unknown, expected?: RegExp): void {
  try {
    fn();
    check(label, false, 'did not throw');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    check(label, expected ? expected.test(message) : true, message);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-settings-'));
const envFile = path.join(tmp, '.env');

// ---------------------------------------------------------------------------
// The .env writer
// ---------------------------------------------------------------------------

const ORIGINAL = [
  '# ── Channels ────────────────────────────────────────────',
  '# Owner ids are NOT secret — they are the equivalent of a',
  '# username — so they live here. Bot TOKENS do not.',
  'DEX_OWNER_TELEGRAM=',
  'DEX_TRIGGER_PREFIX=@dex',
  '',
  '# Leave false. A Tier 1 hand-off asks the owner to solve a',
  '# CAPTCHA "in the open browser window" — with no window,',
  '# that instruction is a lie.',
  'BROWSER_HEADLESS=false',
  '',
].join('\n');

fs.writeFileSync(envFile, ORIGINAL, 'utf8');
const env = new EnvStore(envFile);

check('reads keys, ignoring comments', env.read().DEX_TRIGGER_PREFIX === '@dex');
check('reads an empty value as empty', env.read().DEX_OWNER_TELEGRAM === '');

env.update({ BROWSER_HEADLESS: 'true', DEX_OWNER_TELEGRAM: '12345' });
const afterEdit = fs.readFileSync(envFile, 'utf8');

check('the change landed', env.read().BROWSER_HEADLESS === 'true');
check('the other change landed', env.read().DEX_OWNER_TELEGRAM === '12345');
check(
  'every comment survived the edit',
  ORIGINAL.split('\n')
    .filter((l) => l.trim().startsWith('#'))
    .every((l) => afterEdit.includes(l)),
  'a comment was lost — this is the failure a parse-and-rewrite causes',
);
check(
  'keys keep their original position',
  afterEdit.indexOf('DEX_OWNER_TELEGRAM') < afterEdit.indexOf('BROWSER_HEADLESS'),
);
check('no key was duplicated', afterEdit.match(/^BROWSER_HEADLESS=/gm)?.length === 1);

env.update({ DEX_BRAIN_MODEL: 'sonnet' });
check('a new key is appended', env.read().DEX_BRAIN_MODEL === 'sonnet');
check(
  'and is labelled so the file still reads like a person wrote it',
  fs.readFileSync(envFile, 'utf8').includes('# Added by Dex Settings'),
);

env.update({ DEX_BRAIN_MODEL: null });
check('null clears the value', env.read().DEX_BRAIN_MODEL === '');
check(
  'but keeps the line, because the comment above it is documentation',
  fs.readFileSync(envFile, 'utf8').includes('DEX_BRAIN_MODEL='),
);

env.update({ DEX_TRIGGER_PREFIX: 'hey dex' });
check('a value with a space round-trips', env.read().DEX_TRIGGER_PREFIX === 'hey dex');

// ---------------------------------------------------------------------------
// Settings: what it will and will not do
// ---------------------------------------------------------------------------

const settings = new SettingsService({ envFile });

throws(
  'refuses to write an env key that is not on the allow-list',
  () => settings.setEnv({ PATH: '/evil' }),
  /not a setting Dex will write/,
);
check(
  'and the allow-list holds no secrets',
  ![...PUBLIC_ENV_KEYS].some((k) => /KEY|TOKEN|SECRET|PASSWORD/i.test(k)),
  'a credential name reached the list of settings Settings can display',
);

throws(
  'refuses an unknown credential name',
  () => settings.setCredential('not_a_real_key', 'x'),
  /Unknown credential/,
);

throws(
  'refuses a log name that is not a plain word',
  () => settings.readLog('../../../windows/system32/config/sam'),
  /Unknown log/,
);

check('an absent log reads as empty rather than throwing', settings.readLog('nosuch') === '');

async function main(): Promise<void> {
const snapshot = await settings.describe();
const serialised = JSON.stringify(snapshot);

check('describe lists every catalogued credential', snapshot.credentials.length === CREDENTIALS.length);
check(
  'every credential says what it powers',
  snapshot.credentials.every((c) => c.powers.length > 10),
);
check(
  'every secret credential says where to get one',
  snapshot.credentials.filter((c) => c.secret).every((c) => c.source.length > 0),
);
check(
  'the Gemini entry carries its daily limit, not just a link',
  /20 requests per DAY/.test(CREDENTIALS_BY_NAME.get('gemini_api_key')!.note ?? ''),
);
check(
  'no stored value appears anywhere in the snapshot',
  !snapshot.credentials.some((c) => (c.hint?.length ?? 0) > 4),
  'a hint longer than four characters means more than the tail escaped',
);
check(
  'the snapshot carries no field that looks like a whole key',
  !/[A-Za-z0-9_-]{30,}/.test(serialised.replace(/\\?"[^"]*(?:key|token|secret)[^"]*\\?"/gi, '')),
);

check(
  'claude-code is offered as a brain provider that needs no credential',
  BRAIN_PROVIDERS.some((p) => p.id === 'claude-code' && p.credential === null),
);
check(
  'and it is not selected automatically',
  // buildBrainProvider falls back through groq then anthropic. Nothing may
  // fall back into spending the owner's Claude subscription.
  !fs
    .readFileSync(path.join(__dirname, '..', 'core', 'llm', 'providers.ts'), 'utf8')
    .includes("? 'claude-code'"),
);

// Windows npm CLIs are `.cmd` shims. The app must resolve the shim from PATH
// and invoke it through cmd.exe without depending on a developer's profile.
const fakeBin = path.join(tmp, 'bin');
fs.mkdirSync(fakeBin);
const fakeCli = path.join(fakeBin, process.platform === 'win32' ? 'fake-cli.cmd' : 'fake-cli');
fs.writeFileSync(fakeCli, '', 'utf8');
const previousPath = process.env.PATH;
const previousPathext = process.env.PATHEXT;
process.env.PATH = fakeBin;
if (process.platform === 'win32') process.env.PATHEXT = '.CMD;.EXE';
const fakeInvocation = resolveCommand('fake-cli', ['--version']);
check('resolves a CLI from PATH', fakeInvocation != null);
if (process.platform === 'win32') {
  check('routes Windows shims through cmd.exe', fakeInvocation?.file.toLowerCase().endsWith('cmd.exe') ?? false);
  check('keeps the resolved shim as an argument', fakeInvocation?.args.includes(fakeCli) ?? false);
}
if (previousPath === undefined) delete process.env.PATH;
else process.env.PATH = previousPath;
if (previousPathext === undefined) delete process.env.PATHEXT;
else process.env.PATHEXT = previousPathext;

// ---------------------------------------------------------------------------
// The Claude Code reply parser
// ---------------------------------------------------------------------------

check(
  'bare JSON',
  extractJsonObject('{"action":"volume","level":35}').action === 'volume',
);
check(
  'the CLI envelope is unwrapped first',
  extractJsonObject(JSON.stringify({ result: '{"action":"volume"}', total_cost_usd: 0.01 }))
    .action === 'volume',
);
check(
  'a fenced block inside the envelope',
  extractJsonObject(
    JSON.stringify({ result: '```json\n{"action":"dns"}\n```' }),
  ).action === 'dns',
);
check(
  'a sentence of preamble before the object',
  extractJsonObject("Sure, here you go:\n{\"action\":\"wifi\"}").action === 'wifi',
);
check(
  'nested objects survive the outermost-brace scan',
  ((extractJsonObject('{"a":{"b":{"c":1}},"d":2}').a as Record<string, unknown>)
    .b as Record<string, unknown>).c === 1,
);
// Refused by the brace scan rather than by the isArray guard — the scan runs
// first and an array has no `{` to find. Asserting on the message rather than
// merely on "it threw", because a refusal for the wrong reason is how the
// conformance suite once passed a test it was not actually running.
throws('an array is refused', () => extractJsonObject('[1,2,3]'), /no JSON object/);
throws('prose alone is refused', () => extractJsonObject('I cannot help with that.'), /no JSON object/);

const prompt = buildJsonPrompt(
  {
    system: 'You plan.',
    user: 'set volume to 35',
    maxTokens: 512,
    tool: {
      name: 'plan',
      description: 'Produce a plan.',
      schema: { type: 'object', properties: { steps: { type: 'array' } } },
    },
  },
  false,
);
check('the prompt carries the schema, since there is no tool call to carry it', prompt.includes('"steps"'));
check('and asks for JSON alone', /JSON object alone/.test(prompt));

const insistent = buildJsonPrompt(
  { system: 's', user: 'u', maxTokens: 10, tool: { name: 't', description: 'd', schema: {} } },
  true,
);
check('the retry says what went wrong last time', /could not be parsed/.test(insistent));

// Some OpenAI-compatible gateways answer with HTTP 400 when a model emits
// ordinary text despite tool_choice=required. The provider should retry the
// same planning request in JSON-only mode, not strand the task at planning.
const originalFetch = globalThis.fetch;
let providerCalls = 0;
globalThis.fetch = (async () => {
  providerCalls += 1;
  if (providerCalls === 1) {
    return new Response(
      JSON.stringify({ error: { message: 'Tool choice is required, but model did not call a tool' } }),
      { status: 400 },
    );
  }
  return new Response(
    JSON.stringify({ choices: [{ message: { content: '{"steps":[{"id":"step_1"}]}' } }] }),
    { status: 200 },
  );
}) as typeof fetch;
try {
  const provider = new OpenAiCompatProvider('test-key', 'test-model', 'http://test.invalid', 'test');
  const fallback = await provider.callTool({
    system: 'Plan the request.',
    user: 'write a game',
    maxTokens: 512,
    tool: { name: 'create_execution_plan', description: 'Create a plan', schema: {} },
  });
  check('recovers when a gateway rejects a missing required tool call', providerCalls === 2 && Array.isArray(fallback.steps));
} finally {
  globalThis.fetch = originalFetch;
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(failures === 0 ? '\nAll settings checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
}

void main();
