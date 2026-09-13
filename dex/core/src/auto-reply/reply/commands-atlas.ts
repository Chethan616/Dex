import { logVerbose } from "../../globals.js";
import type { CommandHandler } from "./commands-types.js";

export const handleAtlasCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const { extractAtlasRescueMessage, runAtlasRescueMessage } =
    await import("../../atlas/rescue-message.js");
  if (extractAtlasRescueMessage(params.command.commandBodyNormalized) === null) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /atlas from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  return {
    shouldContinue: false,
    reply: {
      text:
        (await runAtlasRescueMessage({
          cfg: params.cfg,
          command: params.command,
          commandBody: params.command.commandBodyNormalized,
          agentId: params.agentId,
          isGroup: params.isGroup,
        })) ?? "Atlas did not find a rescue request.",
    },
  };
};
