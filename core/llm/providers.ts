import { spawn } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import { CredentialStore } from '../secrets/credential_store';
import { resolveCommand } from '../settings/which';
import {
  LlmProvider,
  RateLimited,
  ToolCallRequest,
  retryAfterMs,
  withRetry,
} from './provider';

/**
 * Groq, and anything else speaking the OpenAI chat-completions shape.
 *
 * Written against `fetch` rather than the OpenAI SDK on purpose: the surface
 * DEX uses is one POST, and a dependency that pulls its own retry, streaming
 * and telemetry machinery is not worth it for that.
 */
export class OpenAiCompatProvider implements LlmProvider {
  readonly label: string;

  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl = 'https://api.groq.com/openai/v1',
    providerName = 'groq',
  ) {
    this.label = `${providerName}/${model}`;
  }

  async callTool(request: ToolCallRequest): Promise<Record<string, unknown>> {
    const requestedOutputTokens = Math.max(request.maxTokens, 2_048);
    // A small Groq/free-tier account can reject the request based on the
    // input plus the reserved output budget. Start conservatively and retain a
    // smaller retry for a large system prompt or workflow catalogue.
    const outputBudgets = [...new Set([
      Math.min(requestedOutputTokens, 4_096),
      2_048,
    ])];
    const baseBody = {
      model: this.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      tools: [{
        type: 'function',
        function: {
          name: request.tool.name,
          description: request.tool.description,
          parameters: request.tool.schema,
        },
      }],
      temperature: 0,
    };

    return withRetry(async () => {
      let lastError = 'no tool call';
      for (const max_tokens of outputBudgets) {
        let budgetRejected = false;
        for (const mode of ['required', 'auto'] as const) {
          const body = {
            ...baseBody,
            max_tokens,
            tool_choice: mode,
            messages: mode === 'required'
              ? baseBody.messages
              : [
                  { role: 'system', content: `${request.system}\n\n` +
                    'If the tool call cannot be emitted, return only one JSON object ' +
                    'matching the requested tool arguments. Do not apologize or explain.' },
                  { role: 'user', content: request.user },
                ],
          };
          const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          });

          if (response.status === 429 || response.status >= 500) {
            throw new RateLimited(
              `${this.label} returned ${response.status}`,
              retryAfterMs(response.headers.get('retry-after')),
            );
          }

          const raw = await response.text();
          if (!response.ok) {
            // TPM/context failures are recoverable by reserving less output.
            // Retry the same call at the smaller budget before giving up.
            if (max_tokens > 2_048 &&
                (response.status === 413 ||
                  /request too large|tokens per minute.*limit|context length/i.test(raw))) {
              lastError = raw.slice(0, 300);
              budgetRejected = true;
              break;
            }

            // Some OpenAI-compatible gateways reject a required tool when the
            // model emits ordinary text. Give the same request one structured
            // JSON fallback instead of turning a recoverable planner response
            // into an immediate task failure.
            if (mode === 'required' && response.status === 400 &&
                /tool choice|required|did not call|failed_generation/i.test(raw)) {
              lastError = raw.slice(0, 300);
              continue;
            }
            throw new Error(`${this.label}: HTTP ${response.status} — ${raw.slice(0, 300)}`);
          }

          let data: {
            choices?: Array<{
              message?: {
                content?: string | null;
                tool_calls?: Array<{ function?: { arguments?: string } }>;
              };
              finish_reason?: string;
            }>;
          };
          try {
            data = JSON.parse(raw) as typeof data;
          } catch {
            lastError = 'returned invalid JSON';
            continue;
          }

          const choice = data.choices?.[0];
          const call = choice?.message?.tool_calls?.[0];
          if (call?.function?.arguments) {
            try {
              return JSON.parse(call.function.arguments) as Record<string, unknown>;
            } catch {
              lastError = 'returned unparseable tool arguments';
              continue;
            }
          }

          const content = choice?.message?.content;
          if (typeof content === 'string' && content.trim()) {
            try {
              return extractJsonObject(content);
            } catch (err) {
              lastError = err instanceof Error ? err.message : String(err);
            }
          } else {
            lastError = choice?.finish_reason === 'length'
              ? 'ran out of output tokens before returning a plan'
              : `returned no tool call (finish_reason=${choice?.finish_reason ?? 'unknown'})`;
          }
        }
        if (budgetRejected) continue;
      }

      throw new Error(`${this.label} could not produce a planning tool call — ${lastError}`);
    }, { label: this.label });
  }
}

/** Empty settings fields must restore the provider default, not become a model ID. */
export function configuredBrainModel(fallback: string): string {
  const configured = process.env.DEX_BRAIN_MODEL?.trim();
  return configured || fallback;
}

