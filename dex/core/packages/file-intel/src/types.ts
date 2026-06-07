/**
 * @dexagent/file-intel — type contract.
 *
 * Phase G.2 scaffold. These types define what the facade in `./index.ts`
 * promises to its callers (the gateway, the Flutter Live panel, the mobile
 * mesh client). Implementations land in G.3+ behind the G.1 verification
 * gate documented in `docs/g-research/file-intelligence-comparison.md` §11.
 *
 * Design choices baked into these types:
 *
 *   - Every read path returns a `Result<T, FileIntelError>` (no thrown
 *     exceptions at the facade boundary) so the Flutter UI renders clean
 *     error states.
 *   - Classifications are a closed union (`FileClassification`) -- adding
 *     a new class requires updating both classifier AND consumers, never
 *     a magic string.
 *   - File metadata is the LATEST snapshot. Historical states live in
 *     the SQLite metadata store and aren't exposed through this facade.
 *   - DeliveryProvider is the only intentionally open extension surface:
 *     plugins can register new providers (Telegram, Slack, Drive, etc.)
 *     by implementing the interface.
 */

/** Stable file classification (locked union — never magic-string). */
export type FileClassification =
  | "aadhaar"
  | "pan"
  | "passport"
  | "driving-license"
  | "resume"
  | "invoice"
  | "bank-statement"
  | "screenshot"
  | "other";

/** Supported file types for ingestion. Anything else is logged + ignored. */
export type FileExtension =
  | "pdf"
  | "docx"
  | "txt"
  | "md"
  | "png"
  | "jpg"
  | "jpeg"
  | "webp";

/** Per-file metadata snapshot (latest state; history lives in SQLite). */
export interface FileMetadata {
  /** Absolute filesystem path on the source device. */
  path: string;
  /** Basename including extension. */
  filename: string;
  extension: FileExtension;
  sizeBytes: number;
  /** xxhash64 of file head + tail, used for incremental change detection. */
  contentHash: string;
  createdAtMs: number;
  modifiedAtMs: number;
  classification: FileClassification;
  /** True if the extracted text came from OCR (image or scanned PDF). */
  ocrUsed: boolean;
  /** Excerpt of extracted text; capped at 1024 chars for transport. */
  textExcerpt: string;
  /** Wall-clock ms the indexer last touched this row. */
  lastIndexedMs: number;
  /** Stable id used by the vector store. */
  qdrantPointId: string;
}

/** One hit in a search result list. */
export interface SearchHit {
  file: FileMetadata;
  /** Composite score: 0..1, higher = better match. */
  similarity: number;
  /** Which device this file lives on. Empty string when local-only. */
  deviceId: string;
  deviceName: string;
  /** Snippet of extracted text containing the matched terms. */
  previewText: string;
}

/** Scope a search to one device, multiple devices, or "all paired". */
export type SearchScope =
  | { kind: "local" }
  | { kind: "specific-devices"; deviceIds: readonly string[] }
  | { kind: "all-paired" };

/** What the user typed plus filters parsed from the query. */
export interface SearchRequest {
  /** Natural-language query, e.g. "find my Aadhaar card". */
  text: string;
  scope: SearchScope;
  /** Optional cap on results returned per device. Default 20. */
  perDeviceLimit?: number;
  /** Optional classification filter parsed from the query. */
  classification?: FileClassification;
  /** Optional date window parsed from "last month" / "this week" / etc. */
  dateWindow?: { fromMs: number; toMs: number };
}

export interface SearchResponse {
  hits: SearchHit[];
  /** Per-device latency breakdown so the UI can show "Personal Laptop:
   *  120ms" badges on cross-device fanout. */
  perDeviceLatencyMs: Record<string, number>;
}

/** Delivery channel the user picks AFTER the file is located. */
export interface DeliveryContext {
  /** Where the user is asking from (phone / desktop / web). */
  requesterDeviceId: string;
  /** When the user opted in to ephemeral / share-link delivery, this
   *  controls expiry. Defaults vary per provider. */
  expirySeconds?: number;
}

export interface DeliveryResult {
  ok: boolean;
  /** Provider-specific receipt (URL, message id, whatever the channel
   *  surfaces). Empty when ok=false. */
  receipt: string;
  /** Human-readable message rendered in the Activity card. */
  summary: string;
}

/**
 * Pluggable delivery target. Each provider self-reports availability so
 * the "How would you like to receive it?" menu can hide channels the
 * user hasn't configured.
 */
export interface DeliveryProvider {
  /** Stable id used in UI + config. */
  id: string;
  /** Display name shown in the menu. */
  displayName: string;
  /** True if the user has configured this channel. */
  isConfigured(): boolean;
  /** Cheap availability probe before menu render. */
  isReachable(): Promise<boolean>;
  /** Deliver the file. May stream, may invoke other channels. */
  deliver(file: FileMetadata, ctx: DeliveryContext): Promise<DeliveryResult>;
}

/** Closed union of all error kinds the facade may surface. */
export type FileIntelErrorKind =
  | "not-yet-implemented"
  | "not-configured"
  | "device-unreachable"
  | "no-results"
  | "permission-denied"
  | "transport-error"
  | "internal";

export interface FileIntelError {
  kind: FileIntelErrorKind;
  message: string;
  /** Optional cause chain for the Flutter Activity card. */
  details?: Record<string, unknown>;
}

/** Result discriminated union; the facade returns `Promise<Result<T>>`. */
export type Result<T, E = FileIntelError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Helper to construct an unimplemented error consistently. */
export function notYetImplemented(surface: string): FileIntelError {
  return {
    kind: "not-yet-implemented",
    message:
      `@dexagent/file-intel.${surface} is scaffold-only. ` +
      "Implementation gated on G.1 verification spot-checks; see " +
      "docs/g-research/file-intelligence-comparison.md §11.",
  };
}
