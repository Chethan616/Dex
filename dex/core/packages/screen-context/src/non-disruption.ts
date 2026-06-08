/**
 * Non-disruption invariant — Phase H.7 (shipped here as part of the H.2
 * scaffold so it can guard every H.3+ commit from day one).
 *
 * Observer mode is non-negotiable: screen-context code may NEVER call APIs
 * that bring a window to the foreground, switch tabs, steal focus, or
 * interrupt fullscreen apps. This module:
 *
 *   1. Enumerates the banned APIs across Win32, macOS, X11, Wayland, the
 *      Chrome DevTools Protocol, and browser-extension surfaces.
 *   2. Provides `scanSourceForBannedApis(source, options?)` — a regex
 *      scanner that finds banned API call-sites in a source string.
 *   3. Provides `scanFilesForBannedApis(paths)` — convenience wrapper
 *      around #2 for the policy.test.ts to feed it the package's source
 *      tree.
 *
 * The scanner intentionally matches CALL-SITES (`SetForegroundWindow(`)
 * not narrative mentions in comments / docstrings ("don't call
 * SetForegroundWindow"). Tests cover both positive and negative cases.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * One banned API. The `name` is the function/method identifier exactly
 * as it appears in source; the `os` field is informational (UI for the
 * policy report, never used by the scanner). `because` lands in the
 * test failure message so the contributor knows why they're blocked.
 */
export interface BannedApi {
  name: string;
  os: "win32" | "macos" | "x11" | "wayland" | "chrome-cdp" | "extension";
  because: string;
}

export const BANNED_APIS: readonly BannedApi[] = [
  // ---- Win32 ----
  {
    name: "SetForegroundWindow",
    os: "win32",
    because: "brings the target window to the foreground; violates observer mode",
  },
  {
    name: "BringWindowToTop",
    os: "win32",
    because: "rearranges Z-order; violates observer mode",
  },
  {
    name: "SetFocus",
    os: "win32",
    because: "steals keyboard focus; violates observer mode",
  },
  {
    name: "SwitchToThisWindow",
    os: "win32",
    because: "alt-tab equivalent; violates observer mode",
  },
  {
    name: "SetActiveWindow",
    os: "win32",
    because: "raises + focuses; violates observer mode",
  },
  {
    name: "ShowWindow",
    os: "win32",
    because:
      "ShowWindow with SW_RESTORE / SW_SHOW reveals hidden windows. " +
      "If you need it for a read-only HWND query, use GetWindowLong instead.",
  },
  {
    name: "AllowSetForegroundWindow",
    os: "win32",
    because: "grants another process the right to steal focus; never needed",
  },
  {
    name: "AttachThreadInput",
    os: "win32",
    because: "thread-input attach is the classic focus-steal workaround",
  },
  {
    name: "mouse_event",
    os: "win32",
    because: "synthesizes mouse input; observer mode forbids any input injection",
  },
  {
    name: "keybd_event",
    os: "win32",
    because: "synthesizes keyboard input; observer mode forbids any input injection",
  },
  {
    name: "SendInput",
    os: "win32",
    because: "synthesizes input; observer mode forbids any input injection",
  },
  // ---- macOS ----
  {
    name: "activateIgnoringOtherApps",
    os: "macos",
    because: "[NSApplication activateIgnoringOtherApps:] brings the app forward",
  },
  {
    name: "AXUIElementPerformAction",
    os: "macos",
    because:
      "AXUIElementPerformAction with kAXRaiseAction brings the window to " +
      "the foreground; read-only AX queries are fine, action calls are not",
  },
  {
    name: "CGEventPost",
    os: "macos",
    because: "synthetic event injection; observer mode forbids input injection",
  },
  // ---- X11 ----
  {
    name: "XRaiseWindow",
    os: "x11",
    because: "raises the window to the top of the stack; violates observer mode",
  },
  {
    name: "XSetInputFocus",
    os: "x11",
    because: "steals focus; violates observer mode",
  },
  {
    name: "XSendEvent",
    os: "x11",
    because: "synthetic event injection; observer mode forbids input injection",
  },
  // ---- Wayland ----
  // No standard "raise window" API on Wayland by design. The xdg-toplevel
  // protocol's activation request requires a fresh xdg_activation_token
  // and the compositor's discretion. No call-site bans here -- the
  // protocol enforces the invariant.

  // ---- Chrome DevTools Protocol / browser extension ----
  {
    name: "chrome.tabs.update",
    os: "extension",
    because:
      "switches the active tab. The screen-context inspector reads the " +
      "CURRENT tab; switching to another is a disruption.",
  },
  {
    name: "chrome.windows.update",
    os: "extension",
    because: "focuses / moves a window; violates observer mode",
  },
  {
    name: "Page.bringToFront",
    os: "chrome-cdp",
    because:
      "CDP method that focuses the inspected page. Read-only CDP methods " +
      "(Accessibility.getFullAXTree, DOM.getDocument) are fine.",
  },
];

export interface BannedApiHit {
  /** The API that matched. */
  api: BannedApi;
  /** 1-indexed line number in the source where the call-site was found. */
  line: number;
  /** Excerpt of the matching line for the test failure message. */
  excerpt: string;
}

export interface ScanOptions {
  /** Allow some specific banned-API names to slip through. Useful for the
   *  test file that intentionally references the API in a string to test
   *  the scanner itself. Default: empty set. */
  allowlistApis?: ReadonlySet<string>;
}

