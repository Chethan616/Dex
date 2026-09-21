// Generalizes the single dex-registry confirmation gate into a per-category
// policy with a rememberable answer, the shape Codex's own
// AppToolApproval::{Auto,Prompt,Writes,Approve} ships. Grid-view's
// autonomous agents keep today's exact behavior unchanged — nothing gated
// but registry-write — because every session defaults to 'full' unless the
// Settings pane's global default (see main/index.ts's settings:approvals:*
// handlers) has been changed away from it.

export type ApprovalCategory =
  | 'registry-write'
  | 'filesystem-write-unsafe-path'
  | 'process-launch'
  | 'service-control';

export type ApprovalLifetime = 'once' | 'turn' | 'session';

export type SessionApprovalMode = 'ask' | 'auto' | 'full';

const APPROVAL_CATEGORIES: ReadonlySet<string> = new Set<ApprovalCategory>([
  'registry-write',
  'filesystem-write-unsafe-path',
  'process-launch',
  'service-control',
]);

/** Coerces an untrusted category string to a known category, defaulting to
 * 'registry-write' for backward compatibility with dex-registry's existing
 * /dex/confirm calls, which predate this field. */
export function normalizeApprovalCategory(value: unknown): ApprovalCategory {
  if (typeof value === 'string' && APPROVAL_CATEGORIES.has(value)) return value as ApprovalCategory;
  return 'registry-write';
}

const APPROVAL_LIFETIMES: ReadonlySet<string> = new Set<ApprovalLifetime>(['once', 'turn', 'session']);

export function normalizeApprovalLifetime(value: unknown): ApprovalLifetime {
  if (typeof value === 'string' && APPROVAL_LIFETIMES.has(value)) return value as ApprovalLifetime;
  return 'once';
}

const APPROVAL_MODES: ReadonlySet<string> = new Set<SessionApprovalMode>(['ask', 'auto', 'full']);

export function normalizeApprovalMode(value: unknown): SessionApprovalMode {
  if (typeof value === 'string' && APPROVAL_MODES.has(value)) return value as SessionApprovalMode;
  return DEFAULT_MODE;
}

interface Decision {
  approved: boolean;
  lifetime: ApprovalLifetime;
}

const DEFAULT_MODE: SessionApprovalMode = 'full';

// The Settings pane's global default — Grid view's own unchanged behavior
// out of the box, and currently the only surface for this control. A
// session-specific override (setSessionMode) still wins over it when one
// exists, though nothing sets one today.
let globalDefaultMode: SessionApprovalMode = DEFAULT_MODE;

const sessionModes = new Map<string, SessionApprovalMode>();
const sessionDecisions = new Map<string, Map<ApprovalCategory, Decision>>();

export function setGlobalDefaultMode(mode: SessionApprovalMode): void {
  globalDefaultMode = mode;
}

export function getGlobalDefaultMode(): SessionApprovalMode {
  return globalDefaultMode;
}

export function setSessionMode(sessionId: string, mode: SessionApprovalMode): void {
  sessionModes.set(sessionId, mode);
}

export function getSessionMode(sessionId: string): SessionApprovalMode {
  return sessionModes.get(sessionId) ?? globalDefaultMode;
}

/**
 * Call at the start of every new conversational turn (a fresh prompt handed
 * to the engine) — a 'turn'-lifetime approval does not survive past it,
 * distinguishing it from 'session', which survives until the session ends.
 */
export function startTurn(sessionId: string): void {
  const decisions = sessionDecisions.get(sessionId);
  if (!decisions) return;
  for (const [category, decision] of decisions) {
    if (decision.lifetime === 'turn') decisions.delete(category);
  }
}

/** Records an answer with a lifetime longer than 'once' so future checks in scope skip the prompt. */
export function recordDecision(
  sessionId: string,
  category: ApprovalCategory,
  approved: boolean,
  lifetime: ApprovalLifetime,
): void {
  if (lifetime === 'once') return; // nothing to remember — every call still asks
  let decisions = sessionDecisions.get(sessionId);
  if (!decisions) {
    decisions = new Map();
    sessionDecisions.set(sessionId, decisions);
  }
  decisions.set(category, { approved, lifetime });
}

function remembered(sessionId: string, category: ApprovalCategory): boolean | null {
  const decision = sessionDecisions.get(sessionId)?.get(category);
  return decision ? decision.approved : null;
}

// A named, honest heuristic — not exhaustive, just enough to make "Approve
// for me" behave differently from "Full access" on the cases most worth
// catching: writes under Windows/Program Files/System32, and commands that
// change system state rather than just reading it.
const SENSITIVE_PATH_PATTERNS = [
  /^[a-z]:\\windows\\/i,
  /^[a-z]:\\program files/i,
  /\\system32\\/i,
  /^[a-z]:\\programdata\\/i,
];

const SENSITIVE_COMMAND_WORDS = new Set([
  'reg', 'reg.exe',
  'sc', 'sc.exe',
  'net', 'net.exe',
  'shutdown', 'shutdown.exe',
  'taskkill', 'taskkill.exe',
  'bcdedit', 'bcdedit.exe',
  'diskpart', 'diskpart.exe',
  'net-user', 'netsh', 'netsh.exe',
]);

export function isRiskyPath(pathStr: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(pathStr));
}

export function isRiskyCommand(command: string): boolean {
  const first = command.trim().split(/\s+/)[0]?.toLowerCase().replace(/^["']|["']$/g, '') ?? '';
  return SENSITIVE_COMMAND_WORDS.has(first);
}

export interface ApprovalCheckInput {
  sessionId: string;
  category: ApprovalCategory;
  /** A path (filesystem category) or a command line (process-launch/service-control), for the 'auto' mode heuristic. */
  subject?: string;
}

/** Whether this action needs a human answer right now, or can proceed silently. */
export function needsPrompt(input: ApprovalCheckInput): boolean {
  const { sessionId, category, subject } = input;
  const answer = remembered(sessionId, category);
  if (answer === true) return false;

  // registry-write is always gated, independent of session mode — the one
  // rule Phase 5 established and this phase does not relax.
  if (category === 'registry-write') return true;

  const mode = getSessionMode(sessionId);
  if (mode === 'full') return false;
  if (mode === 'ask') return true;
  // 'auto' — prompt only when the heuristic actually flags this action.
  if (category === 'filesystem-write-unsafe-path') return subject ? isRiskyPath(subject) : false;
  return subject ? isRiskyCommand(subject) : false;
}

/** Drop all policy state for a session — call when a session is deleted/dismissed. */
export function clearSession(sessionId: string): void {
  sessionModes.delete(sessionId);
  sessionDecisions.delete(sessionId);
}
