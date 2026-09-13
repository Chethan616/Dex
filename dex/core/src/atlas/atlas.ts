import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { withProgress } from "../cli/progress.js";
import { defaultRuntime, writeRuntimeJson, type RuntimeEnv } from "../runtime.js";
import type { AtlasAssistantPlanner } from "./assistant.js";
import { resolveAtlasOperation } from "./dialogue.js";
import {
  executeAtlasOperation,
  isPersistentAtlasOperation,
  type AtlasCommandDeps,
} from "./operations.js";
import {
  formatAtlasOverview,
  loadAtlasOverview,
  type AtlasOverview,
} from "./overview.js";

type AtlasInteractiveRunner = (
  opts: RunAtlasOptions,
  runtime: RuntimeEnv,
) => Promise<void>;

export type RunAtlasOptions = {
  message?: string;
  yes?: boolean;
  json?: boolean;
  interactive?: boolean;
  onReady?: () => void;
  deps?: AtlasCommandDeps;
  formatOverview?: (overview: AtlasOverview) => string;
  loadOverview?: typeof loadAtlasOverview;
  planWithAssistant?: AtlasAssistantPlanner;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  runInteractiveTui?: AtlasInteractiveRunner;
};

function atlasCommandDepsFromOptions(
  opts: RunAtlasOptions,
): AtlasCommandDeps | undefined {
  if (!opts.deps && !opts.formatOverview && !opts.loadOverview) {
    return undefined;
  }
  return {
    ...opts.deps,
    ...(opts.formatOverview ? { formatOverview: opts.formatOverview } : {}),
    ...(opts.loadOverview ? { loadOverview: opts.loadOverview } : {}),
  };
}

async function runOneShot(
  input: string,
  runtime: RuntimeEnv,
  opts: RunAtlasOptions,
): Promise<void> {
  const operation = await resolveAtlasOperation(input, runtime, opts);
  await executeAtlasOperation(operation, runtime, {
    approved: opts.yes === true || !isPersistentAtlasOperation(operation),
    deps: atlasCommandDepsFromOptions(opts),
  });
}

export async function runAtlas(
  opts: RunAtlasOptions = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  if (opts.json) {
    const overview = await (opts.loadOverview ?? loadAtlasOverview)();
    writeRuntimeJson(runtime, overview);
    return;
  }

  if (opts.message?.trim()) {
    const overview = await withProgress(
      {
        label: "Loading Atlas overview…",
        indeterminate: true,
        delayMs: 0,
        fallback: "none",
      },
      async () => await (opts.loadOverview ?? loadAtlasOverview)(),
    );
    runtime.log((opts.formatOverview ?? formatAtlasOverview)(overview));
    runtime.log("");
    await runOneShot(opts.message, runtime, opts);
    return;
  }

  const interactive = opts.interactive ?? true;
  const input = opts.input ?? defaultStdin;
  const output = opts.output ?? defaultStdout;
  const inputIsTty = (input as { isTTY?: boolean }).isTTY === true;
  const outputIsTty = (output as { isTTY?: boolean }).isTTY === true;
  if (!interactive || !inputIsTty || !outputIsTty) {
    runtime.error("Atlas needs an interactive TTY. Use --message for one command.");
    runtime.exit(1);
    return;
  }

  const runInteractiveTui =
    opts.runInteractiveTui ?? (await import("./tui-backend.js")).runAtlasTui;
  opts.onReady?.();
  await runInteractiveTui(opts, runtime);
}
