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
  intent: string;
  tier: 1 | 2 | 3;
  steps: ExecutionStep[];
}

export interface DexRequest {
  requestId: string;
  sessionId: string;
  source: 'cli' | 'telegram' | 'discord' | 'whatsapp' | 'slack' | 'flutter';
  senderId: string;
  text: string;
  timestamp: number;
}

export interface AgentResult {
  success: boolean;
  data?: unknown;
  error?: string;
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
