/**
 * Settings → Accounts. One click per service: "Continue with Google",
 * "Connect GitHub", "Add to Slack". The sign-in happens in the user's own
 * browser; DEX never asks for tokens, keys or file paths here — the old
 * token fields live under "Advanced" for people who want them.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AgentAvatar, CopyButton, DexAvatar, NewBadge, Orb } from '../components/lib';

type Provider = AccountProviderId;

interface ProviderMeta {
  name: string;
  tagline: string;
  services: string[];
  action: string;
}

const META: Record<Provider, ProviderMeta> = {
  google: {
    name: 'Google',
    tagline: 'Mail, meetings, documents — DEX works in your account directly instead of clicking through Google’s websites.',
    services: ['Gmail', 'Calendar', 'Meet', 'Drive', 'Docs', 'Sheets', 'Contacts', 'Tasks'],
    action: 'Continue with Google',
  },
  github: {
    name: 'GitHub',
    tagline: 'Issues, pull requests, code and reviews across your repositories.',
    services: ['Repositories', 'Issues', 'Pull requests', 'Actions', 'Gists'],
    action: 'Connect GitHub',
  },
  slack: {
    name: 'Slack',
    tagline: 'Read channels and post updates in your workspace.',
    services: ['Channels', 'Messages', 'Reactions', 'People'],
    action: 'Add to Slack',
  },
};

function GoogleMark(): React.ReactElement {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function GitHubMark(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function SlackMark(): React.ReactElement {
  return (
    <svg viewBox="0 0 54 54" width="20" height="20" aria-hidden="true">
      <path fill="#36C5F0" d="M19.7 3.4a5.4 5.4 0 000 10.8h5.4V8.8a5.4 5.4 0 00-5.4-5.4zm0 14.4H5.4a5.4 5.4 0 000 10.8h14.3a5.4 5.4 0 000-10.8z" />
      <path fill="#2EB67D" d="M50.6 23.2a5.4 5.4 0 00-10.8 0v5.4h5.4a5.4 5.4 0 005.4-5.4zm-14.4 0V8.8a5.4 5.4 0 00-10.8 0v14.4a5.4 5.4 0 0010.8 0z" />
      <path fill="#ECB22E" d="M31 50.6a5.4 5.4 0 000-10.8h-5.4v5.4a5.4 5.4 0 005.4 5.4zm0-14.4h14.3a5.4 5.4 0 000-10.8H31a5.4 5.4 0 000 10.8z" />
      <path fill="#E01E5A" d="M3.4 30.8a5.4 5.4 0 0010.8 0v-5.4H8.8a5.4 5.4 0 00-5.4 5.4zm14.4 0v14.4a5.4 5.4 0 0010.8 0V30.8a5.4 5.4 0 00-10.8 0z" />
    </svg>
  );
}

const MARK: Record<Provider, () => React.ReactElement> = { google: GoogleMark, github: GitHubMark, slack: SlackMark };

type FlowState =
  | { phase: 'idle' }
  | { phase: 'browser' }
  | { phase: 'code'; userCode: string; verificationUri: string }
  | { phase: 'error'; error: string };

function AccountCard({ info, flow, onConnect, onCancel, onDisconnect }: {
  info: AccountInfo;
  flow: FlowState;
  onConnect: () => void;
  onCancel: () => void;
  onDisconnect: () => void;
}): React.ReactElement {
  const meta = META[info.provider];
  const Mark = MARK[info.provider];
  const busy = flow.phase === 'browser' || flow.phase === 'code';
  const [confirming, setConfirming] = useState(false);

  return (
    <div className={`account-card account-card--${info.provider}${info.connected ? ' account-card--connected' : ''}`}>
      <div className="account-card__head">
        <span className="account-card__mark"><Mark /></span>
        <div className="account-card__title">
          <span className="account-card__name">
            {meta.name}
            {info.provider === 'google' && !info.connected && <NewBadge scale={0.7} />}
          </span>
          <span className="account-card__tagline">{meta.tagline}</span>
        </div>
      </div>

      <div className="account-card__services">
        {meta.services.map((s) => (
          <span key={s} className="account-chip">
            {info.connected && (
              <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                <path d="M2.5 6.2l2.2 2.2L9.5 3.6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {s}
          </span>
        ))}
      </div>

      <div className="account-card__foot">
        {info.connected && info.profile ? (
          <>
            <div className="account-who">
              {info.profile.picture ? (
                <img className="account-who__pic" src={info.profile.picture} alt="" referrerPolicy="no-referrer" />
              ) : (
                <AgentAvatar sessionId={info.profile.identity} size={28} />
              )}
              <div className="account-who__text">
                <span className="account-who__name">{info.profile.name ?? info.profile.identity}</span>
                {info.profile.name && <span className="account-who__id">{info.profile.identity}</span>}
              </div>
              <span className="account-who__status">Connected</span>
            </div>
            {confirming ? (
              <div className="account-card__confirm">
                <span>Disconnect {meta.name}?</span>
                <button type="button" className="account-btn account-btn--ghost" onClick={() => setConfirming(false)}>Keep</button>
                <button type="button" className="account-btn account-btn--danger" onClick={() => { setConfirming(false); onDisconnect(); }}>Disconnect</button>
              </div>
            ) : (
              <button type="button" className="account-btn account-btn--ghost" onClick={() => setConfirming(true)}>Disconnect</button>
            )}
          </>
        ) : flow.phase === 'browser' ? (
          <div className="account-flow" role="status">
            <Orb size={32} state="connecting" />
            <div className="account-flow__text">
              <strong>Finish in your browser</strong>
              <span>Sign in and allow DEX, then come back here.</span>
            </div>
            <button type="button" className="account-btn account-btn--ghost" onClick={onCancel}>Cancel</button>
          </div>
        ) : flow.phase === 'code' ? (
          <div className="account-flow account-flow--code" role="status">
            <Orb size={32} state="listening" />
            <div className="account-flow__text">
              <strong>Enter this code on GitHub</strong>
              <span>It’s already copied — paste it on the page that just opened.</span>
            </div>
            <div className="account-code" aria-label={`Code ${flow.userCode}`}>
              {flow.userCode.split('').map((ch, i) => (
                <span key={i} className={ch === '-' ? 'account-code__dash' : 'account-code__char'}>{ch}</span>
              ))}
            </div>
            <CopyButton text={flow.userCode} label="Copy code" />
            <button type="button" className="account-btn account-btn--ghost" onClick={onCancel}>Cancel</button>
          </div>
        ) : (
          <>
            {info.provider === 'google' ? (
              <button type="button" className="google-btn" onClick={onConnect} disabled={busy || !info.available}>
                <GoogleMark />
                <span>{meta.action}</span>
              </button>
            ) : (
              <button type="button" className="account-btn account-btn--primary" onClick={onConnect} disabled={busy || !info.available}>
                <Mark />
                {info.via === 'cli' ? 'Connect with GitHub CLI' : meta.action}
              </button>
            )}
            {!info.available && info.devBuild && (
              <span className="account-card__note">
                Dev build: this checkout has no {meta.name} sign-in app. Run <code>yarn oauth:setup</code> once (it also uploads it for releases), then restart.
              </span>
            )}
            {info.via === 'cli' && <span className="account-card__note">Uses the account you’re signed into with <code>gh</code> — nothing to register.</span>}
            {flow.phase === 'error' && <span className="account-card__error" role="alert">{flow.error}</span>}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * DEX for Android pairs by signing in to the same Firebase account (email and
 * password) on both sides. This card is that sign-in, and afterwards the
 * live state of the link.
 */
