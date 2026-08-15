export type EventType =
  | 'thinking'
  | 'routing'
  | 'planning'
  | 'selecting'
  | 'executing'
  | 'retrying'
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
