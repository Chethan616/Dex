import Anthropic from '@anthropic-ai/sdk';
import { CredentialStore } from '../secrets/credential_store';
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
    const body = {
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
      tool_choice: 'required',
      // Reasoning models spend output tokens thinking before they emit the
      // call. Too small a budget and the response comes back empty with
      // finish_reason=length — measured, not theoretical.
      max_tokens: Math.max(request.maxTokens, 2048),
      temperature: 0,
    };

    return withRetry(async () => {
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
      if (!response.ok) {
        throw new Error(`${this.label}: HTTP ${response.status} — ${(await response.text()).slice(0, 300)}`);
      }

      const data = await response.json() as {
        choices?: Array<{
          message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
          finish_reason?: string;
        }>;
      };

      const call = data.choices?.[0]?.message?.tool_calls?.[0];
      if (!call?.function?.arguments) {
        const reason = data.choices?.[0]?.finish_reason;
        throw new Error(
          reason === 'length'
            ? `${this.label} ran out of output tokens before calling the tool — raise max_tokens`
            : `${this.label} returned no tool call (finish_reason=${reason ?? 'unknown'})`,
        );
      }

      try {
        return JSON.parse(call.function.arguments) as Record<string, unknown>;
      } catch {
        throw new Error(`${this.label} returned unparseable tool arguments`);
      }
    }, { label: this.label });
  }
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

  if (provider === 'groq') {
    const key = credentials.resolve('groq_api_key', 'GROQ_API_KEY');
    if (!key) throw new Error('DEX_BRAIN_PROVIDER=groq but no groq_api_key — run: npm run cred -- set groq_api_key');
    return new OpenAiCompatProvider(key, process.env.DEX_BRAIN_MODEL ?? 'openai/gpt-oss-120b');
  }

  if (provider === 'anthropic') {
    const key = credentials.resolve('anthropic_api_key', 'ANTHROPIC_API_KEY');
    if (!key) throw new Error('DEX_BRAIN_PROVIDER=anthropic but no anthropic_api_key — run: npm run cred -- set anthropic_api_key');
    return new AnthropicProvider(key, process.env.DEX_BRAIN_MODEL ?? 'claude-sonnet-4-6');
  }

  throw new Error(
    'No Brain provider configured. Store a key and DEX will pick it up:\n' +
      '  npm run cred -- set groq_api_key        (then DEX_BRAIN_PROVIDER=groq)\n' +
      '  npm run cred -- set anthropic_api_key',
  );
}
