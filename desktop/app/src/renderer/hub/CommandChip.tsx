/**
 * The visual half of slash commands, shared by the dashboard input and the
 * Ctrl+Shift+Space overlay so both look and behave the same.
 *
 * slashCommands.ts stays JSX-free (it is the tested logic); this holds the
 * pieces that render — the per-command glyph, the committed chip, and the
 * suggestion row.
 */
import React from 'react';
import type { SlashCommand } from './slashCommands';

export function CommandIcon({ name }: { name: string }): React.ReactElement {
  if (name === 'scrape') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
        <path d="M2 8h12M8 2c1.8 1.6 2.8 3.8 2.8 6S9.8 12.4 8 14C6.2 12.4 5.2 10.2 5.2 8S6.2 3.6 8 2z" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }
  if (name === 'bugbounty') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 1.5l5 2v4c0 3-2.1 5.3-5 7-2.9-1.7-5-4-5-7v-4l5-2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M5.6 8.2l1.7 1.7 3.1-3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l4 4-4 4M9 12h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "scrape" -> "Scrape". */
export function commandLabel(command: SlashCommand): string {
  return command.name.charAt(0).toUpperCase() + command.name.slice(1);
}

/** The committed command, shown as a removable token. */
export function CommandChip({ command, onRemove }: { command: SlashCommand; onRemove: () => void }): React.ReactElement {
  return (
    <div className="task-input__command">
      <span className="task-input__command-chip">
        <CommandIcon name={command.name} />
        <span className="task-input__command-name">{commandLabel(command)}</span>
        <button
          type="button"
          className="task-input__command-remove"
          aria-label={`Remove ${commandLabel(command)} command`}
          onMouseDown={(e) => {
            // mousedown, not click: keep focus in the field. Removes the chip
            // cleanly — it never turns back into "/scrape" text.
            e.preventDefault();
            onRemove();
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </span>
    </div>
  );
}

/** The suggestion row shown while the command word is being typed. */
export function CommandHints({
  hints,
  onPick,
}: {
  hints: SlashCommand[];
  onPick: (command: SlashCommand) => void;
}): React.ReactElement | null {
  if (hints.length === 0) return null;
  return (
    <div className="task-input__slash">
      {hints.map((command) => (
        <button
          type="button"
          key={command.name}
          className="task-input__slash-item"
          onMouseDown={(e) => { e.preventDefault(); onPick(command); }}
        >
          <span className="task-input__slash-usage">{command.usage}</span>
          <span className="task-input__slash-summary">{command.summary}</span>
        </button>
      ))}
    </div>
  );
}
