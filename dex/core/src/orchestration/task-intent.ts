/**
 * TaskIntent parser — Phase F.1.a.
 *
 * Takes a raw user prompt and extracts a `TaskIntent` (kind + hint tokens
 * + text) the capability scorer can read. Deliberately heuristic, NOT
 * LLM-driven, so it runs in microseconds and adds zero cost to the agent
 * turn budget.
 *
 * The router does the heavy lifting via the score table; this parser's
 * job is just to surface clear signals (urls, .exe names, app keywords)
 * so the BASE_SCORE_TABLE has good inputs.
 *
 * Phase F.1.b will narrow available MCP tools per-turn based on this
 * intent; F.1.c will run the orchestrator natively. v1 just nudges the
 * agent's system prompt with the picked engine.
 */

import { classifyAppFamily } from "./context-scanner.js";
import type { AppFamily, TaskIntent, TaskKind } from "./types.js";

const URL_RE = /\b(https?:\/\/[^\s)<>]+)/gi;
const EXE_RE = /\b([\w-]+\.exe)\b/gi;
// App keywords that strongly suggest a routing decision. Casefolded match.
const APP_KEYWORDS: ReadonlyArray<{ word: string; hint: string }> = [
  // browsers / web-shaped intents
  { word: "browser", hint: "browser" },
  { word: "tab", hint: "browser" },
  { word: "url", hint: "browser" },
  { word: "website", hint: "browser" },
  { word: "page", hint: "browser" },
  { word: "form", hint: "browser" },
  { word: "login", hint: "browser" },
  { word: "scrape", hint: "browser" },
  { word: "figma", hint: "browser" },
  { word: "miro", hint: "browser" },
  { word: "canva", hint: "browser" },
  // office / system / native windows app keywords
  { word: "notepad", hint: "notepad.exe" },
  { word: "excel", hint: "excel.exe" },
  { word: "word", hint: "winword.exe" },
  { word: "powerpoint", hint: "powerpnt.exe" },
  { word: "outlook", hint: "outlook.exe" },
  { word: "calculator", hint: "calc.exe" },
  { word: "settings", hint: "systemsettings.exe" },
  { word: "whatsapp", hint: "whatsapp.exe" },
  { word: "explorer", hint: "explorer.exe" },
  // shell-shaped verbs
  { word: "git", hint: "shell" },
  { word: "npm", hint: "shell" },
  { word: "ls", hint: "shell" },
  { word: "list directory", hint: "shell" },
  { word: "list files", hint: "shell" },
  // game-shaped keywords
  { word: "game", hint: "game" },
  { word: "steam", hint: "steam.exe" },
];

// Verb → TaskKind. First-match wins.
const KIND_KEYWORDS: ReadonlyArray<{ words: ReadonlyArray<string>; kind: TaskKind }> = [
  { words: ["click", "tap", "press", "hit"], kind: "click" },
  { words: ["type", "write", "fill", "enter", "send a message", "send message"], kind: "type" },
  { words: ["open", "go to", "navigate to", "load"], kind: "navigate" },
  { words: ["extract", "scrape", "read out", "fetch", "get the"], kind: "extract" },
  { words: ["compose", "draft", "write a", "create a"], kind: "compose" },
];

/**
 * Parse a user prompt into a TaskIntent the scorer can read. Returns
 * `kind: "compound"` when no single verb dominates -- the router treats
 * that as a generic prompt and leans on the runtime context to decide.
 */
export function parseTaskIntent(rawText: string): TaskIntent {
  const text = rawText.trim();
  const lower = text.toLowerCase();

  // Pull URLs out first so we can both surface them as hints AND use
  // them to bias toward browser-use without needing keyword help.
  const urls = Array.from(text.matchAll(URL_RE), (m) => m[1] ?? "");
  const exes = Array.from(text.matchAll(EXE_RE), (m) => (m[1] ?? "").toLowerCase());

  // App-keyword hints. We add them to the hints list verbatim AND surface
  // .exe names so the runtime classifyAppFamily() picks up the right
  // family even without a foreground probe.
  const keywordHints: string[] = [];
  for (const { word, hint } of APP_KEYWORDS) {
    if (lower.includes(word)) keywordHints.push(hint);
  }

  // Kind heuristic.
  let kind: TaskKind = "compound";
  for (const { words, kind: k } of KIND_KEYWORDS) {
    if (words.some((w) => lower.includes(w))) {
      kind = k;
      break;
    }
  }

  // Dedupe + filter empties.
  const hints = Array.from(new Set([...urls, ...exes, ...keywordHints])).filter(
    (h) => h.length > 0,
  );

  return { kind, hints, text };
}

/**
 * Best-effort AppFamily guess from the hints alone, used when no real
 * foreground probe is available (e.g., the gateway is preflighting on a
 * remote machine, or the host has no UIA / Win32 APIs). Returns null when
 * the hints don't suggest anything; callers should default to "unknown".
 *
 * Order matters: URLs win (browser), then known .exe names go through the
 * shared `classifyAppFamily` table, then explicit "browser" / "game"
 * keyword hints, finally null.
 */
export function inferAppFamilyFromHints(
  hints: ReadonlyArray<string>,
): AppFamily | null {
  if (hints.some((h) => h.startsWith("http://") || h.startsWith("https://"))) {
    return "browser";
  }
  for (const h of hints) {
    if (!h.endsWith(".exe")) continue;
    const family = classifyAppFamily(h);
    if (family !== "unknown") return family;
  }
  if (hints.includes("browser")) return "browser";
  if (hints.includes("game")) return "game";
  return null;
}
