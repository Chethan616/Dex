/**
 * Files a task made, wherever it saved them — so every one gets its card.
 *
 * The outputs/ watcher (runEngine) only sees files saved in the task's own
 * folder. Agents also save to the user's home, Desktop or %TEMP%: a Blender
 * render went to `C:\Users\…\robot_render.png`, the reply said "here's your
 * render", and the chat showed nothing. So every path an agent names — in a
 * tool's output, in its own text, in its final answer — is checked. A result
 * file (picture, 3D model, document, media, archive) that exists and was
 * written during this run becomes a `file_output`, once.
 *
 * Plain-text kinds (.txt, .md, .html) count only when the agent names them in
 * its own words: a coding task's tool output is full of edited text files
 * that aren't anything to hand the user.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveAgentPath } from '../agentPaths';
import { isScratchFile } from './outputs';

/** Results whatever the task: a card even when only a tool printed the path. */
const RESULT_EXT = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'heic', 'avif',
  'glb', 'gltf', 'obj', 'fbx', 'stl', 'blend', 'ply', 'usdz', '3mf', 'dae',
  'pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'csv', 'tsv', 'odt', 'ods', 'odp', 'epub',
  'mp4', 'mov', 'webm', 'mkv', 'avi', 'mp3', 'wav', 'm4a', 'ogg', 'flac',
  'zip', '7z', 'rar', 'gz', 'tgz',
];
/** Results only when the agent itself says it made them. */
const TEXT_EXT = ['txt', 'md', 'html', 'htm', 'rtf'];

const EXT = `(?:${[...RESULT_EXT, ...TEXT_EXT].join('|')})`;
// A segment may hold spaces (`My Pictures`) but never a drive colon, so one
// path can't run into the next. The match must end at the extension.
const SEG = `[^\\\\/\\r\\n"'\`<>|*?:]+`;
// …and is followed by an end: space, quote, punctuation, or a backslash (an
// escaped `\n` or `\"` in a tool's JSON output).
const END = `(?=$|[\\s"'\`<>|,;)\\]}!?\\\\]|\\.(?:\\s|$))`;
const PATHS = new RegExp(
  [
    `[A-Za-z]:[\\\\/](?:${SEG}[\\\\/])*${SEG}?\\.${EXT}${END}`, // C:\… or C:/…
    `(?<![\\w.:/])/[A-Za-z]/(?:${SEG}/)*${SEG}?\\.${EXT}${END}`, // Git Bash /c/…
    `(?<![\\w.:/])/tmp/(?:${SEG}/)*${SEG}?\\.${EXT}${END}`, // Git Bash /tmp/…
  ].join('|'),
  'gi',
);

const extOf = (p: string): string => path.extname(p).slice(1).toLowerCase();

/** Candidate paths in a piece of agent text, as written (tool output is often JSON-escaped). */
export function pathsIn(text: string): string[] {
  if (!text) return [];
  const unescaped = text.replace(/\\{2,}/g, '\\');
  return [...new Set((unescaped.match(PATHS) ?? []).map((p) => p.trim()))];
}

export interface ArtifactFile { name: string; path: string; size: number }

/**
 * Tracks one run's artifacts: `take()` turns a piece of agent text into the
 * files to record now, each file once.
 */
export function artifactTracker(opts: {
  startedAt: number;
  cwd: string;
  /** Files here are the outputs/ watcher's; skip them. */
  skipDir?: string;
  max?: number;
}) {
  const seen = new Set<string>();
  const key = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const skip = opts.skipDir ? key(path.resolve(opts.skipDir)) + path.sep : null;
  const max = opts.max ?? 24;
  return {
    take(text: string, own: boolean): ArtifactFile[] {
      const out: ArtifactFile[] = [];
      for (const raw of pathsIn(text)) {
        if (seen.size >= max) break;
        const ext = extOf(raw);
        if (!own && TEXT_EXT.includes(ext)) continue;
        let abs: string;
        try { abs = resolveAgentPath(raw, opts.cwd); } catch { continue; }
        const k = key(abs);
        if (seen.has(k) || (skip && k.startsWith(skip))) continue;
        if (isScratchFile(abs)) continue;
        let st: fs.Stats;
        try { st = fs.statSync(abs); } catch { continue; }
        // Written during this run: a file it merely read or listed isn't its result.
        if (!st.isFile() || st.size === 0 || st.mtimeMs < opts.startedAt - 3000) continue;
        seen.add(k);
        out.push({ name: path.basename(abs), path: abs, size: st.size });
      }
      return out;
    },
  };
}
