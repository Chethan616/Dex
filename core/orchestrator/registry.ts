import { AgentContext, AgentResult } from '../events/types';

export interface Agent {
  name: string;
  capabilities: string[];
  /**
   * The port this agent's server listens on, when it has one.
   *
   * Three of the agents are HTTP proxies to a separate Python process; the
   * rest run inside the core. Only the first kind can be registered and not
   * running, and only that kind is worth probing before an escalation. An
   * agent that lives in this process is up whenever the core is, so asking
   * the network about it would be a probe that can only ever be wrong.
   */
  endpoint?: number;
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
