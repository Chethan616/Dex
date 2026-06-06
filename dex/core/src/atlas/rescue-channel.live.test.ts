import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../auto-reply/reply/commands-types.js";
import { clearConfigCache } from "../config/config.js";
import type { DexConfig } from "../config/types.openclaw.js";
import { runAtlasRescueMessage } from "./rescue-message.js";

const originalStateDir = process.env.DEX_STATE_DIR;
const originalConfigPath = process.env.DEX_CONFIG_PATH;

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

const runLive =
  truthy(process.env.DEX_LIVE_TEST) &&
  truthy(process.env.DEX_LIVE_ATLAS_RESCUE_CHANNEL);
const describeLive = runLive ? describe : describe.skip;

function commandContext(channel = process.env.DEX_LIVE_ATLAS_CHANNEL ?? "whatsapp") {
  return {
    surface: channel,
    channel,
    channelId: channel,
    ownerList: ["user:owner"],
    senderIsOwner: true,
    isAuthorizedSender: true,
    senderId: "user:owner",
    rawBodyNormalized: "/atlas status",
    commandBodyNormalized: "/atlas status",
    from: "user:owner",
    to: "account:default",
  } satisfies CommandContext;
}

async function runRescue(params: {
  commandBody: string;
  cfg: DexConfig;
  ctx?: CommandContext;
}) {
  const ctx = params.ctx ?? commandContext();
  return await runAtlasRescueMessage({
    cfg: params.cfg,
    command: { ...ctx, commandBodyNormalized: params.commandBody },
    commandBody: params.commandBody,
    isGroup: false,
  });
}

describeLive("Atlas live rescue channel smoke", () => {
  afterEach(() => {
    clearConfigCache();
    if (originalStateDir === undefined) {
      delete process.env.DEX_STATE_DIR;
    } else {
      process.env.DEX_STATE_DIR = originalStateDir;
    }
    if (originalConfigPath === undefined) {
      delete process.env.DEX_CONFIG_PATH;
    } else {
      process.env.DEX_CONFIG_PATH = originalConfigPath;
    }
  });

  it("handles /atlas status and a persistent approval roundtrip", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-live-rescue-"));
    const configPath = path.join(tempDir, "openclaw.json");
    vi.stubEnv("DEX_STATE_DIR", tempDir);
    vi.stubEnv("DEX_CONFIG_PATH", configPath);
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          meta: { lastTouchedVersion: "live-test", lastTouchedAt: new Date(0).toISOString() },
          agents: { defaults: {} },
          tools: { exec: { security: "full", ask: "off" } },
        },
        null,
        2,
      ),
    );

    const cfg: DexConfig = {
      atlas: { rescue: { enabled: true } },
      tools: { exec: { security: "full", ask: "off" } },
    };

    await expect(runRescue({ commandBody: "/atlas status", cfg })).resolves.toContain(
      "[atlas] done: status.check",
    );
    await expect(
      runRescue({ commandBody: "/atlas set default model openai/gpt-5.5", cfg }),
    ).resolves.toContain("Reply /atlas yes to apply");
    await expect(runRescue({ commandBody: "/atlas yes", cfg })).resolves.toContain(
      "Default model: openai/gpt-5.5",
    );

    const config = JSON.parse(await fs.readFile(configPath, "utf8")) as DexConfig;
    const defaultModel = config.agents?.defaults?.model;
    if (!defaultModel || typeof defaultModel !== "object") {
      throw new Error("expected default model object");
    }
    expect(defaultModel.primary).toBe("openai/gpt-5.5");
    const auditPath = path.join(tempDir, "audit", "atlas.jsonl");
    const auditLines = (await fs.readFile(auditPath, "utf8")).trim().split("\n");
    expect(auditLines.some((line) => line.includes('"operation":"config.setDefaultModel"'))).toBe(
      true,
    );
  });
});
