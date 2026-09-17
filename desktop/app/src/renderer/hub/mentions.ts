/**
 * `@` mentions.
 *
 * Unlike a slash command, a mention never rewrites the prompt — `@drive` is
 * meant to end up as plain text inside an ordinary sentence ("find my slp da
 * @drive as well as pc"), because that is exactly the literal string
 * `dex-find`'s skill doc looks for in the user's own words. So all this module
 * does is the typing experience: notice an in-progress `@partial` ending at
 * the caret, offer completions, and splice the chosen one in as text. There
 * is no expansion step and no chip rendered inside the text itself — see the
 * decision in conversation to keep this to a plain `<textarea>` rather than
 * rewriting the inputs onto a contentEditable rich-text editor.
 */

export interface MentionDef {
  name: string;
  /** Shown in the hint row, e.g. "@drive". */
  label: string;
  summary: string;
}

export const MENTIONS: MentionDef[] = [
  {
    name: 'drive',
    label: '@drive',
    summary: 'Also search Google Drive alongside this PC.',
  },
];

/**
 * The partial word after an `@` that starts at the beginning of the text or
 * right after whitespace, ending exactly at `cursor` — or `null` when the
 * caret isn't inside one. An email-like "user@host" never matches: the `@`
 * must be preceded by nothing, or whitespace.
 */
export function activeMentionQuery(text: string, cursor: number): string | null {
  const uptoCursor = text.slice(0, cursor);
  const match = /(?:^|\s)@([a-zA-Z]*)$/.exec(uptoCursor);
  return match ? match[1] : null;
}

/** Mentions whose name starts with the partial word currently being typed. */
export function matchingMentions(text: string, cursor: number): MentionDef[] {
  const partial = activeMentionQuery(text, cursor);
  if (partial === null) return [];
  const lower = partial.toLowerCase();
  return MENTIONS.filter((mention) => mention.name.startsWith(lower));
}

export interface MentionInsertion {
  text: string;
  /** Where the caret should land — right after the trailing space. */
  cursor: number;
}

/**
 * Replace the in-progress `@partial` ending at `cursor` with `@name `, a
 * literal string substitution — nothing about the rest of the sentence
 * changes. Returns the input unchanged if the caret is not actually inside a
 * mention (defensive; callers only reach this from a matched hint).
 */
export function insertMention(text: string, cursor: number, mention: MentionDef): MentionInsertion {
  const uptoCursor = text.slice(0, cursor);
  if (!/(?:^|\s)@[a-zA-Z]*$/.test(uptoCursor)) return { text, cursor };

  const atIndex = uptoCursor.lastIndexOf('@');
  const before = text.slice(0, atIndex);
  const after = text.slice(cursor);
  const inserted = `@${mention.name} `;
  return { text: `${before}${inserted}${after}`, cursor: before.length + inserted.length };
}
