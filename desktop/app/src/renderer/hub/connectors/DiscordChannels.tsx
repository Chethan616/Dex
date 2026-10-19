/**
 * The Marketplace's Discord page, once connected: the channels DEX may post
 * to. Each is one Discord made when you picked it on its own page; "Add a
 * channel" opens that page again. Remove deletes its webhook, so DEX can't
 * post there any more. Discord sign-in can't read messages, and this says so.
 */
import React, { useState } from 'react';

export function DiscordChannels({ info, onChanged }: { info: AccountInfo; onChanged: () => void }): React.ReactElement {
  const api = window.electronAPI?.settings?.accounts;
  const channels = info.discord?.channels ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const add = async () => {
    if (!api?.discordAddChannel || busy) return;
    setBusy(true);
    setError(null);
    const res = await api.discordAddChannel().catch((err: Error) => ({ ok: false, error: err.message }));
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Couldn’t add the channel.');
    onChanged();
  };
  const remove = async (id: string) => { await api?.discordRemoveChannel?.(id); onChanged(); };
  const rename = async (id: string) => {
    const label = draft.trim();
    setEditing(null);
    if (label) { await api?.discordRenameChannel?.(id, label); onChanged(); }
  };

  return (
    <div className="dc-chan">
      <div className="dc-chan__head">
        <span className="dc-chan__title">Channels DEX can post to</span>
        {busy
          ? <span className="dc-chan__wait">Pick a channel in your browser…</span>
          : <button type="button" className="mk__btn mk__btn--quiet dc-chan__add" onClick={() => void add()}>+ Add a channel</button>}
      </div>
      {channels.length === 0 ? (
        <p className="dc-chan__empty">None yet. Add one, and tasks can post updates, summaries and files there.</p>
      ) : (
        <ul className="dc-chan__list">
          {channels.map((c) => (
            <li key={c.id} className="dc-chan__row">
              <span className="dc-chan__hash" aria-hidden="true">#</span>
              {editing === c.id ? (
                <input
                  className="dc-chan__input"
                  value={draft}
                  autoFocus
                  maxLength={60}
                  aria-label="Channel name"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => void rename(c.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void rename(c.id); else if (e.key === 'Escape') setEditing(null); }}
                />
              ) : (
                <button type="button" className="dc-chan__name" title="Rename" onClick={() => { setEditing(c.id); setDraft(c.label); }}>{c.label}</button>
              )}
              <button type="button" className="dc-chan__x" aria-label={`Remove ${c.label}`} title="Remove: DEX can't post there any more" onClick={() => void remove(c.id)}>×</button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mk__error" role="alert">{error}</p>}
      <p className="dc-chan__note">Discord doesn’t let sign-in apps read messages: DEX posts, it doesn’t read. Mentions never ping anyone.</p>
    </div>
  );
}
