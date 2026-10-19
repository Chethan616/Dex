/**
 * Settings › Memory's Index: read DEX's notes into a graph (shared/memoryGraph.ts)
 * and keep it at `<userData>/memory/graph.json`, where the page draws it and
 * `dex-recall` walks it for whichever engine a task runs on.
 *
 * A model does the reading when the user has an engine signed in (one call,
 * no tools). Without one, a local pass still gives a graph: a node per topic,
 * a node per note, linked by topic and shared words.
 */
import { TOPICS, wordsOf, type Topic } from '../../shared/memoryTopics';
import { analyse, graphFromModel, hashNotes, type Dimension, type GraphEdge, type GraphNode, type MemoryGraph } from '../../shared/memoryGraph';
import { jsonIn, llmOnce } from '../llm/once';
import { mainLogger } from '../logger';
import { memoryFile, readJson, writeJson } from './files';
import type { MemoryNote } from './notes';

const GRAPH_FILE = 'graph.json';

export function readGraph(): MemoryGraph | null {
  const g = readJson<MemoryGraph>(memoryFile(GRAPH_FILE));
  return g && g.version === 1 && Array.isArray(g.nodes) ? g : null;
}

const TOPIC_DIM: Record<Topic, Dimension> = {
  about: 'identity', home: 'places', study: 'study', work: 'work', prefs: 'preferences', writing: 'preferences', food: 'preferences',
  travel: 'places', money: 'habits', health: 'habits', people: 'people', tech: 'tools', fun: 'interests', routines: 'habits', other: 'other',
};

export const INDEX_PROMPT = (notes: MemoryNote[]): string => `You are building a knowledge graph of one person from what their AI assistant remembers about them.

Read the notes below and answer with ONLY a JSON object, no prose:
{"entities": [{"id": "short-id", "label": "Name", "dimension": "one of: identity, people, places, work, study, skills, tools, interests, goals, habits, preferences, other", "summary": "one line on what the notes say about it", "notes": ["note ids it comes from"]}],
 "relations": [{"from": "entity id", "to": "entity id", "label": "a short verb phrase, e.g. studies at, builds, prefers, works with, lives in"}]}

Rules:
- The person themselves is one entity with id "me" and dimension "identity". Link "me" only to the 6–12 most central things (their university, their main project, their job hunt, their home city…).
- Everything else links to what it belongs to or works with, not to "me": a course to the university, a tool to the project that uses it, an interview to the company, a skill to the project that shows it, a habit to the goal it serves. Every entity has at least one relation; most have two or three. The graph should have clear clusters.
- Entities are the concrete things the notes are about (a university, a project, a tool, a friend, a city, a habit, a goal), merged when two notes mean the same thing. Aim for 20–80 entities.
- Every entity lists the ids of the notes it comes from. Use only ids from the list.
- Relations only between entities you listed, at most one per pair.
- No passwords, keys or card numbers, even if a note mentions one.

Notes (id · topic · text):
${notes.map((n) => `${n.id} · ${n.topic} · ${n.text.replace(/\s+/g, ' ')}`).join('\n')}
`;

/** Without a model: topics as hubs, notes as nodes, notes sharing several words linked. */
export function localGraph(notes: MemoryNote[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [{ id: 'me', label: 'You', dimension: 'identity', notes: [] }];
  const edges: GraphEdge[] = [];
  const topics = [...new Set(notes.map((n) => n.topic))];
  for (const t of topics) {
    nodes.push({ id: `topic-${t}`, label: TOPICS[t].label, dimension: TOPIC_DIM[t], notes: [] });
    edges.push({ from: 'me', to: `topic-${t}`, label: 'has' });
  }
  const terms = new Map<string, Set<string>>();
  for (const n of notes) {
    const label = n.text.length > 42 ? `${n.text.slice(0, 40).trim()}…` : n.text;
    nodes.push({ id: `note-${n.id}`, label, dimension: TOPIC_DIM[n.topic], summary: n.text, notes: [n.id] });
    edges.push({ from: `topic-${n.topic}`, to: `note-${n.id}`, label: 'about' });
    terms.set(n.id, new Set(wordsOf(n.text).filter((w) => w.length > 3)));
  }
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const a = terms.get(notes[i].id)!, b = terms.get(notes[j].id)!;
      let shared = 0;
      for (const w of a) if (b.has(w)) shared++;
      if (shared >= 2 && notes[i].topic !== notes[j].topic) edges.push({ from: `note-${notes[i].id}`, to: `note-${notes[j].id}`, label: 'related' });
    }
  }
  return { nodes, edges };
}

let indexing: Promise<MemoryGraph> | null = null;

/** Build the graph now (one at a time). */
export function indexMemory(notes: MemoryNote[], opts: { useModel?: boolean } = {}): Promise<MemoryGraph> {
  if (indexing) return indexing;
  indexing = (async () => {
    const ids = new Set(notes.map((n) => n.id));
    let built: { nodes: GraphNode[]; edges: GraphEdge[] } | null = null;
    let by: MemoryGraph['by'] = 'local';
    if (opts.useModel !== false && notes.length > 0) {
      try {
        const answer = await llmOnce(INDEX_PROMPT(notes));
        const g = graphFromModel(jsonIn(answer.text), ids);
        if (g.nodes.length >= 2) { built = g; by = answer.engine; }
      } catch (err) {
        mainLogger.warn('memory.graph.model.failed', { error: (err as Error).message });
      }
    }
    if (!built) built = localGraph(notes);
    const { nodes, communities } = analyse(built.nodes, built.edges);
    const graph: MemoryGraph = { version: 1, builtAt: Date.now(), by, noteCount: notes.length, noteHash: hashNotes(notes), nodes, edges: built.edges, communities };
    writeJson(memoryFile(GRAPH_FILE), graph);
    mainLogger.info('memory.graph.built', { by, nodes: nodes.length, edges: built.edges.length, communities: communities.length });
    return graph;
  })().finally(() => { indexing = null; });
  return indexing;
}

export const isIndexing = (): boolean => indexing !== null;
