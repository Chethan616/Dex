/**
 * The memory graph (shared/memoryGraph.ts): a model's answer read safely, groups that
 * don't collapse into one around the person, and queries for dex-recall.
 */
import { describe, expect, it } from 'vitest';
import { analyse, graphFromModel, hashNotes, queryGraph, type MemoryGraph } from '../../../src/shared/memoryGraph';

const answer = {
  entities: [
    { id: 'me', label: 'Chethan', dimension: 'identity', notes: ['n1'] },
    { id: 'vit', label: 'VIT Vellore', dimension: 'study', summary: 'B.Tech CSE (AI & ML)', notes: ['n2'] },
    { id: 'dsa', label: 'DSA course', dimension: 'study', notes: ['n3'] },
    { id: 'exams', label: 'CAT exams', dimension: 'study', notes: ['n4'] },
    { id: 'dex', label: 'DEX', dimension: 'work', summary: 'Open-source AI agent', notes: ['n5'] },
    { id: 'electron', label: 'Electron', dimension: 'tools', notes: ['n6'] },
    { id: 'compose', label: 'Jetpack Compose', dimension: 'tools', notes: ['n7', 'nope'] },
    { id: 'blender', label: 'Blender', dimension: 'weird', notes: [] },
  ],
  relations: [
    { from: 'me', to: 'vit', label: 'studies at' }, { from: 'me', to: 'dex', label: 'builds' },
    { from: 'vit', to: 'dsa', label: 'teaches' }, { from: 'vit', to: 'exams', label: 'holds' }, { from: 'dsa', to: 'exams', label: 'tested in' },
    { from: 'dex', to: 'electron', label: 'uses' }, { from: 'dex', to: 'compose', label: 'uses' }, { from: 'dex', to: 'blender', label: 'drives' },
    { from: 'electron', to: 'compose', label: 'pairs with' },
    { from: 'me', to: 'ghost', label: 'x' }, { from: 'vit', to: 'me', label: 'dup' },
  ],
};

describe('the memory graph', () => {
  const ids = new Set(['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7']);
  const built = graphFromModel(answer, ids);

  it('keeps only real entities, known dimensions, real notes and one link per pair', () => {
    expect(built.nodes).toHaveLength(8);
    expect(built.nodes.find((n) => n.id === 'blender')?.dimension).toBe('other');
    expect(built.nodes.find((n) => n.id === 'compose')?.notes).toEqual(['n7']);
    expect(built.edges).toHaveLength(9);
  });

  it('finds the two groups instead of one around the person', () => {
    const { nodes, communities } = analyse(built.nodes, built.edges);
    expect(communities.length).toBe(2);
    const of = (id: string) => nodes.find((n) => n.id === id)!.community;
    expect(of('dsa')).toBe(of('vit'));
    expect(of('electron')).toBe(of('dex'));
    expect(of('vit')).not.toBe(of('dex'));
    expect(nodes.find((n) => n.id === 'dex')!.degree).toBe(4);
  });

  it('answers a query with the things it reaches and what links to them', () => {
    const { nodes, communities } = analyse(built.nodes, built.edges);
    const g: MemoryGraph = { version: 1, builtAt: 0, by: 'local', noteCount: 7, noteHash: hashNotes([]), nodes, edges: built.edges, communities };
    const r = queryGraph(g, 'what tools does dex use');
    expect(r.matches[0].label).toBe('DEX');
    expect(r.related.map((x) => x.node.label)).toEqual(expect.arrayContaining(['Electron', 'Jetpack Compose']));
  });
});
