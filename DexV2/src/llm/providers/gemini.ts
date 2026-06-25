import { LLMProvider } from '../provider.js';
import { ChatParams, StreamChunk, ToolDef } from '../types.js';
import { logger } from '../../utils/logger.js';

const MODULE = 'GEMINI_PROVIDER';

export class GeminiProvider implements LLMProvider {
  id = 'gemini';
  authMode: 'oauth' | 'api_key' = 'api_key';

  supports = {
    streaming: true,
    toolCalling: false, // We use JSON schema for tool execution planning
    structuredOutput: true,
    jsonSchema: true,
    vision: true,
    prefixCaching: true,
  };

  private getApiKey(): string {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY environment variable is not defined.');
    }
    return key;
  }

  async *chat(params: ChatParams): AsyncGenerator<StreamChunk> {
    const apiKey = this.getApiKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    // System prompt and tools details combined
    const systemPrompt = `Dex: Windows automation agent, full admin. Respond ONLY with JSON matching the provided schema. No prose.
Available Tools:\n` + (params.tools?.map(t => `${t.name}: ${t.description}`).join('\n') || '');

    const requestBody: any = {
      contents: params.messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      })),
      generationConfig: {
        temperature: params.temperature ?? 0.0,
        maxOutputTokens: params.maxTokens ?? 256,
      }
    };

    if (params.responseSchema) {
      requestBody.generationConfig.responseMimeType = 'application/json';
      requestBody.generationConfig.responseSchema = params.responseSchema;
    }

    if (params.cacheKey) {
      requestBody.cachedContent = params.cacheKey;
    } else {
      requestBody.systemInstruction = {
        parts: [{ text: systemPrompt }]
      };
    }

    logger.debug(MODULE, `Sending request to Gemini model: ${params.model}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error: ${response.statusText} (${response.status}) - ${errText}`);
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
          if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim();
            if (dataStr === '[DONE]') continue;
            try {
              const json = JSON.parse(dataStr);
              const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                yield { text };
              }
            } catch (err) {
              // Ignore line parse errors
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
    const apiKey = this.getApiKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${apiKey}`;

    const systemPrompt = `Dex: Windows automation agent, full admin. Respond ONLY with JSON matching the provided schema. No prose.
Available Tools:\n` + (tools.map(t => `${t.name}: ${t.description}`).join('\n') || '');

    const requestBody = {
      model: 'models/gemini-2.5-flash',
      ttl: '3600s',
      contents: [{
        role: 'user',
        parts: [{ text: systemPrompt }]
      }]
    };

    logger.debug(MODULE, 'Warming context cache for Gemini...');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini context cache error: ${response.statusText} (${response.status}) - ${errText}`);
    }

    const data = await response.json();
    logger.info(MODULE, `Context cache created: ${data.name}`);
    return data.name; // returns "cachedContents/abc123"
  }
}
