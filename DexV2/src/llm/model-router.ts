import { ModelTier } from './types.js';

export const MODEL_TIERS: Record<string, ModelTier> = {
  'gemini-2.5-flash-lite': { tier: 1, provider: 'gemini', tpm: 1000000, prefixCache: true, jsonSchema: true },
  'openai/gpt-oss-20b': { tier: 1, provider: 'groq', tpm: 250000, prefixCache: false, jsonSchema: false },

  'gemini-2.5-flash': { tier: 2, provider: 'gemini', tpm: 1000000, prefixCache: true, jsonSchema: true },
  'claude-sonnet-4-5': { tier: 2, provider: 'claude', tpm: 80000, prefixCache: true, jsonSchema: true },
  'llama-3.3-70b-versatile': { tier: 2, provider: 'groq', tpm: 300000, prefixCache: false, jsonSchema: false },

  'gemini-2.5-pro': { tier: 3, provider: 'gemini', tpm: 100000, prefixCache: true, jsonSchema: true },
  'claude-opus-4-5': { tier: 3, provider: 'claude', tpm: 40000, prefixCache: true, jsonSchema: true },
  'openai/gpt-oss-120b': { tier: 3, provider: 'groq', tpm: 250000, prefixCache: false, jsonSchema: false },
};

const FALLBACK_CHAIN: Record<number, string[]> = {
  1: ['gemini-2.5-flash-lite', 'openai/gpt-oss-20b'],
  2: ['gemini-2.5-flash', 'claude-sonnet-4-5', 'llama-3.3-70b-versatile'],
  3: ['gemini-2.5-pro', 'claude-opus-4-5', 'openai/gpt-oss-120b', 'gemini-2.5-flash'],
};

type ProviderId = 'gemini' | 'claude' | 'groq';
type ProviderMode = 'auto' | 'prefer-groq' | 'groq-only';

function isProviderAvailable(provider: ProviderId): boolean {
  if (provider === 'gemini') return !!process.env.GEMINI_API_KEY;
  if (provider === 'claude') return !!process.env.ANTHROPIC_API_KEY;
  if (provider === 'groq') return !!process.env.GROQ_API_KEY;
  return false;
}

function getProviderMode(): ProviderMode {
  const raw = (process.env.DEX_PROVIDER_MODE || '').trim().toLowerCase();
  if (raw === 'auto' || raw === 'prefer-groq' || raw === 'groq-only') {
    return raw;
  }

  // Groq becomes the default planner when available, while still allowing
  // explicit opt-out through DEX_PROVIDER_MODE.
  return process.env.GROQ_API_KEY ? 'groq-only' : 'auto';
}

function prioritizeGroq(modelIds: string[]): string[] {
  return [...modelIds].sort((left, right) => {
    const leftScore = MODEL_TIERS[left]?.provider === 'groq' ? 0 : 1;
    const rightScore = MODEL_TIERS[right]?.provider === 'groq' ? 0 : 1;
    return leftScore - rightScore;
  });
}

function applyProviderMode(modelIds: string[], mode: ProviderMode): string[] {
  if (mode === 'groq-only') {
    return modelIds.filter(modelId => MODEL_TIERS[modelId]?.provider === 'groq');
  }

  if (mode === 'prefer-groq') {
    return prioritizeGroq(modelIds);
  }

  return modelIds;
}

export function resolveModel(tier: number): { model: string; providerId: ProviderId } {
  // Ensure tier falls in valid range, rounding up 0.5 parametric intents to Flash (Tier 1) if LLM falls back
  const targetTier = Math.max(1, Math.min(3, Math.floor(tier === 0.5 ? 1 : tier)));
  const candidates = FALLBACK_CHAIN[targetTier] || [];
  const providerMode = getProviderMode();
  const effectiveCandidates = applyProviderMode(candidates, providerMode);

  for (const modelId of effectiveCandidates) {
    const meta = MODEL_TIERS[modelId];
    if (meta && isProviderAvailable(meta.provider)) {
      return { model: modelId, providerId: meta.provider };
    }
  }

  if (effectiveCandidates.length > 0) {
    const fallbackModel = effectiveCandidates[0];
    const fallbackProvider = MODEL_TIERS[fallbackModel]?.provider || 'groq';
    return { model: fallbackModel, providerId: fallbackProvider };
  }

  // Default to standard configured primary model if no keys are found
  const fallbackModel = candidates[0] || 'gemini-2.5-flash-lite';
  const fallbackProvider = MODEL_TIERS[fallbackModel]?.provider || 'gemini';
  return { model: fallbackModel, providerId: fallbackProvider };
}
