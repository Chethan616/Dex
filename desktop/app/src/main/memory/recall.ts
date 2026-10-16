/**
 * DEX's memory as an index, so a task is told what bears on it instead of
 * everything DEX knows.
 *
 * Every note, site and routine is a node, filed under a topic and reachable
 * by its words. A task's prompt reaches nodes two ways: words it shares with
 * one ("Gmail" → the note about their work mail), and topics its words point
 * at ("attendance" → study → where they study and their student portal,
 * whichever those are). Briefing a task (engines/memory.ts) costs the core
 * facts, a handful of matches and a one-line map of the rest; `dex-recall`
 * walks the same index for anything else, mid-task.
 *
 * Built fresh from the stores each time: a few hundred small nodes, no cost
 * worth caching, and never stale.
 */
import { topicsIn, wordsOf, TOPICS, type Topic } from '../../shared/memoryTopics';
import { triggerText, type Workflow } from '../../shared/workflows';
import type { MemoryNote } from './notes';
import type { SafeSiteRecord } from './siteStore';

export interface MemoryNode {
  kind: 'note' | 'site' | 'routine';
  /** A note's id, a site's host, a routine's name. */
  id: string;
  /** How it reads in a prompt. */
  text: string;
  topic: Topic;
  core?: boolean;
  at?: number;
  terms: Set<string>;
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'my', 'me', 'i', 'im', 'is', 'are', 'was', 'it', 'its', 'at', 'with', 'from',
  'by', 'this', 'that', 'be', 'do', 'does', 'can', 'could', 'you', 'your', 'what', 'please', 'dex', 'them', 'they', 'their', 'theirs',
  'get', 'got', 'make', 'want', 'need', 'let', 'lets', 'just', 'now', 'today', 'some', 'any', 'all', 'how', 'when', 'where', 'who', 'which',
  'there', 'here', 'have', 'has', 'had', 'will', 'would', 'should', 'about', 'into', 'up', 'out', 'so', 'if', 'then', 'than', 'also', 'u',
]);

const termsOf = (text: string): Set<string> => new Set(wordsOf(text).filter((w) => w.length > 1 && !STOP.has(w)));

export function siteText(s: SafeSiteRecord): string {
  const called = s.aliases.length ? ` — they call it ${s.aliases.slice(0, 6).map((a) => `“${a}”`).join(', ')}` : '';
  const login = s.hasPassword ? '; login saved (sign in with `dex-fill`, never ask for it)' : s.hasUsername ? '; username saved' : '';
  return `${s.url ?? s.host}${called}${login}`;
}

export function nodesOf(
  notes: MemoryNote[],
  sites: SafeSiteRecord[],
  routines: Array<Pick<Workflow, 'name' | 'trigger' | 'enabled'>>,
): MemoryNode[] {
  return [
    ...notes.map((n): MemoryNode => ({ kind: 'note', id: n.id, text: n.text, topic: n.topic, core: n.core, at: n.at, terms: termsOf(n.text) })),
    ...sites.map((s): MemoryNode => ({
      kind: 'site', id: s.host, text: siteText(s),
      topic: topicsIn(s.aliases.join(' '))[0] ?? 'other',
      terms: new Set([...termsOf(s.aliases.join(' ')), ...s.host.split('.').filter((p) => p.length > 2 && !['www', 'com', 'org', 'net'].includes(p))]),
    })),
    ...routines.filter((w) => w.enabled !== false).map((w): MemoryNode => ({
      kind: 'routine', id: w.name, text: `Routine “${w.name}” (${triggerText(w.trigger).toLowerCase()}) — run it with \`dex-workflow run "${w.name}"\``,
      topic: 'routines', terms: new Set([...termsOf(w.name), 'routine', 'workflow']),
    })),
  ];
}

/** Two words meet when they're the same, or one starts the other ("attend" / "attendance"). */
const meets = (a: string, b: string): boolean => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

/** The nodes a request bears on, best first. */
export function recall(nodes: MemoryNode[], query: string, limit = 6): MemoryNode[] {
  const want = [...termsOf(query)];
  const topics = new Set(topicsIn(query));
  if (want.length === 0) return [];
  return nodes
    .map((n) => {
      let score = 0;
      for (const w of want) {
        if (n.terms.has(w)) score += 3;
        else if ([...n.terms].some((t) => meets(t, w))) score += 2;
      }
      // A topic alone reaches a node too, if more weakly: "attendance" finds
      // where they study though no word is shared.
      if (topics.has(n.topic)) score += n.kind === 'site' ? 2 : 1.5;
      return { n, score };
    })
    .filter((x) => x.score >= 1.5)
    .sort((a, b) => b.score - a.score || (b.n.at ?? 0) - (a.n.at ?? 0))
    .slice(0, limit)
    .map((x) => x.n);
}

/** "14 notes (studies, work, food), 3 sites and 2 routines" — what else there is. */
export function outline(nodes: MemoryNode[]): string {
  const notes = nodes.filter((n) => n.kind === 'note');
  const byTopic = new Map<Topic, number>();
  for (const n of notes) byTopic.set(n.topic, (byTopic.get(n.topic) ?? 0) + 1);
  const topics = [...byTopic].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => TOPICS[t].label.toLowerCase());
  const sites = nodes.filter((n) => n.kind === 'site').length;
  const routines = nodes.filter((n) => n.kind === 'routine').length;
  const parts = [
    notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}${topics.length ? ` (${topics.join(', ')})` : ''}` : '',
    sites ? `${sites} site${sites === 1 ? '' : 's'}` : '',
    routines ? `${routines} routine${routines === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? '';
}

