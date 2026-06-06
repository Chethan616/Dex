import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import { withProgress } from "../cli/progress.js";
import { defaultRuntime, writeRuntimeJson, type RuntimeEnv } from "../runtime.js";
import type { ConchAssistantPlanner } from "./assistant.js";
import { resolveConchOperation } from "./dialogue.js";
import {
  executeConchOperation,
  isPersistentConchOperation,
  type ConchCommandDeps,
} from "./operations.js";
import {
  formatConchOverview,
  loadConchOverview,
  type ConchOverview,
} from "./overview.js";

type ConchInteractiveRunner = (
  opts: RunConchOptions,
  runtime: RuntimeEnv,
) => Promise<void>;

export type RunConchOptions = {
  message?: string;
  yes?: boolean;
  json?: boolean;
  interactive?: boolean;
  onReady?: () => void;
  deps?: ConchCommandDeps;
  formatOverview?: (overview: ConchOverview) => string;
  loadOverview?: typeof loadConchOverview;
  planWithAssistant?: ConchAssistantPlanner;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  runInteractiveTui?: ConchInteractiveRunner;
};

function conchCommandDepsFromOptions(
  opts: RunConchOptions,
): ConchCommandDeps | undefined {
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
  opts: RunConchOptions,
): Promise<void> {
  const operation = await resolveConchOperation(input, runtime, opts);
  await executeConchOperation(operation, runtime, {
    approved: opts.yes === true || !isPersistentConchOperation(operation),
    deps: conchCommandDepsFromOptions(opts),
  });
}

export async function runConch(
  opts: RunConchOptions = {},
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  if (opts.json) {
    const overview = await (opts.loadOverview ?? loadConchOverview)();
    writeRuntimeJson(runtime, overview);
    return;
  }

  if (opts.message?.trim()) {
    const overview = await withProgress(
      {
        label: "Loading Conch overview…",
        indeterminate: true,
        delayMs: 0,
        fallback: "none",
      },
      async () => await (opts.loadOverview ?? loadConchOverview)(),
    );
    runtime.log((opts.formatOverview ?? formatConchOverview)(overview));
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
    runtime.error("Conch needs an interactive TTY. Use --message for one command.");
    runtime.exit(1);
    return;
  }

  const runInteractiveTui =
    opts.runInteractiveTui ?? (await import("./tui-backend.js")).runConchTui;
  opts.onReady?.();
  await runInteractiveTui(opts, runtime);
}
