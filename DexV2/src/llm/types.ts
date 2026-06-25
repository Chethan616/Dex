export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
}

export type ContextPolicy = 'none' | 'summary' | 'full';

export interface ChatParams {
  messages: Message[];
  tools?: ToolDef[];
  responseSchema?: object;
  responseFormat?: 'text' | 'json';
  maxTokens?: number;
  temperature?: number;
  cacheKey?: string;
  injectHistory?: ContextPolicy;
  tier: number;
  model: string;
}

export interface StreamChunk {
  text?: string;
  toolCall?: {
    name: string;
    arguments: string;
  };
}

export interface ModelTier {
  tier: number;
  provider: 'gemini' | 'claude' | 'groq';
  tpm: number;
  prefixCache: boolean;
  jsonSchema: boolean;
}
