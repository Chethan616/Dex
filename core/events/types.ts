export type EventType =
  | 'thinking'
  | 'routing'
  | 'planning'
  | 'selecting'
  | 'executing'
  | 'retrying'
  | 'awaiting'
  | 'cancelled'
  | 'done'
  | 'failed';

export interface DexEvent {
  type: EventType;
  message: string;
  requestId: string;
  stepId?: string;
  timestamp: number;
  data?: unknown;
}

export interface ExecutionStep {
  id: string;
  capability: string;
  action: string;
  params: Record<string, unknown>;
  confirmationTier: 1 | 2 | 3 | 4;
  dependsOn: string[];
}

export interface ExecutionPlan {
  requestId: string;
  /**
   * Nobody is watching this run.
   *
   * Set for schedules, which fire whether or not the owner is at the machine.
   * The Orchestrator refuses any step that would need a confirmation card
   * rather than waiting for an answer that is not coming — and, more to the
   * point, rather than taking the ConfirmationManager's headless auto-approve,
   * which is a convenience for an interactive CLI and a hole at 3am.
   */
  unattended?: boolean;
  /** Which conversation this belongs to, so artifacts can be attributed. */
  sessionId?: string;
  intent: string;
  tier: 1 | 2 | 3;
  steps: ExecutionStep[];
}

export interface DexRequest {
  requestId: string;
  sessionId: string;
  source: 'cli' | 'telegram' | 'discord' | 'whatsapp' | 'slack' | 'flutter' | 'schedule';
  senderId: string;
  text: string;
  timestamp: number;
  /**
   * Direct message or group. The Owner Gate treats these differently: in a
   * group even the owner must address Dex explicitly, or every sentence they
   * type to another person becomes a command.
   */
  chatType?: 'direct' | 'group';
  /** Where to reply. Distinct from senderId — a group has many senders. */
  chatId?: string;
}

export interface AgentResult {
  success: boolean;
  data?: unknown;
  error?: string;
  /**
   * False when re-running the step cannot help — a declined hand-off, a hard
   * login wall, a page that will ask for the same CAPTCHA again. The
   * Orchestrator honours this instead of burning its retry budget.
   */
  retryable?: boolean;
  /**
   * A capability that *can* do what this agent could not — set by an agent that
   * has hit the edge of its own mechanism rather than a real failure. The
   * canonical case is the UI Automation tier meeting a window that draws its
   * own controls: it cannot see them, but the vision tier can. The Orchestrator
   * re-dispatches the same step to whichever agent owns this capability.
   *
   * Escalation only ever moves *outward* to a more capable, more expensive
   * tier, and only once per step — otherwise two agents could hand a step back
   * and forth forever.
   */
  escalate?: string;
}

/**
 * A pause mid-step for something DEX genuinely cannot do: solve a CAPTCHA,
 * clear an SSL interstitial, type a password. Distinct from a confirmation —
 * nobody is approving anything, the owner is doing the work and DEX resumes.
 */
export interface HandoffRequest {
  /** What blocked DEX, e.g. "CAPTCHA on the checkout page". */
  reason: string;
  /** What the owner has to do, in the imperative. */
  instruction: string;
  timeoutMs?: number;
}

/**
 * Handed to an agent for the duration of one step. Lets a long-running agent
 * reach back into the confirmation and cancellation machinery instead of
 * spinning or failing outright.
 */
export interface AgentContext {
  /** Resolves true once the owner says they did it, false if declined/expired. */
  handoff(request: HandoffRequest): Promise<boolean>;
  /** Checked between an agent's own internal steps so cancel is responsive. */
  isCancelled(): boolean;
}

export type VerificationStatus = 'VERIFIED' | 'FAILED' | 'UNVERIFIABLE';

export interface VerificationResult {
  status: VerificationStatus;
  reason: string;
  beforeState?: unknown;
  afterState?: unknown;
}

export type TaskStatus = 'COMPLETED' | 'FAILED' | 'ABORTED' | 'CANCELLED';

/**
 * A pending Tier 1/2/3 approval. `stepVersion` is a content hash of the step —
 * an approval card built for an older version of a step cannot approve a newer one.
 */
export interface ConfirmationRequest {
  requestId: string;
  stepId: string;
  stepVersion: string;
  capability: string;
  action: string;
  params: Record<string, unknown>;
  tier: 1 | 2 | 3 | 4;
  /** Plain-language description of exactly what will happen if approved. */
  description: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * `approved_session` is Tier 3 only — pre-approve this capability:action for the
 * rest of the session. Tier 2 must re-ask every time and the manager enforces
 * that server-side, not by hiding a button.
 * `handed_off` is Tier 1 only — the owner did it themselves; DEX continues.
 */
export type ConfirmationVerdict =
  | 'approved'
  | 'approved_session'
  | 'handed_off'
  | 'rejected'
  | 'cancelled'
  | 'expired';
