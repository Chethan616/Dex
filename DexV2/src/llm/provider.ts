import { ChatParams, StreamChunk, ToolDef } from './types.js';

export interface LLMProvider {
  id: string;
  authMode: 'oauth' | 'api_key';

  chat(params: ChatParams): AsyncGenerator<StreamChunk>;
  estimateTokens(messages: any[]): number;

  /** Warm the provider's prompt cache for the given tier and tool definitions */
  warmCache(tier: number, tools: ToolDef[]): Promise<string>;

  supports: {
    streaming: boolean;
    toolCalling: boolean;
    structuredOutput: boolean;
    jsonSchema: boolean;
    vision: boolean;
    prefixCaching: boolean;
  };
}
