/**
 * Onboarding → "Connect your accounts": the one-click sign-ins from
 * Settings → Accounts, offered once up front. All optional — each makes DEX
 * work through the service's own API instead of clicking through its website.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Orb } from '../components/lib';
import { ProviderMark } from '../hub/ProviderMark';
import { ArrowRight, StepFooter } from './StepFooter';

type Provider = 'google' | 'github' | 'slack' | 'huggingface';

interface AccountInfo {
  provider: Provider;
  available: boolean;
  connected: boolean;
  profile?: { identity: string; name?: string };
}

type Flow = { phase: 'idle' } | { phase: 'browser' } | { phase: 'code'; userCode: string } | { phase: 'error'; error: string };

const OFFER: Array<{ provider: Provider; name: string; line: string }> = [
  { provider: 'google', name: 'Google', line: 'Gmail, Calendar, Meet, Drive, Docs and Sheets — “check my mail”, “send the PDF from my Drive”.' },
  { provider: 'github', name: 'GitHub', line: 'Issues, pull requests and code across your repositories.' },
  { provider: 'huggingface', name: 'Hugging Face', line: 'Free AI 3D models from a sentence or a photo.' },
];

export function ConnectStep({ onContinue, onBack }: { onContinue: () => void; onBack: () => void }): React.ReactElement {
  const api = window.onboardingAPI.accounts;
  const [accounts, setAccounts] = useState<AccountInfo[] | null>(null);
  const [flows, setFlows] = useState<Partial<Record<Provider, Flow>>>({});

  const reload = useCallback(() => {
    void api.list().then((list) => setAccounts(list as AccountInfo[])).catch(() => setAccounts([]));
  }, [api]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => api.onProgress((raw) => {
    const e = raw as { provider: Provider; phase: string; userCode?: string; error?: string };
    setFlows((prev) => ({
      ...prev,
      [e.provider]: e.phase === 'done' ? { phase: 'idle' }
        : e.phase === 'error' ? { phase: 'error', error: e.error ?? 'Sign-in failed.' }
        : e.phase === 'code' ? { phase: 'code', userCode: e.userCode ?? '' }
        : { phase: 'browser' },
    }));
    if (e.phase === 'done') reload();
  }), [api, reload]);

  const connect = (provider: Provider) => {
    setFlows((prev) => ({ ...prev, [provider]: { phase: 'browser' } }));
    void api.connect(provider).then(reload);
  };

  const byId = new Map((accounts ?? []).map((a) => [a.provider, a]));
  // An installed DEX only offers what this build can sign in to.
  const offers = OFFER.filter((o) => byId.get(o.provider)?.available || byId.get(o.provider)?.connected);
  const anyConnected = offers.some((o) => byId.get(o.provider)?.connected);

  return (
    <div className="step-panel connect-step">
      <h1 className="step-title">Connect your accounts</h1>
      <p className="step-subtitle">
        Optional. With an account connected, DEX works through the service itself — faster and more reliable than clicking through its website.
        Sign-in happens in your browser; you can change this any time in Settings.
      </p>

      {!accounts ? (
        <div className="setup-loading"><Orb size={32} state="searching" /></div>
      ) : (
        <div className="connect-list">
          {offers.map((o) => {
            const info = byId.get(o.provider);
            const flow = flows[o.provider] ?? { phase: 'idle' };
            return (
              <div key={o.provider} className={`connect-row${info?.connected ? ' connect-row--done' : ''}`}>
                <span className="connect-row__mark"><ProviderMark provider={o.provider} /></span>
                <div className="connect-row__text">
                  <span className="connect-row__name">{o.name}</span>
                  <span className="connect-row__line">
                    {info?.connected ? `Connected as ${info.profile?.name ?? info.profile?.identity ?? 'you'}`
                      : flow.phase === 'browser' ? 'Finish signing in in your browser, then come back.'
                      : flow.phase === 'code' ? `Enter ${flow.userCode} on the GitHub page — it’s already copied.`
                      : flow.phase === 'error' ? flow.error
                      : o.line}
                  </span>
                </div>
                {info?.connected ? (
                  <span className="connect-row__ok">Connected</span>
                ) : flow.phase === 'browser' || flow.phase === 'code' ? (
                  <button type="button" className="connect-row__btn connect-row__btn--ghost" onClick={() => { void api.cancel(o.provider); setFlows((p) => ({ ...p, [o.provider]: { phase: 'idle' } })); }}>Cancel</button>
                ) : (
                  <button type="button" className="connect-row__btn" onClick={() => connect(o.provider)}>Connect</button>
                )}
              </div>
            );
          })}
          <div className="connect-row connect-row--hint">
            <span className="connect-row__mark connect-row__mark--phone" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" stroke="currentColor" strokeWidth="1.6" fill="none" /><path d="M10.5 18.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </span>
            <div className="connect-row__text">
              <span className="connect-row__name">DEX on your phone</span>
              <span className="connect-row__line">Start tasks, approve steps and get files from anywhere. Pair it in Settings → Accounts whenever you like.</span>
            </div>
          </div>
        </div>
      )}

      <StepFooter onBack={onBack} hint={anyConnected ? undefined : 'Optional — you can connect these later.'}>
        <button type="button" className="ob-btn ob-btn--primary" onClick={onContinue}>
          Continue
          <ArrowRight />
        </button>
      </StepFooter>
    </div>
  );
}
