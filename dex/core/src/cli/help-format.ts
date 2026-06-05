import { theme } from "../../packages/terminal-core/src/theme.js";
import { replaceCliName } from "./cli-name.js";

export type HelpExample = readonly [command: string, description: string];

function formatHelpExample(command: string, description: string): string {
  // Rewrite legacy `openclaw <sub>` prefix to whatever CLI name is active so
  // hardcoded example strings track the rebrand automatically.
  return `  ${theme.command(replaceCliName(command))}\n    ${theme.muted(description)}`;
}

function formatHelpExampleLine(command: string, description: string): string {
  const renamed = replaceCliName(command);
  if (!description) {
    return `  ${theme.command(renamed)}`;
  }
  return `  ${theme.command(renamed)} ${theme.muted(`# ${description}`)}`;
}

export function formatHelpExamples(examples: ReadonlyArray<HelpExample>, inline = false): string {
  const formatter = inline ? formatHelpExampleLine : formatHelpExample;
  return examples.map(([command, description]) => formatter(command, description)).join("\n");
}
