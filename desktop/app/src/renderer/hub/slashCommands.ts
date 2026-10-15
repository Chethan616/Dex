/**
 * Slash commands for the hub's composers: the shared list
 * (shared/slashCommands.ts, which main also uses for commands typed on the
 * phone), plus what the hub does itself when one is typed bare inside a task.
 */
import { SLASH_COMMANDS } from '../../shared/slashCommands';

export * from '../../shared/slashCommands';

for (const command of SLASH_COMMANDS) {
  // `/workflow` alone in a task: the saved workflows, drawn into the chat with no agent turn.
  if (command.name === 'workflow') command.inTask = (sessionId) => { void window.electronAPI?.workflows?.showInChat(sessionId); };
}
