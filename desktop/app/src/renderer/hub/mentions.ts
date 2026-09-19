/**
 * `@` mentions.
 *
 * Unlike a slash command, a mention never rewrites the prompt — `@drive`
 * canonicalises to the literal text "@drive" inside an ordinary sentence
 * ("find my slp da @drive as well as pc"), because that is exactly the
 * string `dex-find`'s skill doc looks for in the user's own words. There is
 * no expansion step, ever, even though it renders as a real inline chip (see
 * MentionTextField.tsx) — the chip is a display detail; the value dex-find's
 * skill doc reads is always the plain "@drive" text.
 *
 * This module only defines the mention list and the pure typing-detection
 * logic — is the caret inside an in-progress "@partial", and which known
 * mentions match it. The actual chip insertion is DOM surgery and lives in
 * MentionTextField, which needs a live Selection/Range to do it and so isn't
 * unit-testable as a pure function the way this is.
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
