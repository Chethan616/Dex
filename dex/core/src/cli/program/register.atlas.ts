import type { Command } from "commander";
import { theme } from "../../../packages/terminal-core/src/theme.js";
import { runAtlas } from "../../atlas/atlas.js";
import { defaultRuntime } from "../../runtime.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { formatHelpExamples } from "../help-format.js";

export function registerAtlasCommand(program: Command) {
  program
    .command("atlas")
    .description("Open the ring-zero setup and repair helper")
    .option("-m, --message <text>", "Run one Atlas request")
    .option("--yes", "Approve persistent config writes for this request", false)
    .option("--json", "Output startup overview as JSON", false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          ["openclaw", "Start Atlas."],
          ["dex atlas", "Start Atlas explicitly."],
          ['dex atlas -m "status"', "Run one status request."],
          [
            'dex atlas -m "set default model openai/gpt-5.2" --yes',
            "Apply a typed config write.",
          ],
        ])}`,
    )
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await runAtlas({
          message: opts.message as string | undefined,
          yes: Boolean(opts.yes),
          json: Boolean(opts.json),
        });
      });
    });
}
