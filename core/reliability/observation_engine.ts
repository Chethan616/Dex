import { AgentResult, ExecutionStep, VerificationResult } from '../events/types';
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

  /**
   * `agentResult` is the agent's own account of what it did. It is evidence to
   * be checked, never the verdict: for web and workspace steps the real proof
   * is inside it (a live DOM check, a read-back id), and this is where that
   * gets separated from the agent's optimism.
   */
  async verify(
    step: ExecutionStep,
    beforeState: unknown,
    requestId: string,
    agentResult?: AgentResult,
  ): Promise<VerificationResult> {
    const result = await verifyStep(step, beforeState, agentResult);

    await this.evidenceStore.record({
      requestId,
      stepId: step.id,
      action: step.action,
      params: step.params,
      beforeState,
      agentResult: agentResult ? { success: agentResult.success, data: agentResult.data } : undefined,
      verificationResult: result,
      timestamp: Date.now(),
    });

    return result;
  }
}
