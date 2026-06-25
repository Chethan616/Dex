import { LLMProvider } from '../provider.js';
import { ChatParams, StreamChunk, ToolDef } from '../types.js';
import { logger } from '../../utils/logger.js';

const MODULE = 'GROQ_PROVIDER';

export class GroqProvider implements LLMProvider {
  id = 'groq';
  authMode: 'api_key' = 'api_key';

  supports = {
    streaming: true,
    toolCalling: false,
    structuredOutput: false,
    jsonSchema: false,
    vision: false,
    prefixCaching: false,
  };

  private getApiKey(): string {
    const key = process.env.GROQ_API_KEY;
    if (!key) {
      throw new Error('GROQ_API_KEY environment variable is not defined.');
    }
    return key;
  }

  async *chat(params: ChatParams): AsyncGenerator<StreamChunk> {
    const apiKey = this.getApiKey();
    const url = 'https://api.groq.com/openai/v1/chat/completions';

    const systemPrompt = `Dex: Windows automation agent, full admin. Respond ONLY with JSON matching the provided schema. No prose.
Available Tools:\n` + (params.tools?.map(t => `${t.name}: ${t.description}`).join('\n') || '');

    const messages = [
      { role: 'system', content: systemPrompt },
      ...params.messages
    ];

    const requestBody: any = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.0,
      max_tokens: params.maxTokens ?? 256,
      stream: true,
    };

    logger.debug(MODULE, `Sending request to Groq model: ${params.model}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Groq API error: ${response.statusText} (${response.status}) - ${errText}`);
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
              const content = json.choices?.[0]?.delta?.content;
              if (content) {
                yield { text: content };
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
    return Math.ceil(charCount / 4);
  }

  async warmCache(tier: number, tools: ToolDef[]): Promise<string> {
    return 'groq-no-cache-supported';
  }
}
