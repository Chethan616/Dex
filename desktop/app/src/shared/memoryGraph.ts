/**
 * DEX's memory as a graph, the way graphify maps a codebase: what the user
 * has told DEX, read into the things it's about — people, places, projects,
 * skills, tools, interests, goals, habits, preferences — and how they connect.
 * Settings › Memory draws it; `dex-recall` walks it for any engine.
 *
 * Built by Settings' Index button (main/memory/graph.ts): a model reads the
 * notes once and names the entities and relations; without one, a local pass
 * links notes by topic and shared words. Pure functions here, shared by main
 * (queries for agents) and the hub (layout and search).
 */

export const DIMENSIONS = ['identity', 'people', 'places', 'work', 'study', 'skills', 'tools', 'interests', 'goals', 'habits', 'preferences', 'other'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  identity: 'Identity', people: 'People', places: 'Places', work: 'Work', study: 'Studies', skills: 'Skills', tools: 'Tools',
  interests: 'Interests', goals: 'Goals', habits: 'Habits', preferences: 'Preferences', other: 'Other',
};

export interface GraphNode {
  id: string;
  label: string;
  dimension: Dimension;
  /** One line on what DEX knows about it. */
  summary?: string;
  /** The notes it comes from. */
  notes: string[];
  /** Filled in by analyse(): its links, and its community. */
  degree?: number;
  community?: number;
}

export interface GraphEdge { from: string; to: string; label: string }

export interface MemoryGraph {
  version: 1;
  builtAt: number;
  /** Who read the notes: a model, or the local fallback. */
  by: 'claude-code' | 'codex' | 'local';
  /** How many notes it was built from, and their fingerprint (to say when it's out of date). */
  noteCount: number;
  noteHash: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: Array<{ id: number; label: string; size: number }>;
}

export const isDimension = (v: unknown): v is Dimension => typeof v === 'string' && (DIMENSIONS as readonly string[]).includes(v);

const slug = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'node';

/** A fingerprint of the notes, so the page can say the graph is behind. */
export function hashNotes(notes: Array<{ id: string; text: string }>): string {
  let h = 2166136261;
  for (const n of [...notes].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const ch of `${n.id}\u0000${n.text}\u0001`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  }
  return h.toString(36);
}

/**
 * The model's answer as a graph: entities with known dimensions, relations
 * between entities that exist, note ids that exist. Anything else is dropped,
 * so a sloppy answer gives a smaller graph rather than a broken one.
 */
export function graphFromModel(raw: unknown, noteIds: Set<string>): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { entities?: unknown; nodes?: unknown; relations?: unknown; edges?: unknown };
  const list = (Array.isArray(o.entities) ? o.entities : Array.isArray(o.nodes) ? o.nodes : []) as Array<Record<string, unknown>>;
  const nodes: GraphNode[] = [];
  const byKey = new Map<string, string>();
  for (const e of list.slice(0, 160)) {
    if (!e || typeof e !== 'object') continue;
    const label = typeof e.label === 'string' ? e.label.trim() : typeof e.name === 'string' ? e.name.trim() : '';
    if (!label) continue;
    let id = slug(typeof e.id === 'string' && e.id.trim() ? e.id : label);
    while (nodes.some((n) => n.id === id)) id = `${id}-2`;
    const dim = typeof e.dimension === 'string' ? e.dimension.toLowerCase() : typeof e.kind === 'string' ? e.kind.toLowerCase() : 'other';
    const notes = (Array.isArray(e.notes) ? e.notes : []).filter((n): n is string => typeof n === 'string' && noteIds.has(n));
    nodes.push({ id, label: label.slice(0, 60), dimension: isDimension(dim) ? dim : 'other', summary: typeof e.summary === 'string' ? e.summary.trim().slice(0, 200) : undefined, notes });
    for (const k of [typeof e.id === 'string' ? e.id : '', label, id]) if (k) byKey.set(k.toLowerCase(), id);
  }
  const rels = (Array.isArray(o.relations) ? o.relations : Array.isArray(o.edges) ? o.edges : []) as Array<Record<string, unknown>>;
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const r of rels.slice(0, 400)) {
    if (!r || typeof r !== 'object') continue;
    const from = byKey.get(String(r.from ?? r.source ?? '').toLowerCase());
    const to = byKey.get(String(r.to ?? r.target ?? '').toLowerCase());
    if (!from || !to || from === to) continue;
    const key = [from, to].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from, to, label: typeof r.label === 'string' ? r.label.trim().slice(0, 40) : typeof r.relation === 'string' ? r.relation.trim().slice(0, 40) : 'related' });
  }
  return { nodes, edges };
}

