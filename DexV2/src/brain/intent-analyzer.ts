import { TaskIntent, IntentKind } from './types.js';
import { normalizeIntent } from './intent-normalizer.js';

export function parseIntent(raw: string): TaskIntent {
  const normalized = normalizeIntent(raw);

  // Heuristic split for compound intents (e.g. separated by "and then", "then", or "and")
  const compoundDelimiters = /\b(and then|then|and)\b/i;
  const parts = normalized
    .split(compoundDelimiters)
    .map(p => p.trim())
    .filter(p => p && !/^(and then|then|and)$/i.test(p));

  let kind: IntentKind = 'single-shot';
  
  const followupKeywords = /\b(it|that|them|prev|previous|above|before)\b/i;
  const correctionKeywords = /^(no|wait|actually|sorry|correct|change to|instead)\b/i;

  if (correctionKeywords.test(normalized)) {
    kind = 'correction';
  } else if (followupKeywords.test(normalized)) {
    kind = 'followup';
  } else if (parts.length > 1) {
    kind = 'compound';
  }

  const intent: TaskIntent = {
    raw,
    normalized,
    kind,
    tier: 1, // default tier is 1 (LLM Flash)
  };

  if (kind === 'compound') {
    intent.subIntents = parts.map(part => parseIntent(part));
  }

  const references: string[] = [];
  if (normalized.includes('prev') || normalized.includes('previous') || normalized.includes('before')) {
    references.push('prev');
  }
  if (references.length > 0) {
    intent.references = references;
  }

  return intent;
}
