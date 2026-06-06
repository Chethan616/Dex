import type { Command } from "commander";
import { theme } from "../../../packages/terminal-core/src/theme.js";
import { runConch } from "../../conch/conch.js";
import { defaultRuntime } from "../../runtime.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { formatHelpExamples } from "../help-format.js";

export function registerConchCommand(program: Command) {
  program
    .command("conch")
    .description("Open the ring-zero setup and repair helper")
    .option("-m, --message <text>", "Run one Conch request")
    .option("--yes", "Approve persistent config writes for this request", false)
    .option("--json", "Output startup overview as JSON", false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          ["openclaw", "Start Conch."],
          ["dex conch", "Start Conch explicitly."],
          ['dex conch -m "status"', "Run one status request."],
          [
            'dex conch -m "set default model openai/gpt-5.2" --yes',
            "Apply a typed config write.",
          ],
        ])}`,
    )
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await runConch({
          message: opts.message as string | undefined,
          yes: Boolean(opts.yes),
          json: Boolean(opts.json),
        });
      });
    });
}
