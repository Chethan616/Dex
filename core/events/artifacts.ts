/**
 * What a step produced, described so the app can draw it instead of read it out.
 *
 * A file search that finds twenty documents was being reported like this:
 *
 *     find files: count 20, root C:\Users\cheth\Downloads, query dex,
 *     query_terms dex, matches name=DEX_V3_Project_Report_Review_Ready_final.docx
 *     path=C:\Users\cheth\Downloads\DEX_V3_Project_Report_Review_Ready_final.docx
 *     directory=C:\Users\cheth\Downloads, name=… (+12 more)
 *
 * Every fact is there and none of it is readable. The path appears three times
 * per result, the fields are named as if the reader were debugging the JSON,
 * and the one thing a person wants — which file, and can I open it — is buried.
 *
 * The fix is not a better sentence. A list of files is a list, and prose is the
 * wrong shape for it: it should be a short line saying what was found, and a
 * card the owner can scan and click. So a step that produces something with
 * structure describes it here, the description rides along on the `done` event,
 * and the app renders it.
 *
 * Deliberately narrow. This is not "serialise the agent result" — that would
 * put unbounded payloads on the socket and leave the app guessing at shapes.
 * Each kind is a contract: a fixed set of fields the UI knows how to draw, with
 * the list capped, so an action that finds nine thousand files sends a card and
 * a count rather than nine thousand rows.
 */

/** As many rows as a card can show before scanning it stops being quicker than a search. */
const MAX_ITEMS = 12;

export interface ArtifactItem {
  /** Filename, or whatever the row is called. */
  label: string;
  /** Full path — shown small, and what a click opens. */
  detail?: string;
  /** Why this is in the answer: 'filename', 'OCR text', 'also called "uid"'. */
  reasons?: string[];
  /** A line of the matching text, when the match was on content. */
  excerpt?: string;
  bytes?: number;
  modified?: number;
}

export interface Artifact {
  kind: 'files';
  /** The card's heading. */
  title: string;
  items: ArtifactItem[];
  /** How many there were in total, which is not always how many are shown. */
  total: number;
  /** What was searched, and how much of it — shown under the heading. */
  note?: string;
}

/**
 * Describe a step's result, or return nothing when a sentence is the better
 * shape. Most actions are: "the volume is 35" needs no card.
 */
export function describeArtifact(action: string, data: unknown): Artifact | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;

  if (action === 'find_files') return describeFiles(record);
  return undefined;
}

function describeFiles(data: Record<string, unknown>): Artifact | undefined {
  const raw = Array.isArray(data.matches) ? data.matches : [];
  if (raw.length === 0) return undefined;

  const items: ArtifactItem[] = [];
  for (const entry of raw.slice(0, MAX_ITEMS)) {
    if (!entry || typeof entry !== 'object') continue;
    const match = entry as Record<string, unknown>;
    const path = typeof match.path === 'string' ? match.path : '';
    if (!path) continue;

    items.push({
      label: typeof match.name === 'string' && match.name ? match.name : basename(path),
      detail: path,
      reasons: Array.isArray(match.why)
        ? match.why.filter((r): r is string => typeof r === 'string')
        : undefined,
      excerpt: typeof match.snippet === 'string' && match.snippet ? match.snippet : undefined,
      bytes: typeof match.size === 'number' ? match.size : undefined,
      modified: typeof match.modified === 'number' ? match.modified : undefined,
    });
  }
  if (items.length === 0) return undefined;

  const total = typeof data.count === 'number' ? data.count : items.length;
  const query = typeof data.query === 'string' ? data.query : '';

  // Results the search ranked as too weak to show. Said rather than hidden:
  // a search that quietly dropped 77 near-misses and one that found only 3
  // look identical otherwise, and the owner cannot tell whether to rephrase.
  const weak = typeof data.also_matched_weakly === 'number'
    ? data.also_matched_weakly
    : 0;

  return {
    kind: 'files',
    title: total === 1 ? '1 file found' : `${total} files found`,
    items,
    total,
    note: [
      query && `for "${query}"`,
      weak > 0 ? `${weak} weaker match${weak === 1 ? '' : 'es'} not shown` : '',
      typeof data.searched === 'string' ? data.searched : '',
    ]
      .filter(Boolean)
      .join(' · ') || undefined,
  };
}

function basename(path: string): string {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return cut === -1 ? path : path.slice(cut + 1);
}
