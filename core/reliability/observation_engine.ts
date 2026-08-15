import { ExecutionStep, VerificationResult } from '../events/types';
import { EvidenceStore } from './evidence_store';
import { verifyStep } from './verification_policy';

export class ReliabilityLayer {
  constructor(private evidenceStore: EvidenceStore) {}

  async observe(step: ExecutionStep, _requestId: string): Promise<unknown> {
    // Snapshot of state before the action runs.
    // For OS actions, the real before-state is captured inside verifyStep via subprocess.
    // Here we just record metadata for the evidence trail.
    return { capability: step.capability, action: step.action, capturedAt: Date.now() };
  }

  async verify(
    step: ExecutionStep,
    beforeState: unknown,
    requestId: string,
  ): Promise<VerificationResult> {
    const result = await verifyStep(step, beforeState);

    await this.evidenceStore.record({
      requestId,
      stepId: step.id,
      action: step.action,
      params: step.params,
      beforeState,
      verificationResult: result,
      timestamp: Date.now(),
    });

    return result;
  }
}
