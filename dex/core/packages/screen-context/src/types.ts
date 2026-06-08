/**
 * @dexagent/screen-context — type contract.
 *
 * Phase H.2 scaffold. These types define what `createScreenContext()`
 * promises to its callers (the gateway dispatch, the Flutter Live panel,
 * the mobile mesh request handler). Implementations land in H.3+ behind
 * the H.1 verification gate at `docs/h-research/screen-context-comparison.md`
 * §12.
 *
 * Design choices:
 *
 *   - The capture surface is SCOPED -- requests target the user's
 *     CURRENTLY-FOREGROUND window only. Whole-desktop capture is
 *     intentionally not exposed; Dex's non-disruption invariant means
 *     we don't snapshot other apps the user is running.
 *   - Image payloads are opt-in per session. Default is text-only.
 *     This keeps the cross-device transport small AND preserves
 *     privacy for sensitive apps the user hasn't reviewed.
 *   - Every read path returns Result<T, ScreenContextError> -- the
 *     facade boundary is exception-free, same as @dexagent/file-intel.
 */

/** App family the foreground process belongs to. */
export type ScreenAppFamily =
  | "browser"
  | "ide"
  | "office"
  | "terminal"
  | "pdf-reader"
  | "media"
  | "game"
  | "system"
  | "unknown";

/** What kind of content extraction succeeded. The reasoning LLM can use
 *  these to weight its confidence. */
export type ExtractionSource =
  | "uia"          // Windows UI Automation tree
  | "ax"           // macOS Accessibility API
  | "at-spi2"      // Linux AT-SPI accessibility bridge
  | "cdp"          // Chrome DevTools Protocol (browser DOM)
  | "vscode-mcp"   // VS Code MCP server
  | "jetbrains-mcp"
  | "omniparser"   // Microsoft OmniParser vision parse
  | "ocr"          // Tesseract fallback
  | "none";        // capture happened but no usable extraction

export interface FocusedAppInfo {
  /** Lowercased basename: chrome.exe, code.exe, winword.exe, ... */
  processName: string;
  /** Best-effort window title; may be empty when the window has none. */
  windowTitle: string;
  family: ScreenAppFamily;
  /** OS process id (Win32 DWORD, macOS pid_t, Linux pid). */
  pid: number;
}

export interface ViewportInfo {
  widthPx: number;
  heightPx: number;
  dpiScale: number;
}

export interface ExtractedCode {
  /** ISO language tag if we could guess one ("typescript", "python", ...). */
  language: string;
  source: string;
  /** Line range visible in the editor viewport, when the extractor knows. */
  visibleLineStart?: number;
  visibleLineEnd?: number;
}

export interface ExtractedTable {
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}

export interface ScreenshotPayload {
  /** WebP-compressed (quality 75) when shipping cross-device; raw PNG when
   *  staying local. */
  mimeType: "image/png" | "image/webp" | "image/jpeg";
  /** Base64-encoded bytes. */
  base64: string;
  /** Original sample dimensions before any downscale. */
  sampledFromW: number;
  sampledFromH: number;
}

/** What a successful capture returns. */
export interface ContextPayload {
  capturedAtMs: number;
  app: FocusedAppInfo;
  viewport: ViewportInfo;
  /** Best-effort merged text from UIA + OCR. Always present, possibly empty. */
  visibleText: string;
  /** The extraction sources actually used to build visibleText. */
  sources: readonly ExtractionSource[];
  /** Optional: code editor content when the foreground app is an IDE. */
  code?: ExtractedCode;
  /** Optional: extracted error message + stack when a terminal is foreground. */
  errorMessage?: string;
  stackTrace?: readonly string[];
  /** Optional: a structured table when the app exposes one. */
  table?: ExtractedTable;
  /** Optional: compressed screenshot. Included ONLY when the user has
   *  granted per-session image consent. */
  image?: ScreenshotPayload;
}

/** Caller's request to capture the focused window. */
export interface CaptureRequest {
  /** Per-pair session id; the gateway sets this from the WebSocket frame. */
  sessionId: string;
  /** Caller's wall-clock budget (ms). The capture path stops + degrades
   *  before exceeding this -- partial payloads are surfaced. */
  timeoutMs: number;
  /** True if the user explicitly granted image-payload consent for this
   *  session. Default false. */
  includeImage?: boolean;
  /** Optional clip rectangle. When omitted, capture the full foreground
   *  window. */
  region?: { x: number; y: number; w: number; h: number };
  /** Free-form caller hint passed to OmniParser when vision falls through
   *  ("the Export button", "the error message"). */
  hint?: string;
}

/** Closed union of all error kinds the facade may surface. */
export type ScreenContextErrorKind =
  | "not-yet-implemented"
  | "permission-denied"
  | "app-deny-listed"
  | "capture-failed"
  | "no-foreground-window"
  | "timeout"
  | "unsupported-platform"
  | "internal";

export interface ScreenContextError {
  kind: ScreenContextErrorKind;
  message: string;
  details?: Record<string, unknown>;
}

/** Result discriminated union (mirrors @dexagent/file-intel). */
export type Result<T, E = ScreenContextError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Per-app deny list — apps Dex never captures regardless of session
 *  consent. Set by the user via Settings; passed in at gateway init. */
export interface AppDenyList {
  /** Lowercased process basenames (e.g. "1password.exe", "keepassxc.exe"). */
  processes: readonly string[];
  /** Window-title substrings ("Login", "Password Manager"). */
  titleSubstrings: readonly string[];
}

export function notYetImplemented(surface: string): ScreenContextError {
  return {
    kind: "not-yet-implemented",
    message:
      `@dexagent/screen-context.${surface} is scaffold-only. ` +
      "Implementation gated on H.1 verification spot-checks; see " +
      "docs/h-research/screen-context-comparison.md §12.",
  };
}
