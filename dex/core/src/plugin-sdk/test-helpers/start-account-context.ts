import { vi } from "vitest";
import { createRuntimeEnv } from "../testing.js";
import type {
  ChannelAccountSnapshot,
  ChannelGatewayContext,
  DexConfig,
  RuntimeEnv,
} from "../testing.js";

export function createStartAccountContext<TAccount extends { accountId: string }>(params: {
  account: TAccount;
  abortSignal?: AbortSignal;
  cfg?: DexConfig;
  runtime?: RuntimeEnv;
  statusPatchSink?: (next: ChannelAccountSnapshot) => void;
}): ChannelGatewayContext<TAccount> {
  const snapshot: ChannelAccountSnapshot = {
    accountId: params.account.accountId,
    configured: true,
    enabled: true,
    running: false,
  };
  return {
    accountId: params.account.accountId,
    account: params.account,
    cfg: params.cfg ?? ({} as DexConfig),
    runtime: params.runtime ?? createRuntimeEnv(),
    abortSignal: params.abortSignal ?? new AbortController().signal,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getStatus: () => snapshot,
    setStatus: (next) => {
      Object.assign(snapshot, next);
      params.statusPatchSink?.(snapshot);
    },
  };
}
