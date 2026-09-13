import type { DexConfig } from "../config/types.openclaw.js";

export type CancelAcpSessionAdmin = (params: {
  cfg: DexConfig;
  sessionKey: string;
  reason: string;
}) => Promise<void>;

export type KillSubagentRunAdminResult = {
  found: boolean;
  killed: boolean;
  runId?: string;
  sessionKey?: string;
  cascadeKilled?: number;
  cascadeLabels?: string[];
};

export type KillSubagentRunAdmin = (params: {
  cfg: DexConfig;
  sessionKey: string;
}) => Promise<KillSubagentRunAdminResult>;

export type TaskRegistryControlRuntime = {
  getAcpSessionManager: () => {
    cancelSession: CancelAcpSessionAdmin;
  };
  killSubagentRunAdmin: KillSubagentRunAdmin;
};
