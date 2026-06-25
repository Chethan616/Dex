import { ModelTier } from './types.js';

export const MODEL_TIERS: Record<string, ModelTier> = {
  'gemini-2.5-flash-lite': { tier: 1, provider: 'gemini', tpm: 1000000, prefixCache: true, jsonSchema: true },
  'groq/llama-4-scout-17b': { tier: 1, provider: 'groq', tpm: 6000, prefixCache: false, jsonSchema: false },

  'gemini-2.5-flash': { tier: 2, provider: 'gemini', tpm: 1000000, prefixCache: true, jsonSchema: true },
  'claude-sonnet-4-5': { tier: 2, provider: 'claude', tpm: 80000, prefixCache: true, jsonSchema: true },
  'groq/llama-3.3-70b': { tier: 2, provider: 'groq', tpm: 6000, prefixCache: false, jsonSchema: false },

  'gemini-2.5-pro': { tier: 3, provider: 'gemini', tpm: 100000, prefixCache: true, jsonSchema: true },
  'claude-opus-4-5': { tier: 3, provider: 'claude', tpm: 40000, prefixCache: true, jsonSchema: true },
};

const FALLBACK_CHAIN: Record<number, string[]> = {
  1: ['gemini-2.5-flash-lite', 'groq/llama-4-scout-17b'],
  2: ['gemini-2.5-flash', 'claude-sonnet-4-5', 'groq/llama-3.3-70b'],
  3: ['gemini-2.5-pro', 'claude-opus-4-5', 'gemini-2.5-flash'],
};

function isProviderAvailable(provider: 'gemini' | 'claude' | 'groq'): boolean {
  if (provider === 'gemini') return !!process.env.GEMINI_API_KEY;
  if (provider === 'claude') return !!process.env.ANTHROPIC_API_KEY;
  if (provider === 'groq') return !!process.env.GROQ_API_KEY;
  return false;
}

export function resolveModel(tier: number): { model: string; providerId: 'gemini' | 'claude' | 'groq' } {
  // Ensure tier falls in valid range, rounding up 0.5 parametric intents to Flash (Tier 1) if LLM falls back
  const targetTier = Math.max(1, Math.min(3, Math.floor(tier === 0.5 ? 1 : tier)));
  const candidates = FALLBACK_CHAIN[targetTier] || [];

  for (const modelId of candidates) {
    const meta = MODEL_TIERS[modelId];
    if (meta && isProviderAvailable(meta.provider)) {
      return { model: modelId, providerId: meta.provider };
    }
  }

  // Default to standard configured primary model if no keys are found
  const fallbackModel = candidates[0] || 'gemini-2.5-flash-lite';
  const fallbackProvider = MODEL_TIERS[fallbackModel]?.provider || 'gemini';
  return { model: fallbackModel, providerId: fallbackProvider };
}
