/**
 * Settings › Channels › Discord: your own DEX bot. Make an app in the
 * Developer Portal, paste its bot token, add the bot to a server of yours,
 * then send it the pairing code so it answers you and nobody else
 * (main/channels/DiscordAdapter.ts).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ChannelTips } from './TelegramCard';

const open = (url: string) => { void window.electronAPI?.widgets?.openUrl(url); };

function DiscordMark(): React.ReactElement {
  return (
    <svg className="conn-card__icon" viewBox="0 0 24 24" role="img" aria-label="Discord">
      <circle cx="12" cy="12" r="12" fill="#5865F2" />
      <path
        transform="translate(5 5.6) scale(0.583)"
        fill="#fff"
        d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.1 14.1 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.33c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z"
      />
    </svg>
  );
}

export function DiscordCard(): React.ReactElement | null {
  const api = window.electronAPI?.channels?.discord;
  const [info, setInfo] = useState<DiscordChannelInfo | null>(null);
  const [setup, setSetup] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => { void api?.status().then(setInfo).catch(() => {}); }, [api]);
  useEffect(() => {
    refresh();
    return window.electronAPI?.on?.channelStatus?.((channelId) => { if (channelId === 'discord') refresh(); });
  }, [refresh]);

  if (!api) return null;

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await api.connect(token).catch((err: Error) => ({ ok: false, error: err.message, info: undefined }));
    setBusy(false);
    if (!res.ok) { setError(res.error ?? 'Couldn’t connect the bot.'); return; }
    setToken('');
    setSetup(false);
    if (res.info) setInfo(res.info);
  };

  const remove = async () => {
    setInfo(await api.remove());
    setSetup(false);
  };

  const copyCode = () => {
    if (!info?.pairCode) return;
    void navigator.clipboard.writeText(info.pairCode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  const status = info?.status ?? 'disconnected';
  const hasBot = !!info?.bot;
  const paired = hasBot && !!info?.owner;
  const dot = status === 'connected' ? (paired ? 'connected' : 'connecting')
    : status === 'connecting' ? 'connecting'
    : status === 'error' ? 'error'
    : 'disconnected';

  const subtitle = !hasBot
    ? 'Message your own DEX bot on Discord: start tasks, press its buttons to answer, and get files back. It takes a few minutes to set up.'
    : status === 'error'
      ? info?.error ?? 'Discord stopped answering.'
      : status === 'connecting'
        ? `Connecting to ${info?.bot}…`
        : paired
          ? `${info?.bot} answers ${info?.owner}. DM it a task; press its buttons or reply to keep going.`
          : `${info?.bot} is online. Pair it with your Discord so it answers you and nobody else.`;

  return (
    <div className="conn-card">
      <div className="conn-card__header">
        <DiscordMark />
        <div className="conn-card__info">
          <div className="conn-card__title-row">
            <span className="conn-card__name">Discord</span>
            <span className={`conn-card__dot conn-card__dot--${dot}`} />
          </div>
          <span className="conn-card__subtitle">{subtitle}</span>
        </div>
        <div className="conn-card__actions">
          {!hasBot && !setup && (
            <button type="button" className="conn-card__btn conn-card__btn--primary" onClick={() => setSetup(true)}>Set up</button>
          )}
          {paired && status === 'connected' && info?.dmUrl && (
            <button type="button" className="conn-card__btn conn-card__btn--secondary" onClick={() => open(info.dmUrl as string)}>Open chat</button>
          )}
          {hasBot && status === 'error' && !setup && (
            <button type="button" className="conn-card__btn conn-card__btn--primary" onClick={() => setSetup(true)}>New token</button>
          )}
          {hasBot && (
            <button type="button" className="conn-card__btn conn-card__btn--secondary" onClick={() => { void remove(); }}>Remove</button>
          )}
        </div>
      </div>

      {setup && (
        <form className="tg-setup" onSubmit={(e) => { void connect(e); }}>
          <ol className="tg-setup__steps">
            <li>
              Open the <button type="button" className="tg-setup__link" onClick={() => open('https://discord.com/developers/applications')}>Discord Developer Portal</button> and
              press <b>New Application</b>. Any name works — it’s what the bot is called.
            </li>
            <li>Open <b>Bot</b>, press <b>Reset Token</b>, and copy it. Nothing else to switch on.</li>
            <li>Paste it here:</li>
          </ol>
          <div className="conn-card__api-key-edit">
            <input
              className="conn-card__api-key-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="MTIz…"
              aria-label="Bot token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoFocus
            />
            <button type="submit" className="conn-card__btn conn-card__btn--primary" disabled={busy || token.trim().length < 50}>
              {busy ? 'Checking…' : 'Connect'}
            </button>
            <button type="button" className="conn-card__btn conn-card__btn--secondary" onClick={() => { setSetup(false); setError(null); }}>Cancel</button>
            {error && <span className="conn-card__api-key-error" role="alert">{error}</span>}
          </div>
          <p className="tg-setup__note">The token stays in Windows Credential Manager on this PC.</p>
        </form>
      )}

      {hasBot && !paired && status === 'connected' && info?.pairCode && (
        <ol className="dc-pair">
          <li>
            <span className="dc-pair__n">1</span>
            <span className="dc-pair__text">Add the bot to a server of yours — any you own; in Discord, <b>+</b> makes a new one in a click.</span>
            {info.inviteUrl && <button type="button" className="conn-card__btn conn-card__btn--primary" onClick={() => open(info.inviteUrl as string)}>Add to server</button>}
          </li>
          <li>
            <span className="dc-pair__n">2</span>
            <span className="dc-pair__text">Send it this code in a DM (click the bot in the member list), or @mention it with the code.</span>
            <button type="button" className="dc-pair__code" onClick={copyCode} title="Copy">
              <code>{info.pairCode}</code>
              <em>{copied ? 'Copied' : 'Copy'}</em>
            </button>
          </li>
        </ol>
      )}

      {paired && status === 'connected' && (
        <ChannelTips tips={['DM a task, or @mention it', 'Press buttons to answer', 'Send photos and files', '/status · /stop · /new']} />
      )}
    </div>
  );
}