export class AnthropicProvider implements LlmProvider {
  readonly label: string;
  private client: Anthropic;

  constructor(apiKey: string, private model: string) {
    this.client = new Anthropic({ apiKey });
    this.label = `anthropic/${model}`;
  }

  async callTool(request: ToolCallRequest): Promise<Record<string, unknown>> {
    return withRetry(async () => {
      let response;
      try {
        response = await this.client.messages.create({
          model: this.model,
          max_tokens: request.maxTokens,
          system: request.system,
          tools: [{
            name: request.tool.name,
            description: request.tool.description,
            input_schema: request.tool.schema as Anthropic.Tool['input_schema'],
          }],
          tool_choice: { type: 'any' },
          messages: [{ role: 'user', content: request.user }],
        });
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 429 || (status ?? 0) >= 500) {
          const headers = (err as { headers?: Record<string, string> }).headers;
          throw new RateLimited(`${this.label} returned ${status}`, retryAfterMs(headers?.['retry-after'] ?? null));
        }
        throw err;
      }

      const toolUse = response.content.find((block) => block.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') {
        throw new Error(`${this.label} returned no tool call`);
      }
      return toolUse.input as Record<string, unknown>;
    }, { label: this.label });
  }
}

/**
 * Builds the Brain's provider from configuration.
 *
 * Keys come from the OS credential store first and the environment second, so
 * the supported way to hold a secret is the encrypted one — see
 * core/secrets/credential_store.ts. Nothing here reads config.yaml.
 */
export function buildBrainProvider(credentials = new CredentialStore()): LlmProvider {
  const configured = (process.env.DEX_BRAIN_PROVIDER ?? '').toLowerCase();

  // Presence check only — `has` does not decrypt and does not warn. Resolving
  // both keys eagerly would nag the owner about a plaintext key belonging to a
  // vendor DEX is not even going to call.
  const provider =
    configured ||
    (credentials.has('groq_api_key') || process.env.GROQ_API_KEY ? 'groq' : '') ||
    (credentials.has('anthropic_api_key') || process.env.ANTHROPIC_API_KEY ? 'anthropic' : '');

  // Never reached by the fallback chain above, only by being asked for.
  // Claude Code spends the owner's own subscription session, so it is chosen
  // deliberately in Settings and never fallen back into because a key happened
  // to be missing.
  if (provider === 'claude-code') {
    return new ClaudeCodeProvider(configuredBrainModel('sonnet'));
  }

  if (provider === 'groq') {
    const key = credentials.resolve('groq_api_key', 'GROQ_API_KEY');
    if (!key) throw new Error('DEX_BRAIN_PROVIDER=groq but no groq_api_key — run: npm run cred -- set groq_api_key');
    return new OpenAiCompatProvider(key, configuredBrainModel('openai/gpt-oss-120b'));
  }

  if (provider === 'anthropic') {
    const key = credentials.resolve('anthropic_api_key', 'ANTHROPIC_API_KEY');
    if (!key) throw new Error('DEX_BRAIN_PROVIDER=anthropic but no anthropic_api_key — run: npm run cred -- set anthropic_api_key');
    return new AnthropicProvider(key, configuredBrainModel('claude-sonnet-4-6'));
  }

  throw new Error(
    'No Brain provider configured. Open Settings, or store a key and DEX will\n' +
      'pick it up:\n' +
      '  npm run cred -- set groq_api_key        (then DEX_BRAIN_PROVIDER=groq)\n' +
      '  npm run cred -- set anthropic_api_key\n' +
      'Or, with no key at all, use the Claude Code you are already signed in to:\n' +
      '  DEX_BRAIN_PROVIDER=claude-code',
  );
}

/**
 * The Brain, running on the Claude Code you are already signed in to.
 *
 * The point of this provider is that it needs no API key. If you have a Claude
 * Pro or Max subscription and the `claude` CLI is signed in on this machine,
 * Dex plans with it and there is nothing extra to pay. Otherwise Dex needs an
 * Anthropic or Groq key, which is what the other two providers are for.
 *
 * Three things about this are worth knowing before relying on it:
 *
 * 1. **It is a text interface, not a tool-calling one.** The CLI in `--print`
 *    mode returns a string. There is no `tool_use` block to read, so the schema
 *    is described in the prompt and the reply is parsed. That is strictly less
 *    reliable than the native tool call `AnthropicProvider` gets, which is why
 *    the API-key path stays the recommended one and this reports its failures
 *    loudly instead of pretending.
 *
 * 2. **Tools are disabled deliberately.** `--allowedTools ""` and
 *    `--permission-mode plan` mean the CLI cannot read files, run commands or
 *    touch the machine. Dex is the agent here; Claude Code is being asked for
 *    one judgement, and a planner that could quietly go and edit files on its
 *    own would be a serious and surprising escalation.
 *
 * 3. **`--bare` is not passed, on purpose.** That flag forces API-key
 *    authentication and never reads the OAuth login — it would defeat the whole
 *    reason this exists.
 */
