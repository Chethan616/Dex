/**
 * OmniParserVisionService — Phase E.1.
 *
 * Implements the VisionService interface on top of the same `parse_screen`
 * MCP tool that the OmniParser AutomationEngine (C.5) drives. Both callers
 * share one Python process and one cache — the gateway wires a single
 * `parseScreen` callback and hands it to BOTH `OmniParserEngine` (for
 * pure-vision tasks) and `OmniParserVisionService` (for vision-assist
 * during browser-use / ufo-uia runs).
 *
 * The service stays transport-agnostic: tests inject mock callbacks; the
 * gateway injects a real MCP-stdio bridge. Returns `[]` from `locate()`
 * for any failure path — no-transport, timeout, throw — so engine
 * adapters can treat empty-result as "vision had no help, fall back to
 * your own 'element not found' branch" without try/catch boilerplate.
 */

import type {
  VisionHit,
  VisionRequest,
  VisionService,
} from "./vision.js";

/**
 * Shape of one element returned by the Python `parse_screen` MCP tool.
 * Mirrors `OmniParserAdapterOptions.callParseScreen` in
 * `./engines/omniparser.ts` so the gateway can hand the SAME callback to
 * both the engine and the vision service.
 */
export interface ParseScreenElement {
  bbox: [number, number, number, number];
  label: string;
  type: string;
  /** Parser confidence; not all responses include it. */
  confidence?: number;
}

/** Shape of one `parse_screen` MCP call. */
export type ParseScreenCallback = (params: {
  imagePath?: string;
  region?: [number, number, number, number];
  maxElements?: number;
  timeoutMs: number;
}) => Promise<{
  elements: ParseScreenElement[];
  imagePath: string;
  modelVersion: string;
  durationMs: number;
}>;

/** Shape of the `status` MCP call (cheap availability probe). */
export type ParseScreenStatusCallback = () => Promise<{ ready: boolean }>;

export interface OmniParserVisionServiceOptions {
  /** Required transport. When undefined, locate() always returns []. */
  parseScreen?: ParseScreenCallback;
  /** Optional status probe; defaults to "ready iff parseScreen is wired". */
  status?: ParseScreenStatusCallback;
  /** Default cap on hits returned per locate(). Default 32. */
  maxElements?: number;
}

export class OmniParserVisionService implements VisionService {
  private readyCache: boolean | undefined;
  constructor(private readonly options: OmniParserVisionServiceOptions = {}) {}

  async locate(req: VisionRequest): Promise<VisionHit[]> {
    const call = this.options.parseScreen;
    if (!call) return [];
    if (req.timeoutMs <= 0) return [];

    const params = {
      region: req.region
        ? ([req.region.x, req.region.y, req.region.w, req.region.h] as [
            number,
            number,
            number,
            number,
          ])
        : undefined,
      maxElements: this.options.maxElements ?? 32,
      timeoutMs: req.timeoutMs,
    };

    // Wall-clock guard: even if the underlying transport ignores
    // timeoutMs, we never let `locate` hang past the caller's budget.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<VisionHit[]>((resolve) => {
      timer = setTimeout(() => resolve([]), req.timeoutMs);
      timer.unref?.();
    });

    let result: VisionHit[];
    try {
      result = await Promise.race([this.callAndMap(call, params, req.hint), timeout]);
    } catch {
      result = [];
    } finally {
      if (timer) clearTimeout(timer);
    }
    return result;
  }

  async ready(): Promise<boolean> {
    if (this.readyCache !== undefined) return this.readyCache;
    if (!this.options.parseScreen) {
      this.readyCache = false;
      return false;
    }
    if (this.options.status) {
      try {
        const s = await this.options.status();
        this.readyCache = !!s?.ready;
      } catch {
        this.readyCache = false;
      }
    } else {
      // No status probe wired — having parseScreen is enough to assume
      // readiness; the cost of being wrong is one wasted vision call
      // that returns [], not a crash.
      this.readyCache = true;
    }
    return this.readyCache;
  }

  /** Reset the ready() cache. Useful when the gateway swaps transports. */
  resetReadyCache(): void {
    this.readyCache = undefined;
  }

  private async callAndMap(
    call: ParseScreenCallback,
    params: Parameters<ParseScreenCallback>[0],
    hint: string | undefined,
  ): Promise<VisionHit[]> {
    const out = await call(params);
    const all: VisionHit[] = out.elements.map((el) => ({
      bbox: el.bbox,
      label: el.label,
      type: el.type,
      confidence: el.confidence ?? 0.5,
    }));
    if (!hint) return all;

    // When a hint is provided, rank label/type matches first. The
    // underlying parser may already rank by visual prominence; we add
    // a second pass keyed on the caller's hint so "Export button" pulls
    // the Export element above unrelated buttons.
    const lc = hint.toLowerCase();
    const tokens = lc.split(/\s+/).filter((t) => t.length >= 3);
    const scored = all.map((h) => {
      const target = `${h.label} ${h.type}`.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (target.includes(t)) score += 1;
      }
      return { h, score };
    });
    scored.sort((a, b) => b.score - a.score || b.h.confidence - a.h.confidence);
    return scored.map((s) => s.h);
  }
}

/**
 * Build one OmniParserVisionService sharing the gateway's parse_screen
 * callback. Returned alongside the same callback so the caller can hand
 * that callback to OmniParserEngine too — one MCP transport, two
 * consumers, no duplicate Python process.
 */
export function buildOmniParserVisionService(
  parseScreen: ParseScreenCallback,
  options: Omit<OmniParserVisionServiceOptions, "parseScreen"> = {},
): OmniParserVisionService {
  return new OmniParserVisionService({ parseScreen, ...options });
}
