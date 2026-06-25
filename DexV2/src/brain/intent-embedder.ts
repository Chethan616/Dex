import { pipeline } from '@xenova/transformers';
import { logger } from '../utils/logger.js';

const MODULE = 'INTENT_EMBEDDER';
let embedderPipeline: any = null;

async function getEmbedder() {
  if (!embedderPipeline) {
    logger.info(MODULE, 'Loading local all-MiniLM-L6-v2 model...');
    embedderPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    logger.info(MODULE, 'Model loaded successfully.');
  }
  return embedderPipeline;
}

export async function getEmbedding(text: string): Promise<Float32Array> {
  const pipe = await getEmbedder();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return output.data as Float32Array;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} !== ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
