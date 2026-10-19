/**
 * One question to a model, from DEX itself rather than a task: Settings ›
 * Memory's Index asks for the map of what DEX knows. It uses whichever engine
 * the user has signed in to (Claude Code, else Codex), the same login their
 * tasks use, in a throwaway folder with no tools, and returns the answer text.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnCli } from '../hl/engines/cliSpawn';
import { get as getAdapter } from '../hl/engines/registry';
import { resolveAuth, loadOpenAIKey } from '../identity/authStore';
import { engineLogger } from '../logger';

export interface LlmAnswer { text: string; engine: 'claude-code' | 'codex' }

function cleanEnv(extra: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Running DEX from inside a Claude Code session must not make this one think it's nested.
  // (CLAUDE_CODE_GIT_BASH_PATH and friends stay: Claude Code needs them on Windows.)
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT']) delete env[k];
  for (const [k, v] of Object.entries(extra)) if (v) env[k] = v;
  return env;
}

function run(bin: string, args: string[], stdin: string, env: NodeJS.ProcessEnv, cwd: string, timeoutMs: number): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    let child;
    try { child = spawnCli(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { resolve({ code: -1, out: '', err: (e as Error).message }); return; }
    let out = ''; let err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, timeoutMs);
    child.stdout.setEncoding('utf-8'); child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (c: string) => { out += c; });
    child.stderr.on('data', (c: string) => { err += c; if (err.length > 8000) err = err.slice(-8000); });
    child.on('error', (e) => { err += String(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.end(stdin, 'utf-8');
  });
}

/** Ask once. Throws with a plain reason when no engine can answer. */
export async function llmOnce(prompt: string, timeoutMs = 8 * 60_000): Promise<LlmAnswer> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-llm-'));
  const reasons: string[] = [];
  try {
    const claude = getAdapter('claude-code');
    if (claude && (await claude.probeInstalled()).installed) {
      const auth = await resolveAuth().catch(() => null);
      const authed = auth?.type === 'apiKey' || (await claude.probeAuthed()).authed;
      if (authed) {
        const env = cleanEnv({ ANTHROPIC_API_KEY: auth?.type === 'apiKey' ? auth.value : undefined });
        const r = await run(claude.binaryName, ['-p', '--output-format', 'text', '--model', 'sonnet', '--max-turns', '1'], prompt, env, cwd, timeoutMs);
        if (r.code === 0 && r.out.trim()) return { text: r.out.trim(), engine: 'claude-code' };
        reasons.push(`Claude Code: ${(r.err || r.out).trim().slice(-200) || `exit ${r.code}`}`);
        engineLogger.warn('llm.once.claude.failed', { code: r.code, err: r.err.slice(-400), out: r.out.slice(-200) });
      } else reasons.push('Claude Code is not signed in');
    }
    const codex = getAdapter('codex');
    if (codex && (await codex.probeInstalled()).installed) {
      const key = await loadOpenAIKey().catch(() => null);
      const authed = Boolean(key) || (await codex.probeAuthed()).authed;
      if (authed) {
        const last = path.join(cwd, 'answer.txt');
        const env = cleanEnv({ OPENAI_API_KEY: key ?? undefined });
        const r = await run(codex.binaryName, ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--output-last-message', last, '-'], prompt, env, cwd, timeoutMs);
        const text = fs.existsSync(last) ? fs.readFileSync(last, 'utf-8').trim() : '';
        if (text) return { text, engine: 'codex' };
        reasons.push(`Codex: ${(r.err || r.out).trim().slice(-200) || `exit ${r.code}`}`);
      } else reasons.push('Codex is not signed in');
    }
    engineLogger.warn('llm.once.failed', { reasons });
    throw new Error(reasons.length ? reasons.join('; ') : 'No engine is installed: set up Claude Code or Codex first.');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

/** The first JSON object in a model's answer (it may wrap it in a code fence or a sentence). */
export function jsonIn(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('the model did not answer with JSON');
  return JSON.parse(body.slice(start, end + 1));
}