export class ClaudeCodeProvider implements LlmProvider {
  readonly label: string;

  constructor(
    private model: string,
    private cliPath = 'claude',
    private timeoutMs = 120_000,
  ) {
    this.label = `claude-code/${model}`;
  }

  async callTool(request: ToolCallRequest): Promise<Record<string, unknown>> {
    return withRetry(async () => {
      // One retry with a blunter instruction. Models that wrap JSON in prose
      // usually stop when told a second time; models that cannot produce the
      // shape at all will not be fixed by a third attempt, and looping on that
      // just burns the owner's session.
      let lastError: Error | undefined;
      for (const insistence of [false, true]) {
        const raw = await this.ask(buildJsonPrompt(request, insistence));
        try {
          return extractJsonObject(raw);
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
        }
      }
      throw new Error(
        `${this.label} did not return JSON matching ${request.tool.name}: ${lastError?.message}`,
      );
    }, { label: this.label });
  }

  private ask(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const invocation = resolveCommand(this.cliPath, [
        '--print',
        '--output-format', 'json',
        '--model', this.model,
        // No tools, no filesystem, no shell. See the note above.
        '--allowedTools', '',
        '--permission-mode', 'plan',
      ]);

      if (!invocation) {
        reject(
          new Error(
            `Could not find the Claude Code CLI (${this.cliPath}). ` +
              'Install it with: npm i -g @anthropic-ai/claude-code',
          ),
        );
        return;
      }

      const child = spawn(
        invocation.file,
        invocation.args,
        { windowsHide: true },
      );

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`${this.label} timed out after ${this.timeoutMs / 1000}s`));
      }, this.timeoutMs);

      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(
          new Error(
            `Could not run the Claude Code CLI (${this.cliPath}): ${err.message}. ` +
              'Install it with: npm i -g @anthropic-ai/claude-code',
          ),
        );
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          const detail = stderr.trim() || stdout.trim() || `exit ${code}`;
          // The two failures worth naming, because their fixes are different.
          const hint = /not logged in|unauthor|authenticat/i.test(detail)
            ? ' — run `claude` in a terminal once and sign in'
            : /rate|limit|usage/i.test(detail)
              ? ' — your Claude Code usage limit is reached; it resets on its own'
              : '';
          reject(new Error(`${this.label} failed: ${detail}${hint}`));
          return;
        }
        resolve(stdout);
      });

      child.stdin.end(prompt);
    });
  }
}

/**
 * The CLI's own envelope, then the model's answer inside it.
 *
 * `--output-format json` wraps the reply in `{ "result": "..." }` along with
 * cost and session metadata. The model's JSON is inside that string, often
 * inside a fenced code block, sometimes with a sentence in front of it. All
 * three are unwrapped here.
 */
export function extractJsonObject(raw: string): Record<string, unknown> {
  let text = raw.trim();

  try {
    const envelope = JSON.parse(text) as { result?: unknown; is_error?: boolean };
    if (typeof envelope.result === 'string') text = envelope.result.trim();
  } catch {
    // Not the CLI envelope — treat what we were given as the answer.
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();

  // Fall back to the outermost braces. Scanning from both ends rather than
  // regex-matching, because tool arguments contain nested objects.
  if (!text.startsWith('{')) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error(`no JSON object in: ${text.slice(0, 200)}`);
    }
    text = text.slice(start, end + 1);
  }

  const parsed = JSON.parse(text) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('expected a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/** The tool schema, described rather than declared, because this path is text. */
export function buildJsonPrompt(request: ToolCallRequest, insist: boolean): string {
  const parts = [
    request.system,
    '',
    `Answer by producing arguments for "${request.tool.name}": ${request.tool.description}`,
    '',
    'They must satisfy this JSON Schema:',
    JSON.stringify(request.tool.schema, null, 2),
    '',
    'Reply with the JSON object alone. No prose, no code fence, no explanation.',
  ];
  if (insist) {
    parts.push(
      '',
      'Your previous reply could not be parsed. The entire reply must be one ' +
        'JSON object beginning with { and ending with }, and nothing else.',
    );
  }
  parts.push('', request.user);
  return parts.join('\n');
}