function PhoneCard(): React.ReactElement {
  const api = window.electronAPI?.settings?.bridge;
  const [state, setState] = useState<PhoneBridgeState | null>(null);
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    void api?.status().then(setState).catch(() => {});
    return api?.onState(setState);
  }, [api]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!api || busy) return;
    setBusy(true);
    setMessage(null);
    const res = await api.signIn(email, password, mode === 'create');
    setBusy(false);
    if (!res.ok) setMessage({ tone: 'error', text: res.error ?? 'Sign-in failed.' });
    else setPassword('');
  };

  const reset = async () => {
    if (!api) return;
    if (!email.includes('@')) { setMessage({ tone: 'error', text: 'Type your email first.' }); return; }
    const res = await api.resetPassword(email);
    setMessage(res.ok ? { tone: 'info', text: `Check ${email} for a reset link.` } : { tone: 'error', text: res.error ?? 'Couldn’t send the email.' });
  };

  const online = state?.state === 'online';
  const connecting = state?.state === 'connecting' || busy;

  // A build without the phone service just doesn't offer it — no setup talk.
  if (state?.state === 'off' && state.reason === 'no-firebase') return null;

  return (
    <div className={`account-card account-card--phone${online ? ' account-card--connected' : ''}`}>
      <div className="account-card__head">
        <span className="account-card__mark"><Orb size={32} state={online ? 'listening' : connecting ? 'connecting' : 'breathing'} /></span>
        <div className="account-card__title">
          <span className="account-card__name">
            {online ? 'Your phone can reach this PC' : 'DEX on your phone'}
            {!online && <NewBadge scale={0.7} />}
          </span>
          <span className="account-card__tagline">
            {online
              ? 'On your phone, open DEX and sign in with the same email and password — tasks, live progress and approvals sync automatically.'
              : 'Sign in with an email and password here, then use the same pair in DEX for Android. That’s the whole pairing.'}
          </span>
        </div>
      </div>

      {online && (
        <div className="account-card__foot">
          <div className="account-who">
            <DexAvatar size={28} />
            <div className="account-who__text">
              <span className="account-who__name">{state.email ?? 'DEX account'}</span>
              <span className="account-who__id">Phone link on</span>
            </div>
            <span className="account-who__status">Connected</span>
          </div>
          <button type="button" className="account-btn account-btn--ghost" onClick={() => { void api?.signOut(); }}>Sign out</button>
        </div>
      )}

      {!online && !(state?.state === 'off' && state.reason === 'no-firebase') && (
        <form className="phone-form" onSubmit={(e) => { void submit(e); }}>
          <div className="phone-form__tabs" role="tablist">
            {(['signin', 'create'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={`phone-form__tab${mode === m ? ' phone-form__tab--active' : ''}`}
                onClick={() => { setMode(m); setMessage(null); }}
              >
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>
          <input
            className="phone-form__input"
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="phone-form__input"
            type="password"
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            placeholder={mode === 'create' ? 'Password (6+ characters)' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
          {message && <span className={`phone-form__msg phone-form__msg--${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</span>}
          <div className="phone-form__actions">
            <button type="submit" className="account-btn account-btn--primary" disabled={busy || !email.includes('@') || password.length < 6}>
              {busy ? 'Connecting…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
            {mode === 'signin' && (
              <button type="button" className="account-btn account-btn--ghost" onClick={() => { void reset(); }}>Forgot password?</button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

export function AccountsSection({ advanced }: { advanced?: React.ReactNode }): React.ReactElement {
  const api = window.electronAPI?.settings?.accounts;
  const [accounts, setAccounts] = useState<AccountInfo[] | null>(null);
  const [flows, setFlows] = useState<Partial<Record<Provider, FlowState>>>({});

  const reload = useCallback(() => {
    void api?.list().then(setAccounts).catch(() => setAccounts([]));
  }, [api]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => api?.onProgress((event) => {
    setFlows((prev) => {
      if (event.phase === 'done') return { ...prev, [event.provider]: { phase: 'idle' } };
      if (event.phase === 'error') return { ...prev, [event.provider]: { phase: 'error', error: event.error } };
      if (event.phase === 'code') return { ...prev, [event.provider]: { phase: 'code', userCode: event.userCode, verificationUri: event.verificationUri } };
      return { ...prev, [event.provider]: { phase: 'browser' } };
    });
    if (event.phase === 'done') reload();
  }), [api, reload]);

  const connect = useCallback((provider: Provider) => {
    setFlows((prev) => ({ ...prev, [provider]: { phase: 'browser' } }));
    void api?.connect(provider).then(reload);
  }, [api, reload]);

  const cancel = useCallback((provider: Provider) => {
    void api?.cancel(provider);
    setFlows((prev) => ({ ...prev, [provider]: { phase: 'idle' } }));
  }, [api]);

  const disconnect = useCallback((provider: Provider) => {
    void api?.disconnect(provider).then(reload);
  }, [api, reload]);

  return (
    <div className="accounts">
      {!accounts ? (
        <div className="accounts__loading"><Orb size={32} state="connecting" /></div>
      ) : (
        <div className="accounts__grid">
          {/* An installed DEX only shows what it can actually connect. */}
          {accounts.filter((info) => info.available || info.connected || info.devBuild).map((info) => (
            <AccountCard
              key={info.provider}
              info={info}
              flow={flows[info.provider] ?? { phase: 'idle' }}
              onConnect={() => connect(info.provider)}
              onCancel={() => cancel(info.provider)}
              onDisconnect={() => disconnect(info.provider)}
            />
          ))}
        </div>
      )}
      <PhoneCard />
      <p className="accounts__privacy">
        Sign-in happens in your browser. DEX stores only the access Google, GitHub or Slack grants it, in Windows Credential Manager,
        and you can remove it here or from your account settings at any time.
      </p>
      {advanced && (
        <details className="accounts__advanced">
          <summary>Advanced — connect with a token instead</summary>
          {advanced}
        </details>
      )}
    </div>
  );
}

export default AccountsSection;