/**
 * Scan a source string for banned-API CALL-SITES. Returns an empty array
 * when the source is clean.
 *
 * Matching rule: `<ApiName>` followed (after optional whitespace) by `(`.
 * This excludes:
 *   - Plain narrative mentions in comments / docstrings.
 *   - Identifier-prefix collisions (e.g. `SetForegroundWindowEx` doesn't
 *     match because the regex requires the exact name followed by `(`,
 *     not a name prefix).
 *
 * It catches:
 *   - Direct calls: `SetForegroundWindow(hwnd)`
 *   - Property access calls: `user32.SetForegroundWindow(hwnd)`
 *   - Method calls: `obj.AXUIElementPerformAction(...)`
 *   - Whitespace before paren: `Page.bringToFront ()`
 */
export function scanSourceForBannedApis(
  source: string,
  options: ScanOptions = {},
): BannedApiHit[] {
  const allowlist = options.allowlistApis ?? new Set<string>();
  const hits: BannedApiHit[] = [];
  const lines = source.split(/\r?\n/);
  // Precompile patterns once per scan -- not per (api × line) -- so a
  // policy.test.ts sweep over a real package is fast.
  const apiPatterns = BANNED_APIS
    .filter((api) => !allowlist.has(api.name))
    .map((api) => ({
      api,
      // Word-boundary lookbehind + name + optional ws + `(`. Lookbehind
      // keeps the preceding `"` / `'` / `` ` `` in the prefix so
      // looksInsideString() can see them.
      pattern: new RegExp(
        `(?<![A-Za-z0-9_])${escapeRegex(api.name)}\\s*\\(`,
        "g",
      ),
    }));

  // Track multi-line block-comment state across the file. /* opens it,
  // */ closes it. Anything between is narration, never a call-site.
  let insideBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    // Compute the "effective" line for scanning: strip any portion that
    // sits inside an open block comment that started on an earlier line,
    // AND strip any `/* ... */` block opened+closed on this line.
    let effective = rawLine;
    if (insideBlockComment) {
      const closeIdx = effective.indexOf("*/");
      if (closeIdx === -1) {
        // Whole line is still inside the block comment; no API matches possible.
        continue;
      }
      // Block closes mid-line; only the part after `*/` is real code.
      effective = effective.substring(closeIdx + 2);
      insideBlockComment = false;
    }
    // Now collapse any /* ... */ pairs that open + close within `effective`.
    effective = effective.replace(/\/\*[\s\S]*?\*\//g, "");
    // If a `/*` opens without a `*/` on the same line, the rest of the
    // file (until a `*/`) is comment territory.
    const openIdx = effective.indexOf("/*");
    if (openIdx !== -1) {
      effective = effective.substring(0, openIdx);
      insideBlockComment = true;
    }

    for (const { api, pattern } of apiPatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(effective)) !== null) {
        // Map the match index back to the original line and check the
        // preceding chars for single-line comment (// or #) markers or
        // open quote characters.
        const matchIdx = match.index;
        const beforeMatch = effective.substring(0, matchIdx);
        if (looksLikeComment(beforeMatch) || looksInsideString(beforeMatch)) {
          continue;
        }
        hits.push({
          api,
          line: i + 1,
          excerpt: rawLine.trim().substring(0, 160),
        });
      }
    }
  }
  return hits;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function looksLikeComment(prefix: string): boolean {
  // Single-line comment markers on the SAME line, earlier than the
  // call-site. Block comments are handled by the multi-line state
  // machine in scanSourceForBannedApis itself.
  return /(?:\/\/|#)/.test(prefix);
}

function looksInsideString(prefix: string): boolean {
  // Odd number of unescaped quote chars before the match -> we're inside
  // a string literal. Cheap proxy; fine for our purposes since real
  // call-sites never sit inside strings.
  const doubleQuotes = (prefix.match(/(?<!\\)"/g) ?? []).length;
  const singleQuotes = (prefix.match(/(?<!\\)'/g) ?? []).length;
  const backticks = (prefix.match(/(?<!\\)`/g) ?? []).length;
  return (
    doubleQuotes % 2 === 1 ||
    singleQuotes % 2 === 1 ||
    backticks % 2 === 1
  );
}

/**
 * Scan every file under a directory tree for banned-API call-sites.
 * The CI policy test passes this the package's own `src/` and fails
 * the build if anything turns up.
 */
export async function scanFilesForBannedApis(
  roots: readonly string[],
  options: ScanOptions = {},
): Promise<{ path: string; hits: BannedApiHit[] }[]> {
  const results: { path: string; hits: BannedApiHit[] }[] = [];
  for (const root of roots) {
    const files = await collectSourceFiles(root);
    for (const filePath of files) {
      // Don't scan the policy module itself or its tests -- they
      // reference the banned API names in strings/identifiers
      // intentionally.
      const base = path.basename(filePath);
      if (base === "non-disruption.ts" || base === "non-disruption.test.ts") {
        continue;
      }
      const source = await fs.readFile(filePath, "utf-8");
      const hits = scanSourceForBannedApis(source, options);
      if (hits.length > 0) results.push({ path: filePath, hits });
    }
  }
  return results;
}

async function collectSourceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        await walk(full);
      } else if (entry.isFile() && /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

/** Format hits for a vitest failure message. */
export function formatHitsForTestFailure(
  results: readonly { path: string; hits: readonly BannedApiHit[] }[],
): string {
  const lines: string[] = [];
  for (const { path: p, hits } of results) {
    lines.push(`  ${p}:`);
    for (const hit of hits) {
      lines.push(
        `    L${hit.line}: ${hit.api.name} -- ${hit.api.because}`,
      );
      lines.push(`      > ${hit.excerpt}`);
    }
  }
  return lines.join("\n");
}
