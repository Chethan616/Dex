import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { theme } from "../../packages/terminal-core/src/theme.js";
import { resolveBuiltinEngineServers } from "../engines/builtin-engines.js";
import { defaultRuntime } from "../runtime.js";

// `dex engines` — set up and inspect the built-in automation engines.
//
// The npm package ships the brain + the small Python driver sources, but
// the heavy venvs (UFO² + browser-use + Playwright Chromium, ~1 GB) are
// not in the tarball. `setup` builds those venvs into the stable home
// ~/.dex/engines/<engine> that builtin-engines.ts already resolves.
// `status` reports what resolved so "do I have hands" is a one-liner.

const ENGINES_HOME = path.join(os.homedir(), ".dex", "engines");
const UFO_REPO = "https://github.com/microsoft/UFO";

function findPython(): string[] | null {
  // Prefer the Windows py launcher pinned to 3.11, then fall back. Each
  // candidate is an argv prefix so `py -3.11` works as one launcher.
  const candidates: string[][] = [
    ["py", "-3.11"],
    ["py", "-3"],
    ["python"],
    ["python3"],
  ];
  for (const argv of candidates) {
    const probe = spawnSync(argv[0], [...argv.slice(1), "--version"], {
      encoding: "utf8",
    });
    if (probe.status === 0) {
      return argv;
    }
  }
  return null;
}

function run(label: string, command: string, args: string[], cwd?: string): boolean {
  defaultRuntime.log(theme.muted(`  $ ${command} ${args.join(" ")}`));
  const result = spawnSync(command, args, { stdio: "inherit", cwd });
  if (result.status === 0) {
    return true;
  }
  defaultRuntime.error(theme.warn(`  ${label} failed (exit ${result.status ?? "?"}).`));
  return false;
}

function venvPython(engineDir: string): string {
  return path.join(engineDir, ".venv", "Scripts", "python.exe");
}

function ensureVenv(pythonArgv: string[], engineDir: string, force: boolean): boolean {
  const py = venvPython(engineDir);
  if (fs.existsSync(py) && !force) {
    defaultRuntime.log(theme.muted(`  venv already present: ${py}`));
    return true;
  }
  fs.mkdirSync(engineDir, { recursive: true });
  return run(
    "venv create",
    pythonArgv[0],
    [...pythonArgv.slice(1), "-m", "venv", path.join(engineDir, ".venv")],
  );
}

function setupBrowser(pythonArgv: string[], force: boolean): boolean {
  defaultRuntime.log(theme.heading("\nbrowser-use"));
  const dir = path.join(ENGINES_HOME, "browser-use");
  if (!ensureVenv(pythonArgv, dir, force)) {
    return false;
  }
  const py = venvPython(dir);
  const ok =
    run("pip install", py, [
      "-m",
      "pip",
      "install",
      "--upgrade",
      "browser-use",
      "playwright",
      "groq",
      "mcp",
    ]) && run("playwright install", py, ["-m", "playwright", "install", "chromium"]);
  if (ok) {
    defaultRuntime.log(theme.success("  browser-use ready."));
  }
  return ok;
}

function setupUfo(pythonArgv: string[], force: boolean): boolean {
  defaultRuntime.log(theme.heading("\nUFO² (Windows desktop)"));
  const dir = path.join(ENGINES_HOME, "UFO");
  const repoMarker = path.join(dir, "ufo");
  if (!fs.existsSync(repoMarker)) {
    if (!run("git clone", "git", ["clone", "--depth", "1", UFO_REPO, dir])) {
      defaultRuntime.error(
        theme.warn("  Could not clone UFO². Install git, or use the all-in-one Dex installer."),
      );
      return false;
    }
  } else {
    defaultRuntime.log(theme.muted(`  UFO² source already present: ${dir}`));
  }
  if (!ensureVenv(pythonArgv, dir, force)) {
    return false;
  }
  const py = venvPython(dir);
  const reqs = path.join(dir, "requirements.txt");
  const ok =
    run("pip install", py, ["-m", "pip", "install", "--upgrade", "pip"]) &&
    (fs.existsSync(reqs)
      ? run("pip install -r requirements", py, ["-m", "pip", "install", "-r", reqs])
      : true) &&
    run("pip install mcp", py, ["-m", "pip", "install", "mcp"]);
  if (ok) {
    defaultRuntime.log(theme.success("  UFO² ready."));
    defaultRuntime.log(
      theme.muted("  Add your Gemini key + model via the Dex app (Settings → Secrets)."),
    );
  }
  return ok;
}

function printStatus(): void {
  const { statuses } = resolveBuiltinEngineServers();
  defaultRuntime.log(theme.heading("Built-in engines"));
  if (statuses.length === 0) {
    defaultRuntime.log(
      theme.muted("  No engines on this platform (built-in engines are Windows-only for now)."),
    );
    return;
  }
  for (const s of statuses) {
    const mark = s.available ? theme.success("ready") : theme.warn(`unavailable (${s.reason})`);
    defaultRuntime.log(`  ${s.label}: ${mark}`);
  }
  const anyMissing = statuses.some((s) => !s.available);
  if (anyMissing) {
    defaultRuntime.log(
      `\n${theme.muted("Set up the missing engines with")} ${theme.command("dex engines setup")}`,
    );
  }
}

export function registerEnginesCli(program: Command): void {
  const engines = program
    .command("engines")
    .description("Set up and inspect the built-in automation engines (UFO² + browser-use)");

  engines
    .command("status")
    .description("Show which built-in engines resolved on this machine")
    .action(() => {
      printStatus();
    });

  engines
    .command("setup")
    .description("Build the Python venvs for the built-in engines into ~/.dex/engines")
    .option("--engine <name>", "Which engine: all | ufo | browser", "all")
    .option("--force", "Recreate venvs even if present", false)
    .action((opts: { engine: string; force: boolean }) => {
      const which = opts.engine.toLowerCase();
      const pythonArgv = findPython();
      if (!pythonArgv) {
        defaultRuntime.error(
          theme.warn(
            "No Python found. Install Python 3.11+ (python.org) and re-run, or use the all-in-one Dex installer which bundles everything.",
          ),
        );
        defaultRuntime.exit(1);
        return;
      }
      defaultRuntime.log(theme.muted(`Using Python: ${pythonArgv.join(" ")}`));
      fs.mkdirSync(ENGINES_HOME, { recursive: true });

      let ok = true;
      if (which === "all" || which === "browser") {
        ok = setupBrowser(pythonArgv, opts.force) && ok;
      }
      if (which === "all" || which === "ufo") {
        ok = setupUfo(pythonArgv, opts.force) && ok;
      }

      defaultRuntime.log("");
      printStatus();
      if (!ok) {
        defaultRuntime.error(theme.warn("\nOne or more engines did not finish setup (see above)."));
        defaultRuntime.exit(1);
      }
    });
}
