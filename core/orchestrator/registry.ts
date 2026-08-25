import { AgentContext, AgentResult } from '../events/types';

export interface Agent {
  name: string;
  capabilities: string[];
  execute(
    action: string,
    params: Record<string, unknown>,
    requestId: string,
    stepId: string,
    /**
     * Optional so agents that never need to pause the owner (System, Desktop)
     * can ignore it. Long-running agents that can hit a human-only wall —
     * a CAPTCHA, a login form — take it and call `handoff`.
     */
    ctx?: AgentContext,
  ): Promise<AgentResult>;
}

export class AgentRegistry {
  private capabilityMap = new Map<string, Agent>();

  register(agent: Agent): void {
    for (const cap of agent.capabilities) {
      this.capabilityMap.set(cap, agent);
    }
  }

  resolve(capability: string): Agent | undefined {
    return this.capabilityMap.get(capability);
  }

  list(): string[] {
    return [...this.capabilityMap.keys()];
  }

  /** Distinct agents, for status reporting — an agent with 3 capabilities appears once. */
  agents(): Agent[] {
    return [...new Set(this.capabilityMap.values())];
  }
}
