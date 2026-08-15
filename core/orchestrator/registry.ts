export interface Agent {
  name: string;
  capabilities: string[];
  execute(
    action: string,
    params: Record<string, unknown>,
    requestId: string,
    stepId: string,
  ): Promise<{ success: boolean; data?: unknown; error?: string }>;
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
}
