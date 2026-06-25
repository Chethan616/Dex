import { TaskIntent } from './types.js';
import { tryDeterministic } from './deterministic.js';
import { tryParametric } from './parametric.js';

const TIER2_TRIGGERS = /\b(plan|schedule|if|draw|coordinate|compile|compare|analyze|summarize|report|automate|script|loop)\b/i;

export function classifyTier(intent: TaskIntent): TaskIntent {
  if (intent.kind === 'compound' && intent.subIntents) {
    // Classify each sub-intent
    intent.subIntents = intent.subIntents.map(sub => classifyTier(sub));
    // Parent tier is the maximum of all sub-intents
    intent.tier = Math.max(...intent.subIntents.map(sub => sub.tier));
    return intent;
  }

  const norm = intent.normalized;
  
  if (tryDeterministic(norm)) {
    intent.tier = 0;
  } else if (tryParametric(norm)) {
    intent.tier = 0.5;
  } else if (TIER2_TRIGGERS.test(norm) || intent.kind === 'correction') {
    intent.tier = 2; // Reasoning / Planning Tier
  } else {
    intent.tier = 1; // Flash Tier
  }

  return intent;
}
