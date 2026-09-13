import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  asDateTimestampMs,
  resolveExpiresAtMsFromDurationMs,
} from "@dexagent/normalization-core/number-coercion";
import type { CommandContext } from "../auto-reply/reply/commands-types.js";
import { resolveStateDir } from "../config/paths.js";
import type { DexConfig } from "../config/types.openclaw.js";
import { tryReadJson, writeJson } from "../infra/json-files.js";
import type { RuntimeEnv } from "../runtime.js";
import {
  executeAtlasOperation,
  formatAtlasPersistentPlan,
  isPersistentAtlasOperation,
  parseAtlasOperation,
  type AtlasCommandDeps,
  type AtlasOperation,
} from "./operations.js";
import { resolveAtlasRescuePolicy } from "./rescue-policy.js";

type RescuePendingOperation = {
  id: string;
  createdAt: string;
  expiresAt: string;
  operation: AtlasOperation;
  auditDetails: Record<string, unknown>;
};

export type AtlasRescueMessageInput = {
  cfg: DexConfig;
  command: CommandContext;
  commandBody: string;
  agentId?: string;
  isGroup: boolean;
  env?: NodeJS.ProcessEnv;
  deps?: AtlasCommandDeps;
};

const ATLAS_COMMAND = "/atlas";
const APPROVAL_RE = /^(yes|y|apply|approve|approved|do it)$/i;

function createCaptureRuntime(): { runtime: RuntimeEnv; read: () => string } {
  const lines: string[] = [];
  const push = (...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  };
  return {
    runtime: {
      log: push,
      error: push,
      exit: (code) => {
        throw new Error(`Atlas operation exited with code ${code}`);
      },
    },
    read: () => lines.join("\n").trim(),
  };
}

export function extractAtlasRescueMessage(commandBody: string): string | null {
  const normalized = commandBody.trim();
  const lower = normalized.toLowerCase();
  if (lower !== ATLAS_COMMAND && !lower.startsWith(`${ATLAS_COMMAND} `)) {
    return null;
  }
  return normalized.slice(ATLAS_COMMAND.length).trim();
}

function resolvePendingDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "atlas", "rescue-pending");
}

function resolvePendingPath(input: AtlasRescueMessageInput): string {
  const key = JSON.stringify({
    channel: input.command.channelId ?? input.command.channel,
    from: input.command.from,
    senderId: input.command.senderId,
  });
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return path.join(resolvePendingDir(input.env), `${digest}.json`);
}

async function readPending(
  pendingPath: string,
  now = new Date(),
): Promise<RescuePendingOperation | null> {
  try {
    const parsed = await tryReadJson<RescuePendingOperation>(pendingPath);
    if (!parsed) {
      return null;
    }
    const expiresAtMs = asDateTimestampMs(Date.parse(parsed.expiresAt));
    const nowMs = asDateTimestampMs(now.getTime());
    if (expiresAtMs === undefined || nowMs === undefined || expiresAtMs <= nowMs) {
      await fs.rm(pendingPath, { force: true });
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writePending(pendingPath: string, pending: RescuePendingOperation): Promise<void> {
  await writeJson(pendingPath, pending, {
    dirMode: 0o700,
    mode: 0o600,
    trailingNewline: true,
  });
}

function buildAuditDetails(input: AtlasRescueMessageInput): Record<string, unknown> {
  return {
    rescue: true,
    channel: input.command.channelId ?? input.command.channel,
    accountId: input.command.to,
    senderId: input.command.senderId,
    from: input.command.from,
  };
}

function formatPersistentPlan(operation: AtlasOperation): string {
  return formatAtlasPersistentPlan(operation).replace(
    "Say yes to apply.",
    "Reply /atlas yes to apply.",
  );
}

function formatUnsupportedRemoteOperation(operation: AtlasOperation): string | null {
  if (operation.kind === "open-tui") {
    return [
      "Atlas rescue cannot open the local TUI from a message channel.",
      "Use local `openclaw` for agent handoff, or ask for status, doctor, config, gateway, agents, or models.",
    ].join(" ");
  }
  if (operation.kind === "plugin-install") {
    return [
      "Atlas rescue cannot install plugins from a message channel by default because plugin install downloads executable code.",
      "Use local `dex atlas` or `dex plugins install` instead.",
    ].join(" ");
  }
  return null;
}

export async function runAtlasRescueMessage(
  input: AtlasRescueMessageInput,
): Promise<string | null> {
  const rescueMessage = extractAtlasRescueMessage(input.commandBody);
  if (rescueMessage === null) {
    return null;
  }
  const policy = resolveAtlasRescuePolicy({
    cfg: input.cfg,
    agentId: input.agentId,
    senderIsOwner: input.command.senderIsOwner,
    isDirectMessage: !input.isGroup,
  });
  if (!policy.allowed) {
    return policy.message;
  }

  const pendingPath = resolvePendingPath(input);
  if (APPROVAL_RE.test(rescueMessage)) {
    const pending = await readPending(pendingPath);
    if (!pending) {
      return "No pending Atlas rescue change is waiting for approval.";
    }
    const unsupported = formatUnsupportedRemoteOperation(pending.operation);
    if (unsupported) {
      await fs.rm(pendingPath, { force: true });
      return unsupported;
    }
    const capture = createCaptureRuntime();
    await executeAtlasOperation(pending.operation, capture.runtime, {
      approved: true,
      auditDetails: pending.auditDetails,
      deps: input.deps,
    });
    await fs.rm(pendingPath, { force: true });
    return capture.read() || "Atlas rescue change applied.";
  }

  const operation = parseAtlasOperation(rescueMessage);
  const unsupported = formatUnsupportedRemoteOperation(operation);
  if (unsupported) {
    return unsupported;
  }
  if (isPersistentAtlasOperation(operation)) {
    const now = new Date();
    const nowMs = asDateTimestampMs(now.getTime());
    const expiresAtMs =
      nowMs === undefined
        ? undefined
        : resolveExpiresAtMsFromDurationMs(policy.pendingTtlMinutes * 60_000, { nowMs });
    if (expiresAtMs === undefined) {
      return "Atlas rescue could not create a pending approval because the expiry clock is invalid.";
    }
    await writePending(pendingPath, {
      id: randomUUID(),
      createdAt: now.toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      operation,
      auditDetails: buildAuditDetails(input),
    });
    return formatPersistentPlan(operation);
  }

  const capture = createCaptureRuntime();
  await executeAtlasOperation(operation, capture.runtime, {
    approved: true,
    auditDetails: buildAuditDetails(input),
    deps: input.deps,
  });
  return capture.read() || "Atlas listened, clicked a claw, and found nothing to change.";
}
