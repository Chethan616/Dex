import { randomUUID } from 'crypto';
import { DexRequest, ExecutionPlan, TaskStatus } from './events/types';
import { OwnerGate } from './owner_gate';
import { Brain } from './brain/planner';
import { Orchestrator } from './orchestrator/orchestrator';
import { emit } from './events/bus';

export class Gateway {
  private sessionMap = new Map<string, string>();

  constructor(
    private ownerGate: OwnerGate,
    private brain: Brain,
    private orchestrator: Orchestrator,
  ) {}

  async handle(
    source: DexRequest['source'],
    senderId: string,
    text: string,
  ): Promise<{ status: TaskStatus; summary: string; requestId: string }> {
    const requestId = randomUUID();
    const sessionId = this.sessionMap.get(senderId) ?? randomUUID();
    this.sessionMap.set(senderId, sessionId);

    const request: DexRequest = {
      requestId,
      sessionId,
      source,
      senderId,
      text: text.trim(),
      timestamp: Date.now(),
    };

    if (!this.ownerGate.verify(request)) {
      // Silent ignore — no response to non-owners
      return { status: 'ABORTED', summary: 'Unauthorized sender', requestId };
    }

    emit('thinking', `"${request.text}"`, requestId);

    let plan: ExecutionPlan;
    try {
      plan = await this.brain.plan(request);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit('failed', `Planning error: ${msg}`, requestId);
      return { status: 'FAILED', summary: msg, requestId };
    }

    const result = await this.orchestrator.execute(plan);
    return { ...result, requestId };
  }
}
