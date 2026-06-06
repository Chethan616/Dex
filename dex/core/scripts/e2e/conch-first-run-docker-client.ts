// Conch first-run Docker harness.
// Imports packaged dist modules so the Docker lane verifies the npm tarball,
// while this small test driver stays mounted from the checkout.
import fs from "node:fs/promises";
import path from "node:path";
import {
  runCli,
  shouldStartConchForModernOnboard,
  shouldStartOnboardingForFreshInstall,
} from "../../dist/cli/run-main.js";
import { clearConfigCache } from "../../dist/config/config.js";
import type { DexConfig } from "../../dist/config/types.openclaw.js";
import { runConch } from "../../dist/conch/conch.js";
import type { RuntimeEnv } from "../../dist/runtime.js";
import { createE2eStateDir } from "./lib/temp-state-dir.ts";

type ConchFirstRunCommand = {
  id: string;
  message: string;
  expectOutput: string;
  approve: boolean;
};

type ConchFirstRunSpec = {
  dockerDefaultWorkspace: string;
  dockerAgentWorkspace: string;
  agentId: string;
  model: string;
  discordEnv: string;
  discordToken: string;
  commands: ConchFirstRunCommand[];
  auditOperations: string[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function createRuntime(): { runtime: RuntimeEnv; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    runtime: {
      log: (...args) => lines.push(args.join(" ")),
      error: (...args) => lines.push(args.join(" ")),
      exit: (code) => {
        throw new Error(`exit ${code}`);
      },
    },
  };
}

async function readFirstRunSpec(): Promise<ConchFirstRunSpec> {
  return JSON.parse(
    await fs.readFile(
      path.join(process.cwd(), "scripts", "e2e", "conch-first-run-spec.json"),
      "utf8",
    ),
  ) as ConchFirstRunSpec;
}

function renderCommandTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key: string) => vars[key] ?? match);
}

async function main() {
  const spec = await readFirstRunSpec();
  const tempState = await createE2eStateDir("openclaw-conch-first-run-");
  tempState.registerExitCleanup();
  const stateDir = tempState.stateDir;
  const configPath = process.env.DEX_CONFIG_PATH ?? path.join(stateDir, "openclaw.json");
  process.env.DEX_STATE_DIR = stateDir;
  process.env.DEX_CONFIG_PATH = configPath;
  await fs.rm(stateDir, { recursive: true, force: true });
  await fs.mkdir(stateDir, { recursive: true });
  clearConfigCache();

  assert(
    await shouldStartOnboardingForFreshInstall(["node", "openclaw"]),
    "fresh bare OpenClaw invocation did not route to onboarding",
  );
  assert(
    shouldStartConchForModernOnboard(["node", "openclaw", "onboard", "--modern"]),
    "modern onboard invocation did not route to Conch",
  );
  process.exitCode = undefined;
  await runCli(["node", "openclaw", "onboard", "--modern", "--non-interactive", "--json"]);
  assert(
    process.exitCode === undefined || process.exitCode === 0,
    "modern onboard overview exited nonzero",
  );

  const overviewRuntime = createRuntime();
  await runConch({ message: "overview", interactive: false }, overviewRuntime.runtime);
  const overviewOutput = overviewRuntime.lines.join("\n");
  assert(
    overviewOutput.includes("Config: missing"),
    "fresh overview did not report missing config",
  );
  assert(
    overviewOutput.includes('Next: run "setup" to create a starter config'),
    "fresh overview did not include setup recommendation",
  );

  process.env[spec.discordEnv] = spec.discordToken;

  const commandVars = {
    defaultWorkspace: spec.dockerDefaultWorkspace,
    agentWorkspace: spec.dockerAgentWorkspace,
    agentId: spec.agentId,
    model: spec.model,
    discordEnv: spec.discordEnv,
  };
  for (const command of spec.commands) {
    clearConfigCache();
    const commandRuntime = createRuntime();
    await runConch(
      {
        message: renderCommandTemplate(command.message, commandVars),
        yes: command.approve,
        interactive: false,
      },
      commandRuntime.runtime,
    );
    const output = commandRuntime.lines.join("\n");
    assert(
      output.includes(command.expectOutput),
      `Conch first-run command ${command.id} did not apply: ${output}`,
    );
  }

  const config = JSON.parse(await fs.readFile(configPath, "utf8")) as DexConfig;
  assert(
    config.agents?.defaults?.workspace === spec.dockerDefaultWorkspace,
    "first-run setup did not write default workspace",
  );
  assert(
    config.agents?.defaults?.model &&
      typeof config.agents.defaults.model === "object" &&
      "primary" in config.agents.defaults.model &&
      config.agents.defaults.model.primary === spec.model,
    "first-run setup did not write default model",
  );
  const reef = config.agents?.list?.find((agent) => agent.id === spec.agentId);
  assert(reef, "Conch did not create reef agent");
  assert(reef.workspace === spec.dockerAgentWorkspace, "Conch did not write reef workspace");
  assert(reef.model === spec.model, "Conch did not write reef model");
  assert(config.plugins?.allow?.includes("discord"), "Conch did not allow Discord plugin");
  assert(
    config.plugins?.entries?.discord?.enabled === true,
    "Conch did not enable Discord plugin entry",
  );
  assert(config.channels?.discord?.enabled === true, "Conch did not enable Discord");
  const discordToken = config.channels?.discord?.token;
  assert(
    discordToken &&
      typeof discordToken === "object" &&
      "source" in discordToken &&
      discordToken.source === "env" &&
      "id" in discordToken &&
      discordToken.id === spec.discordEnv,
    "Conch did not write Discord token SecretRef",
  );
  assert(
    !JSON.stringify(config.channels.discord).includes(spec.discordToken),
    "Conch persisted the raw Discord token",
  );

  const auditPath = path.join(stateDir, "audit", "conch.jsonl");
  const audit = (await fs.readFile(auditPath, "utf8")).trim();
  for (const operation of spec.auditOperations) {
    assert(audit.includes(`"operation":"${operation}"`), `${operation} audit entry missing`);
  }

  console.log("Conch first-run Docker E2E passed");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
