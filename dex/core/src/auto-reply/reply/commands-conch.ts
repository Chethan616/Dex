import { logVerbose } from "../../globals.js";
import type { CommandHandler } from "./commands-types.js";

export const handleConchCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const { extractConchRescueMessage, runConchRescueMessage } =
    await import("../../conch/rescue-message.js");
  if (extractConchRescueMessage(params.command.commandBodyNormalized) === null) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /conch from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  return {
    shouldContinue: false,
    reply: {
      text:
        (await runConchRescueMessage({
          cfg: params.cfg,
          command: params.command,
          commandBody: params.command.commandBodyNormalized,
          agentId: params.agentId,
          isGroup: params.isGroup,
        })) ?? "Conch did not find a rescue request.",
    },
  };
};
