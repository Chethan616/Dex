/**
 * Settings › Channels › Telegram: your own DEX bot. Make it with @BotFather,
 * paste its token, then open the pairing link (or scan it) so the bot
 * answers you and nobody else (main/channels/TelegramAdapter.ts).
 */
import React, { useCallback, useEffect, useState } from 'react';

const open = (url: string) => { void window.electronAPI?.widgets?.openUrl(url); };

function TelegramMark(): React.ReactElement {
  return (
    <svg className="conn-card__icon" viewBox="0 0 24 24" role="img" aria-label="Telegram">
      <circle cx="12" cy="12" r="10" fill="#fff" />
      <path fill="#26A5E4" d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

export function TelegramCard(): React.ReactElement | null {
  const api = window.electronAPI?.channels?.telegram;
  const [info, setInfo] = useState<TelegramChannelInfo | null>(null);
  const [setup, setSetup] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => { void api?.status().then(setInfo).catch(() => {}); }, [api]);
  useEffect(() => {
    refresh();
    return window.electronAPI?.on?.channelStatus?.((channelId) => { if (channelId === 'telegram') refresh(); });
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

  const status = info?.status ?? 'disconnected';
  const hasBot = !!info?.bot;
  const paired = hasBot && !!info?.owner;
  const dot = status === 'connected' ? (paired ? 'connected' : 'connecting')
    : status === 'connecting' ? 'connecting'
    : status === 'error' ? 'error'
    : 'disconnected';

  const subtitle = !hasBot
    ? 'Message your own DEX bot on Telegram to start tasks and get answers and files back — no number needed. It takes a minute to set up.'
    : status === 'error'
      ? info?.error ?? 'Telegram stopped answering.'
      : status === 'connecting'
        ? `Connecting to @${info?.bot}…`
        : paired
          ? `@${info?.bot} answers ${info?.owner}. Message it to start a task; reply to its answers to keep going.`
          : `@${info?.bot} is ready. Pair it with your Telegram so it answers you and nobody else.`;

  return (
    <div className="conn-card">
      <div className="conn-card__header">
        <TelegramMark />
        <div className="conn-card__info">
          <div className="conn-card__title-row">
            <span className="conn-card__name">Telegram</span>
            <span className={`conn-card__dot conn-card__dot--${dot}`} />
          </div>
          <span className="conn-card__subtitle">{subtitle}</span>
        </div>
        <div className="conn-card__actions">
          {!hasBot && !setup && (
            <button type="button" className="conn-card__btn conn-card__btn--primary" onClick={() => setSetup(true)}>Set up</button>
          )}
          {paired && status === 'connected' && (
            <button type="button" className="conn-card__btn conn-card__btn--secondary" onClick={() => open(`https://t.me/${info?.bot}`)}>Open chat</button>
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
              In Telegram, open <button type="button" className="tg-setup__link" onClick={() => open('https://t.me/BotFather')}>@BotFather</button> and
              send <code>/newbot</code>. Give it any name, and a username ending in “bot”.
            </li>
            <li>Paste the token it sends you:</li>
          </ol>
          <div className="conn-card__api-key-edit">
            <input
              className="conn-card__api-key-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="123456789:AA…"
              aria-label="Bot token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoFocus
            />
            <button type="submit" className="conn-card__btn conn-card__btn--primary" disabled={busy || token.trim().length < 20}>
              {busy ? 'Checking…' : 'Connect'}
            </button>
            <button type="button" className="conn-card__btn conn-card__btn--secondary" onClick={() => { setSetup(false); setError(null); }}>Cancel</button>
            {error && <span className="conn-card__api-key-error" role="alert">{error}</span>}
          </div>
          <p className="tg-setup__note">The token stays in Windows Credential Manager on this PC.</p>
        </form>
      )}

      {hasBot && !paired && status === 'connected' && info?.pairUrl && (
        <div className="conn-card__qr">
          {info.pairQr && <img className="conn-card__qr-img" src={info.pairQr} alt="Telegram pairing code" />}
          <button type="button" className="conn-card__btn conn-card__btn--primary" onClick={() => open(info.pairUrl as string)}>
            Open in Telegram
          </button>
          <p className="conn-card__qr-hint">
            Scan it with your phone’s camera, or open it here, and press Start. The bot answers whoever pairs first — you.
          </p>
        </div>
      )}
    </div>
  );
}
