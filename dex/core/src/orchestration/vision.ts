/**
 * VisionService — Phase E.0.
 *
 * A shared "screen parser" capability that any AutomationEngine can borrow
 * mid-run when its primary input channel (DOM for browser-use, UIA for
 * ufo-uia) returns no actionable hit for the target region. The router
 * still picks ONE engine per task; this is NOT a sibling engine but a
 * sub-service the chosen engine calls.
 *
 * Why this exists instead of "make OmniParser the engine for canvas
 * tasks": OmniParser only returns coordinates. It has no input channel
 * of its own in a browser (no Playwright handle) or in a desktop app
 * (no UFO² UIA session). So switching to OmniParser as a primary engine
 * for, say, a Figma canvas is incoherent — Playwright still owns the
 * click. The right shape is "browser-use is the executor, vision is the
 * sense organ".
 *
 * Concrete implementation lands in E.1 (wraps the existing
 * dex/core/drivers/omniparser/server.py parse_screen MCP tool). E.0 ships
 * the interface so engine adapters can start declaring their `vision?:
 * VisionService` slot without depending on the impl yet.
 */

/**
 * What an engine asks the vision service to find on screen.
 *
 * The `region` is interpreted in the engine's natural coordinate space:
 * viewport pixels for browser-use, native-window pixels for ufo-uia. When
 * omitted, vision scans the full active surface.
 */
export interface VisionRequest {
  /** Optional clip rectangle. Bounds the screenshot vision processes. */
  region?: VisionRegion;
  /**
   * Free-form description of what to find ("Export button", "the blue
   * cart icon"). Helps the screen parser rank candidates when multiple
   * matches exist.
   */
  hint?: string;
  /** Caller's wall-clock budget. Vision honours this; over-budget returns []. */
  timeoutMs: number;
}

export interface VisionRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One detected interactive element. */
export interface VisionHit {
  /** Bounding box in the same coordinate space as `VisionRequest.region`. */
  bbox: [number, number, number, number];
  /** Human-readable label, e.g. "Export". May be empty for icons. */
  label: string;
  /** Element type from the parser, e.g. "button", "input", "image". */
  type: string;
  /** Parser confidence, 0..1. Callers may filter on this. */
  confidence: number;
}

/**
 * The contract every vision provider implements. OmniParser is the only
 * planned provider for v1; the interface stays narrow so a future cloud-
 * hosted vision model could slot in without touching engine code.
 */
export interface VisionService {
  /**
   * Locate interactive elements that match the request. Returns `[]` when
   * the service is unavailable OR no hits matched OR vision ran over the
   * caller's `timeoutMs` budget — callers MUST treat empty as "no help
   * from vision, fall back to your normal 'element not found' branch",
   * not as success-with-zero-results.
   */
  locate(req: VisionRequest): Promise<VisionHit[]>;

  /**
   * Cheap availability probe; implementations cache the result. Engines
   * call this once at construction to decide whether to even consider
   * vision-assist as a fallback path during execution.
   */
  ready(): Promise<boolean>;
}

/**
 * No-op vision service. Useful for tests and for the default registry
 * entry when OmniParser isn't installed — engines that ask for vision
 * get `[]` back and proceed with their normal "element not found"
 * handling.
 */
export class NullVisionService implements VisionService {
  async locate(_req: VisionRequest): Promise<VisionHit[]> {
    return [];
  }
  async ready(): Promise<boolean> {
    return false;
  }
}
