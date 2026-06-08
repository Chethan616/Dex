/**
 * Tests for the non-disruption banned-API scanner.
 *
 * Two layers of coverage:
 *   1. Positive: a synthetic source containing real banned calls produces
 *      hits with the right line numbers + API metadata.
 *   2. Negative: legitimate code that MENTIONS the API name in a comment,
 *      a string, or as a prefix to a longer identifier produces NO hits.
 *      This is the false-positive guard the plan section §9 of H.1 calls
 *      for.
 */
import { describe, expect, it } from "vitest";
import {
  BANNED_APIS,
  scanSourceForBannedApis,
  type BannedApi,
} from "./non-disruption.js";

describe("BANNED_APIS registry", () => {
  it("covers all four major platforms", () => {
    const platforms = new Set(BANNED_APIS.map((a) => a.os));
    expect(platforms.has("win32")).toBe(true);
    expect(platforms.has("macos")).toBe(true);
    expect(platforms.has("x11")).toBe(true);
    expect(platforms.has("extension")).toBe(true);
    expect(platforms.has("chrome-cdp")).toBe(true);
  });

  it("every entry has a non-empty `because` so test failures are actionable", () => {
    for (const api of BANNED_APIS) {
      expect(api.because.length).toBeGreaterThan(20);
    }
  });

  it("includes the headline Windows focus-stealing APIs", () => {
    const names = new Set(BANNED_APIS.map((a) => a.name));
    expect(names.has("SetForegroundWindow")).toBe(true);
    expect(names.has("BringWindowToTop")).toBe(true);
    expect(names.has("SetFocus")).toBe(true);
    expect(names.has("SendInput")).toBe(true);
    expect(names.has("mouse_event")).toBe(true);
    expect(names.has("keybd_event")).toBe(true);
  });

  it("includes the browser-extension banned tab/window calls", () => {
    const names = new Set(BANNED_APIS.map((a) => a.name));
    expect(names.has("chrome.tabs.update")).toBe(true);
    expect(names.has("chrome.windows.update")).toBe(true);
    expect(names.has("Page.bringToFront")).toBe(true);
  });
});

describe("scanSourceForBannedApis — positive cases (must catch violations)", () => {
  it("catches a direct call to SetForegroundWindow", () => {
    const src = `
import { user32 } from "node-ffi";
function focus(hwnd: number): void {
  user32.SetForegroundWindow(hwnd);
}
`;
    const hits = scanSourceForBannedApis(src);
    expect(hits.length).toBe(1);
    expect(hits[0]!.api.name).toBe("SetForegroundWindow");
    expect(hits[0]!.line).toBe(4);
  });

  it("catches an AXUIElementPerformAction call (macOS raise)", () => {
    const src = `let rc = AXUIElementPerformAction(elem, kAXRaiseAction);`;
    const hits = scanSourceForBannedApis(src);
    expect(hits.length).toBe(1);
    expect(hits[0]!.api.name).toBe("AXUIElementPerformAction");
  });

  it("catches chrome.tabs.update inside an extension content script", () => {
    const src = `chrome.tabs.update(tabId, { active: true });`;
    const hits = scanSourceForBannedApis(src);
    expect(hits.length).toBe(1);
    expect(hits[0]!.api.name).toBe("chrome.tabs.update");
  });

  it("catches multiple banned calls in one file", () => {
    const src = `
function bad1() { SetForegroundWindow(h); }
function bad2() { BringWindowToTop(h); }
function bad3() { SendInput(1, &input, sizeof(INPUT)); }
`;
    const hits = scanSourceForBannedApis(src);
    expect(hits.length).toBe(3);
    expect(hits.map((h) => h.api.name).sort()).toEqual(
      ["BringWindowToTop", "SendInput", "SetForegroundWindow"].sort(),
    );
  });

  it("catches whitespace between name and `(`", () => {
    const src = `Page.bringToFront ();`;
    const hits = scanSourceForBannedApis(src);
    expect(hits.length).toBe(1);
  });
});

describe("scanSourceForBannedApis — negative cases (must NOT false-positive)", () => {
  it("ignores a // comment that narrates the API name", () => {
    const src = `// note: never call SetForegroundWindow here, observer mode forbids it`;
    expect(scanSourceForBannedApis(src)).toEqual([]);
  });

  it("ignores a /* ... */ multi-line comment narration", () => {
    const src = `
/* banned APIs:
 * SetForegroundWindow(hwnd) — focus steal
 * BringWindowToTop(hwnd) — Z-order
 */
function ok() { return 1; }
`;
    expect(scanSourceForBannedApis(src)).toEqual([]);
  });

  it("ignores a string literal containing the call-syntax", () => {
    const src = `const banned = "SetForegroundWindow(hwnd) — never call this";`;
    expect(scanSourceForBannedApis(src)).toEqual([]);
  });

  it("ignores a prefix collision (SetForegroundWindowEx is not banned)", () => {
    // We never call SetForegroundWindowEx in real Dex code either, but
    // if a hypothetical safe API shared a prefix, the scanner must NOT
    // false-positive on it. The regex requires the EXACT name followed
    // by an open paren.
    const src = `SetForegroundWindowEx(hwnd, 0);`;
    expect(scanSourceForBannedApis(src)).toEqual([]);
  });

  it("ignores a # comment (Python sidecar source)", () => {
    const src = `# AXUIElementPerformAction is forbidden — observer mode\nreturn None`;
    expect(scanSourceForBannedApis(src)).toEqual([]);
  });

  it("ignores call-sites inside backtick template literals", () => {
    const src = "const msg = `you cannot call SetForegroundWindow(hwnd) here`;";
    expect(scanSourceForBannedApis(src)).toEqual([]);
  });

  it("the allowlist option lets a specific API slip past", () => {
    const src = `SetForegroundWindow(hwnd);`;
    const hits = scanSourceForBannedApis(src, {
      allowlistApis: new Set(["SetForegroundWindow"]),
    });
    expect(hits).toEqual([]);
  });
});

describe("scanSourceForBannedApis — line accuracy", () => {
  it("reports 1-indexed line numbers", () => {
    const src = `line1\nline2\nSetForegroundWindow(h);\nline4`;
    const hits = scanSourceForBannedApis(src);
    expect(hits[0]!.line).toBe(3);
  });

  it("excerpt is trimmed and capped at 160 chars", () => {
    const padding = "x".repeat(200);
    const src = `  SetForegroundWindow(h); // ${padding}`;
    const hits = scanSourceForBannedApis(src);
    expect(hits[0]!.excerpt.length).toBeLessThanOrEqual(160);
    expect(hits[0]!.excerpt.startsWith("SetForegroundWindow(")).toBe(true);
  });
});

describe("BannedApi shape", () => {
  it("name field is always a non-empty string", () => {
    for (const api of BANNED_APIS) {
      expect(typeof api.name).toBe("string");
      expect(api.name.length).toBeGreaterThan(0);
    }
  });

  it("os field is in the closed union", () => {
    const allowed: ReadonlySet<BannedApi["os"]> = new Set([
      "win32",
      "macos",
      "x11",
      "wayland",
      "chrome-cdp",
      "extension",
    ] as const);
    for (const api of BANNED_APIS) {
      expect(allowed.has(api.os)).toBe(true);
    }
  });
});
