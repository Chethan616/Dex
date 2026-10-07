/**
 * Settings › Channels › DEX on your phone. DEX for Android pairs by signing
 * in to the same Firebase account (email and password) on both sides: this
 * card is that sign-in, and afterwards the live state of the link.
 */
import React, { useEffect, useState } from 'react';
import { NewBadge, Orb } from '../components/lib';

export function PhoneCard(): React.ReactElement | null {
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

  // A build without the phone service just doesn't offer it — no setup talk.
  if (!api || (state?.state === 'off' && state.reason === 'no-firebase')) return null;

  const online = state?.state === 'online';
  const connecting = state?.state === 'connecting' || busy;

  return (
    <div className="conn-card">
      <div className="conn-card__header">
        <span className="conn-card__icon conn-card__icon--orb">
          <Orb size={32} state={online ? 'listening' : connecting ? 'connecting' : 'breathing'} />
        </span>
        <div className="conn-card__info">
          <div className="conn-card__title-row">
            <span className="conn-card__name">DEX on your phone</span>
            <span className={`conn-card__dot conn-card__dot--${online ? 'connected' : connecting ? 'connecting' : 'disconnected'}`} />
            {!online && <NewBadge scale={0.7} />}
          </div>
          <span className="conn-card__subtitle">
            {online
              ? `Signed in as ${state.email ?? 'your DEX account'}. In DEX for Android, sign in with the same email and password — tasks, live progress and approvals sync.`
              : 'Start tasks from your phone and follow them live. Sign in here with an email and password, then use the same pair in DEX for Android — that’s the whole pairing.'}
          </span>
        </div>
        {online && (
          <div className="conn-card__actions">
            <button type="button" className="conn-card__btn conn-card__btn--secondary" onClick={() => { void api.signOut(); }}>Sign out</button>
          </div>
        )}
      </div>

      {!online && (
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
            <button type="submit" className="conn-card__btn conn-card__btn--primary" disabled={busy || !email.includes('@') || password.length < 6}>
              {busy ? 'Connecting…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
            {mode === 'signin' && (
              <button type="button" className="conn-card__btn conn-card__btn--secondary" onClick={() => { void reset(); }}>Forgot password?</button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
