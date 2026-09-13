/**
 * @dexagent/screen-context — public façade.
 *
 * Phase H.2 scaffold. Every capture / mesh / permission method short-
 * circuits to a `not-yet-implemented` error pointing at the H.1 §12
 * verification gate. The non-disruption checker is fully real and
 * exported so the policy test in this package (and any future caller)
 * can run it.
 */

import {
  notYetImplemented,
  type AppDenyList,
  type CaptureRequest,
  type ContextPayload,
  type Result,
} from "./types.js";

export * from "./types.js";
export {
  BANNED_APIS,
  scanSourceForBannedApis,
  scanFilesForBannedApis,
  formatHitsForTestFailure,
} from "./non-disruption.js";
export type {
  BannedApi,
  BannedApiHit,
  ScanOptions,
} from "./non-disruption.js";

export interface ScreenContext {
  /** Capture the user's currently-foreground window and return the
   *  structured payload. Observer mode: no focus / Z-order changes. */
  capture(req: CaptureRequest): Promise<Result<ContextPayload>>;

  /** Retrieve the cached payload for a follow-up turn (e.g. "rewrite it
   *  in C++" referring back to the same code the user asked about). */
  getCachedContext(sessionId: string): Promise<Result<ContextPayload>>;

  /** User revokes a paired device's right to inspect their screen.
   *  After this call, the device gets `permission-denied` until it
   *  re-pairs. */
  revokePairConsent(deviceId: string): Promise<Result<void>>;

  /** Update the per-app deny list. Apps in this list always refuse
   *  capture, even when the session has otherwise granted consent. */
  setAppDenyList(list: AppDenyList): Promise<Result<void>>;
}

/**
 * Build the screen-context facade. Today every method short-circuits
 * to a "not yet implemented" error so accidental usage in production
 * fails loudly + points at H.1 §12. H.3+ replaces the bodies with the
 * real per-platform capture + extract chain.
 */
export function createScreenContext(): ScreenContext {
  return {
    async capture(_req) {
      return { ok: false, error: notYetImplemented("capture") };
    },
    async getCachedContext(_sessionId) {
      return { ok: false, error: notYetImplemented("getCachedContext") };
    },
    async revokePairConsent(_deviceId) {
      return { ok: false, error: notYetImplemented("revokePairConsent") };
    },
    async setAppDenyList(_list) {
      return { ok: false, error: notYetImplemented("setAppDenyList") };
    },
  };
}
