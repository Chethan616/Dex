import { createHash } from 'crypto';
import {
  ConfirmationRequest,
  ConfirmationVerdict,
  ExecutionStep,
  HandoffRequest,
} from '../events/types';
import { emit } from '../events/bus';

/**
 * Anything that can show an approval prompt to the owner (Flutter WS client, CLI).
 * The first responder to answer wins; the rest are told the request closed.
 */
export interface ConfirmationProvider {
  name: string;
  present(request: ConfirmationRequest): void;
  withdraw(requestId: string, stepId: string): void;
}

interface Pending {
  request: ConfirmationRequest;
  resolve: (verdict: ConfirmationVerdict) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const HANDOFF_TIMEOUT_MS = 300_000;

/** Deterministic content hash — changing any field of a step changes its version. */
export function stepVersion(step: ExecutionStep): string {
  const canonical = JSON.stringify({
    id: step.id,
    capability: step.capability,
    action: step.action,
    params: step.params,
    tier: step.confirmationTier,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

function describe(step: ExecutionStep): string {
  const params = Object.entries(step.params)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ');
  return params ? `${step.action} (${params})` : step.action;
}

export class ConfirmationManager {
  private providers: ConfirmationProvider[] = [];
  private pending = new Map<string, Pending>();

  /** Tier 3 pre-approvals granted this session, keyed `capability:action`. */
  private preApproved = new Set<string>();

  /**
   * Approvals that cover the rest of ONE plan, keyed `requestId::scope`.
   *
   * A plan that changes a Windows power scheme is thirteen `powercfg` calls,
   * because that is how powercfg works — one per setting. Asking thirteen times
   * is not thirteen decisions, it is one decision and twelve obstacles, and the
   * owner answered the first card, watched eleven more queue up behind it, and
   * cancelled. The task failed on the interface, not on anything it was doing.
   *
   * So an approval can cover a scope for the remainder of the request that
   * raised it. Three properties keep that from becoming a hole:
   *
   *   - It is scoped to one `requestId`. The next task asks again, and the set
   *     is dropped when the plan ends, whatever the outcome.
   *   - The scope is the daemon's own description of the effect
   *     ("change a Windows power setting"), not the command text, so approving
   *     one power setting does not approve a file deletion in the same plan.
   *   - Only the Orchestrator passes a scope, and only for shell commands the
   *     daemon has classified. Nothing else in Dex can opt into it.
   */
  private planApproved = new Set<string>();

  constructor(
    private timeoutMs = DEFAULT_TIMEOUT_MS,
    /** Longer than an approval: solving a CAPTCHA or signing in takes a while. */
    private handoffTimeoutMs = HANDOFF_TIMEOUT_MS,
  ) {}

  private static scopeKey(step: ExecutionStep): string {
    return `${step.capability}:${step.action}`;
  }

  preApprovals(): string[] {
    return [...this.preApproved];
  }

  clearPreApprovals(): number {
    const n = this.preApproved.size;
    this.preApproved.clear();
    return n;
  }

  registerProvider(provider: ConfirmationProvider): () => void {
    this.providers.push(provider);
    return () => {
      this.providers = this.providers.filter((p) => p !== provider);
    };
  }

  /** Snapshot of everything currently waiting — sent to a client on connect. */
  snapshot(): ConfirmationRequest[] {
    return [...this.pending.values()].map((p) => p.request);
  }

  private key(requestId: string, stepId: string): string {
    return `${requestId}::${stepId}`;
  }

  /**
   * Block until the owner answers. With no provider attached (headless dev),
   * auto-approves rather than hanging forever.
   */
  async request(
    step: ExecutionStep,
    requestId: string,
    /**
     * What this approval covers for the rest of this plan. See `planApproved`.
     * Omitted everywhere except the Orchestrator's classified shell commands.
     */
    planScope?: string,
  ): Promise<ConfirmationVerdict> {
    const scope = ConfirmationManager.scopeKey(step);

    if (step.confirmationTier === 3 && this.preApproved.has(scope)) {
      emit('executing', `[Tier 3] Pre-approved this session — ${scope}`, requestId, step.id);
      return 'approved';
    }

    const planKey = planScope ? `${requestId}::${planScope}` : '';
    if (planKey && this.planApproved.has(planKey)) {
      // Said out loud, every time. A step that runs without a card still has to
      // appear in the transcript with the reason it did.
      emit(
        'executing',
        `Already approved for this task — ${planScope}`,
        requestId,
        step.id,
      );
      return 'approved';
    }

    if (this.providers.length === 0) {
      emit(
        'awaiting',
        `[Tier ${step.confirmationTier}] No approval UI attached — auto-approved (headless)`,
        requestId,
        step.id,
      );
      return 'approved';
    }

    const now = Date.now();
    const request: ConfirmationRequest = {
      requestId,
      stepId: step.id,
      stepVersion: stepVersion(step),
      capability: step.capability,
      action: step.action,
      params: step.params,
      tier: step.confirmationTier,
      description: describe(step),
      createdAt: now,
      expiresAt: now + this.timeoutMs,
    };

    const key = this.key(requestId, step.id);

    emit(
      'awaiting',
      `[Tier ${step.confirmationTier}] Waiting for approval — ${request.description}`,
      requestId,
      step.id,
      request,
    );

    const verdict = await new Promise<ConfirmationVerdict>((resolve) => {
      const timer = setTimeout(() => this.settle(key, 'expired'), this.timeoutMs);
      this.pending.set(key, { request, resolve, timer });
      for (const provider of this.providers) {
        try {
          provider.present(request);
        } catch (err) {
          emit('failed', `Confirmation provider "${provider.name}" threw: ${err}`, requestId, step.id);
        }
      }
    });

    if (planKey && verdict === 'approved') this.planApproved.add(planKey);
    return verdict;
  }

  /**
   * Pause mid-step and ask the owner to do something DEX cannot — solve a
   * CAPTCHA, clear an SSL warning, sign in. Resolves true once they say it is
   * done.
   *
   * Deliberately NOT bypassed by Full Access. Full Access removes the need to
   * *ask permission*; it does not give DEX hands that can read a CAPTCHA. If
   * nobody is watching, this expires and the step fails — which is correct, and
   * far better than a browser agent looping on an unsolvable page.
   */
  async requestHandoff(
    requestId: string,
    stepId: string,
    capability: string,
    action: string,
    handoff: HandoffRequest,
  ): Promise<boolean> {
    if (this.providers.length === 0) {
      emit(
        'failed',
        `Hand-off needed but no owner is attached — ${handoff.reason}`,
        requestId,
        stepId,
      );
      return false;
    }

    const timeoutMs = handoff.timeoutMs ?? this.handoffTimeoutMs;
    const now = Date.now();
    const request: ConfirmationRequest = {
      requestId,
      stepId,
      stepVersion: createHash('sha256')
        .update(`handoff|${stepId}|${handoff.reason}|${handoff.instruction}`)
        .digest('hex')
        .slice(0, 12),
      capability,
      action,
      params: { reason: handoff.reason },
      tier: 1,
      description: handoff.instruction,
      createdAt: now,
      expiresAt: now + timeoutMs,
    };

    const key = this.key(requestId, stepId);
    // A step can hit two walls in a row (login, then CAPTCHA). Close the older
    // card before opening the next so the owner never sees two live cards for
    // one step, and so `respond` is never ambiguous about which one it answers.
    if (this.pending.has(key)) this.settle(key, 'cancelled');

    emit('awaiting', `[Tier 1] Hand-off — ${handoff.reason}`, requestId, stepId, request);

    const verdict = await new Promise<ConfirmationVerdict>((resolve) => {
      const timer = setTimeout(() => this.settle(key, 'expired'), timeoutMs);
      this.pending.set(key, { request, resolve, timer });
      for (const provider of this.providers) {
        try {
          provider.present(request);
        } catch (err) {
          emit('failed', `Confirmation provider "${provider.name}" threw: ${err}`, requestId, stepId);
        }
      }
    });

    // settle() maps `handed_off` to `approved` before resolving.
    return verdict === 'approved';
  }

  /**
   * Answer a pending confirmation. Rejects the answer if `stepVersion` does not
   * match the live request — a stale card cannot approve a rewritten step.
   */
  respond(
    requestId: string,
    stepId: string,
    stepVersion_: string,
    verdict: ConfirmationVerdict,
  ): { accepted: boolean; reason?: string } {
    const key = this.key(requestId, stepId);
    const entry = this.pending.get(key);

    if (!entry) {
      return { accepted: false, reason: 'No pending confirmation for that step' };
    }
    if (entry.request.stepVersion !== stepVersion_) {
      emit(
        'failed',
        `Stale approval rejected (card version ${stepVersion_}, live ${entry.request.stepVersion})`,
        requestId,
        stepId,
      );
      return { accepted: false, reason: 'Stale approval — step has changed since this card was shown' };
    }

    this.settle(key, verdict);
    return { accepted: true };
  }

  /**
   * Close every pending confirmation for a request, and forget anything it
   * approved for the rest of its plan.
   *
   * Called when a task is cancelled and again when it ends, so a plan-scoped
   * approval cannot outlive the plan that earned it.
   */
  cancelAll(requestId: string): void {
    for (const [key, entry] of this.pending) {
      if (entry.request.requestId === requestId) this.settle(key, 'cancelled');
    }
    for (const key of this.planApproved) {
      if (key.startsWith(`${requestId}::`)) this.planApproved.delete(key);
    }
  }

  private settle(key: string, verdict: ConfirmationVerdict): void {
    const entry = this.pending.get(key);
    if (!entry) return;

    clearTimeout(entry.timer);
    this.pending.delete(key);

    const { requestId, stepId, capability, action, tier, description } = entry.request;
    const scope = `${capability}:${action}`;

    // Tier 2 never gets a session pre-approval, whatever the client sends.
    let effective = verdict;
    if (verdict === 'approved_session') {
      if (tier === 3) {
        this.preApproved.add(scope);
        emit('executing', `Pre-approved for this session — ${scope}`, requestId, stepId);
      } else {
        emit(
          'executing',
          `Tier ${tier} cannot be pre-approved — approving this once only`,
          requestId,
          stepId,
        );
      }
      effective = 'approved';
    }
    if (verdict === 'handed_off') {
      emit('executing', `Owner handled this step — continuing`, requestId, stepId);
      effective = 'approved';
    }

    for (const provider of this.providers) {
      try {
        provider.withdraw(requestId, stepId);
      } catch {
        /* a provider that can't withdraw must not block the verdict */
      }
    }

    emit(
      effective === 'approved' ? 'executing' : 'cancelled',
      `Confirmation ${verdict} — ${description}`,
      requestId,
      stepId,
    );

    entry.resolve(effective);
  }
}
