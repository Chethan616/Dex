import { expect, test, describe } from 'vitest';
import { getEmbedding, cosineSimilarity } from '../../src/brain/intent-embedder.js';

describe('intent embedder (MiniLM)', () => {
  test('generates valid Float32Array embedding', async () => {
    const text = 'open notepad';
    const emb = await getEmbedding(text);
    expect(emb).toBeInstanceOf(Float32Array);
    expect(emb.length).toBe(384);
  }, 60000);

  test('calculates cosine similarity correctly', () => {
    const v1 = new Float32Array([1.0, 0.0, 0.0]);
    const v2 = new Float32Array([1.0, 0.0, 0.0]);
    const v3 = new Float32Array([0.0, 1.0, 0.0]);
    const v4 = new Float32Array([1.0, 1.0, 0.0]);

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0, 5);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(0.0, 5);
    expect(cosineSimilarity(v1, v4)).toBeCloseTo(0.7071, 4);
  });

  test('semantically similar sentences have high similarity', async () => {
    const emb1 = await getEmbedding('open google chrome');
    const emb2 = await getEmbedding('launch chrome web browser');
    const emb3 = await getEmbedding('empty the recycle bin');

    const simSimilar = cosineSimilarity(emb1, emb2);
    const simDifferent = cosineSimilarity(emb1, emb3);

    expect(simSimilar).toBeGreaterThan(0.7);
    expect(simDifferent).toBeLessThan(0.4);
  }, 60000);
});