/** Links, communities (label propagation, seeded so it's stable), and each community's name: its best-linked node. */
export function analyse(nodes: GraphNode[], edges: GraphEdge[]): { nodes: GraphNode[]; communities: MemoryGraph['communities'] } {
  const full = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) { full.get(e.from)?.push(e.to); full.get(e.to)?.push(e.from); }
  // A hub linked to most of the graph (the person themselves) would pull everything into one group: leave it out of the grouping.
  const hub = [...nodes].sort((a, b) => full.get(b.id)!.length - full.get(a.id)!.length)[0];
  const hubId = hub && full.get(hub.id)!.length > Math.max(4, nodes.length * 0.25) ? hub.id : null;
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, full.get(n.id)!.filter((m) => m !== hubId)]));
  // Communities by modularity (Louvain's local moves): each node joins the neighbouring group that
  // gains the most, until nothing moves. Unlike label propagation it doesn't collapse a connected graph into one.
  const label = new Map(nodes.map((n, i) => [n.id, i]));
  const deg = new Map(nodes.map((n) => [n.id, adj.get(n.id)!.length]));
  const m2 = Math.max(1, [...deg.values()].reduce((x, y) => x + y, 0));
  const tot = new Map<number, number>(nodes.map((n, i) => [i, deg.get(n.id)!]));
  const order = [...nodes].sort((a, b) => (deg.get(b.id)! - deg.get(a.id)!) || a.id.localeCompare(b.id));
  for (let round = 0; round < 20; round++) {
    let moved = false;
    for (const n of order) {
      const k = deg.get(n.id)!;
      if (!k) continue;
      const own = label.get(n.id)!;
      const links = new Map<number, number>();
      for (const m of adj.get(n.id)!) links.set(label.get(m)!, (links.get(label.get(m)!) ?? 0) + 1);
      tot.set(own, tot.get(own)! - k);
      let best = own;
      let gain = (links.get(own) ?? 0) - (tot.get(own)! * k) / m2;
      for (const [c, kin] of links) {
        const g = kin - (tot.get(c)! * k) / m2;
        if (g > gain + 1e-9 || (Math.abs(g - gain) < 1e-9 && c < best)) { gain = g; best = c; }
      }
      tot.set(best, tot.get(best)! + k);
      if (best !== own) { label.set(n.id, best); moved = true; }
    }
    if (!moved) break;
  }
  // The hub goes with the group it links to most.
  if (hubId) {
    const counts = new Map<number, number>();
    for (const m of full.get(hubId)!) counts.set(label.get(m)!, (counts.get(label.get(m)!) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) label.set(hubId, top[0]);
  }
  const raw = [...new Set(label.values())];
  const groups = raw.map((l) => nodes.filter((n) => label.get(n.id) === l)).sort((a, b) => b.length - a.length);
  const out = nodes.map((n) => ({ ...n, degree: full.get(n.id)!.length }));
  const communities: MemoryGraph['communities'] = [];
  groups.forEach((g, i) => {
    const top = [...g].sort((a, b) => (a.id === hubId ? 1 : 0) - (b.id === hubId ? 1 : 0) || adj.get(b.id)!.length - adj.get(a.id)!.length)[0];
    communities.push({ id: i, label: top.label, size: g.length });
    for (const n of g) out.find((x) => x.id === n.id)!.community = i;
  });
  return { nodes: out, communities };
}

/** The nodes a query reaches (by label, summary, or a linked note's words), and their neighbours. */
export function queryGraph(g: MemoryGraph, q: string, noteText: (id: string) => string | undefined = () => undefined, limit = 8) {
  const words = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
  if (!words.length) return { matches: [] as GraphNode[], related: [] as Array<{ node: GraphNode; via: string; label: string }> };
  const score = (n: GraphNode): number => {
    const hay = `${n.label} ${n.summary ?? ''} ${n.notes.map((id) => noteText(id) ?? '').join(' ')}`.toLowerCase();
    return words.reduce((s, w) => s + (n.label.toLowerCase().includes(w) ? 3 : hay.includes(w) ? 1 : 0), 0);
  };
  const matches = g.nodes.map((n) => [n, score(n)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || (b[0].degree ?? 0) - (a[0].degree ?? 0)).slice(0, limit).map(([n]) => n);
  const hit = new Set(matches.map((n) => n.id));
  const related: Array<{ node: GraphNode; via: string; label: string }> = [];
  for (const e of g.edges) {
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      if (hit.has(a) && !hit.has(b) && !related.some((r) => r.node.id === b)) {
        const node = g.nodes.find((n) => n.id === b);
        if (node) related.push({ node, via: g.nodes.find((n) => n.id === a)!.label, label: e.label });
      }
    }
  }
  return { matches, related: related.slice(0, limit) };
}

/** The graph in a few lines, for an agent: its biggest communities and best-linked nodes. */
export function graphOutline(g: MemoryGraph, max = 6): string {
  const hubs = [...g.nodes].sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0)).slice(0, max).map((n) => n.label);
  const groups = g.communities.slice(0, max).map((c) => `${c.label} (${c.size})`);
  return `${g.nodes.length} things and ${g.edges.length} links; groups: ${groups.join(', ')}; most connected: ${hubs.join(', ')}`;
}
