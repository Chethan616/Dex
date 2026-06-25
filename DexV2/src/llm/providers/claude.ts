import { LLMProvider } from '../provider.js';
import { ChatParams, StreamChunk, ToolDef } from '../types.js';
import { logger } from '../../utils/logger.js';

const MODULE = 'CLAUDE_PROVIDER';

export class ClaudeProvider implements LLMProvider {
  id = 'claude';
  authMode: 'api_key' = 'api_key';

  supports = {
    streaming: true,
    toolCalling: false,
    structuredOutput: true,
    jsonSchema: true,
    vision: true,
    prefixCaching: true,
  };

  private getApiKey(): string {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not defined.');
    }
    return key;
  }

  async *chat(params: ChatParams): AsyncGenerator<StreamChunk> {
    const apiKey = this.getApiKey();
    const url = 'https://api.anthropic.com/v1/messages';

    const systemPrompt = `Dex: Windows automation agent, full admin. Respond ONLY with JSON matching the provided schema. No prose.
Output Schema:\n${params.responseSchema ? JSON.stringify(params.responseSchema) : 'none'}
Available Tools:\n` + (params.tools?.map(t => `${t.name}: ${t.description} (Args Schema: ${JSON.stringify(t.inputSchema)})`).join('\n') || '');

    const system = [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' }
      }
    ];

    const requestBody: any = {
      model: params.model,
      max_tokens: params.maxTokens ?? 256,
      temperature: params.temperature ?? 0.0,
      system,
      messages: params.messages,
      stream: true,
    };

    logger.debug(MODULE, `Sending request to Anthropic model: ${params.model}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API error: ${response.statusText} (${response.status}) - ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body reader not available.');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]') continue;
            try {
              const json = JSON.parse(dataStr);
              if (json.type === 'content_block_delta' && json.delta?.text) {
                yield { text: json.delta.text };
              }
            } catch (err) {
              // Ignore partial parse failures
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  estimateTokens(messages: any[]): number {
    let charCount = 0;
    for (const m of messages) {
      charCount += m.content?.length || 0;
    }
    return Math.ceil(charCount / 3.5);
  }

  async warmCache(tier: number, tools: ToolDef[]): Promise<string> {
    // Anthropic performs caching implicitly when cache_control block is hit.
    return 'anthropic-ephemeral-cache-enabled';
  }
}
