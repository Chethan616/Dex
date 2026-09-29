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
  huggingface: {
    name: 'Hugging Face',
    tagline: 'AI 3D models from a sentence or a photo, made on Hugging Face’s GPUs with your account’s free daily time.',
    services: ['FLUX', 'Hunyuan3D', 'TRELLIS', '3D for Blender'],
    action: 'Continue with Hugging Face',
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

/** Hugging Face's own logo (huggingface.co/front/assets/huggingface_logo-noborder.svg). */
function HuggingFaceMark(): React.ReactElement {
  return (
    <svg viewBox="0 0 95 88" width="22" height="22" fill="none" aria-hidden="true">
      <path fill="#FFD21E" d="M47.21 76.5a34.75 34.75 0 1 0 0-69.5 34.75 34.75 0 0 0 0 69.5Z" />
      <path fill="#FF9D0B" d="M81.96 41.75a34.75 34.75 0 1 0-69.5 0 34.75 34.75 0 0 0 69.5 0Zm-73.5 0a38.75 38.75 0 1 1 77.5 0 38.75 38.75 0 0 1-77.5 0Z" />
      <path fill="#3A3B45" d="M58.5 32.3c1.28.44 1.78 3.06 3.07 2.38a5 5 0 1 0-6.76-2.07c.61 1.15 2.55-.72 3.7-.32ZM34.95 32.3c-1.28.44-1.79 3.06-3.07 2.38a5 5 0 1 1 6.76-2.07c-.61 1.15-2.56-.72-3.7-.32Z" />
      <path fill="#FF323D" d="M46.96 56.29c9.83 0 13-8.76 13-13.26 0-2.34-1.57-1.6-4.09-.36-2.33 1.15-5.46 2.74-8.9 2.74-7.19 0-13-6.88-13-2.38s3.16 13.26 13 13.26Z" />
      <path fill="#3A3B45" fillRule="evenodd" clipRule="evenodd" d="M39.43 54a8.7 8.7 0 0 1 5.3-4.49c.4-.12.81.57 1.24 1.28.4.68.82 1.37 1.24 1.37.45 0 .9-.68 1.33-1.35.45-.7.89-1.38 1.32-1.25a8.61 8.61 0 0 1 5 4.17c3.73-2.94 5.1-7.74 5.1-10.7 0-2.34-1.57-1.6-4.09-.36l-.14.07c-2.31 1.15-5.39 2.67-8.77 2.67s-6.45-1.52-8.77-2.67c-2.6-1.29-4.23-2.1-4.23.29 0 3.05 1.46 8.06 5.47 10.97Z" />
      <path fill="#FF9D0B" d="M70.71 37a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5ZM24.21 37a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5ZM17.52 48c-1.62 0-3.06.66-4.07 1.87a5.97 5.97 0 0 0-1.33 3.76 7.1 7.1 0 0 0-1.94-.3c-1.55 0-2.95.59-3.94 1.66a5.8 5.8 0 0 0-.8 7 5.3 5.3 0 0 0-1.79 2.82c-.24.9-.48 2.8.8 4.74a5.22 5.22 0 0 0-.37 5.02c1.02 2.32 3.57 4.14 8.52 6.1 3.07 1.22 5.89 2 5.91 2.01a44.33 44.33 0 0 0 10.93 1.6c5.86 0 10.05-1.8 12.46-5.34 3.88-5.69 3.33-10.9-1.7-15.92-2.77-2.78-4.62-6.87-5-7.77-.78-2.66-2.84-5.62-6.25-5.62a5.7 5.7 0 0 0-4.6 2.46c-1-1.26-1.98-2.25-2.86-2.82A7.4 7.4 0 0 0 17.52 48Zm0 4c.51 0 1.14.22 1.82.65 2.14 1.36 6.25 8.43 7.76 11.18.5.92 1.37 1.31 2.14 1.31 1.55 0 2.75-1.53.15-3.48-3.92-2.93-2.55-7.72-.68-8.01.08-.02.17-.02.24-.02 1.7 0 2.45 2.93 2.45 2.93s2.2 5.52 5.98 9.3c3.77 3.77 3.97 6.8 1.22 10.83-1.88 2.75-5.47 3.58-9.16 3.58-3.81 0-7.73-.9-9.92-1.46-.11-.03-13.45-3.8-11.76-7 .28-.54.75-.76 1.34-.76 2.38 0 6.7 3.54 8.57 3.54.41 0 .7-.17.83-.6.79-2.85-12.06-4.05-10.98-8.17.2-.73.71-1.02 1.44-1.02 3.14 0 10.2 5.53 11.68 5.53.11 0 .2-.03.24-.1.74-1.2.33-2.04-4.9-5.2-5.21-3.16-8.88-5.06-6.8-7.33.24-.26.58-.38 1-.38 3.17 0 10.66 6.82 10.66 6.82s2.02 2.1 3.25 2.1c.28 0 .52-.1.68-.38.86-1.46-8.06-8.22-8.56-11.01-.34-1.9.24-2.85 1.31-2.85Z" />
      <path fill="#FFD21E" d="M38.6 76.69c2.75-4.04 2.55-7.07-1.22-10.84-3.78-3.77-5.98-9.3-5.98-9.3s-.82-3.2-2.69-2.9c-1.87.3-3.24 5.08.68 8.01 3.91 2.93-.78 4.92-2.29 2.17-1.5-2.75-5.62-9.82-7.76-11.18-2.13-1.35-3.63-.6-3.13 2.2.5 2.79 9.43 9.55 8.56 11-.87 1.47-3.93-1.71-3.93-1.71s-9.57-8.71-11.66-6.44c-2.08 2.27 1.59 4.17 6.8 7.33 5.23 3.16 5.64 4 4.9 5.2-.75 1.2-12.28-8.53-13.36-4.4-1.08 4.11 11.77 5.3 10.98 8.15-.8 2.85-9.06-5.38-10.74-2.18-1.7 3.21 11.65 6.98 11.76 7.01 4.3 1.12 15.25 3.49 19.08-2.12Z" />
      <path fill="#FF9D0B" d="M77.4 48c1.62 0 3.07.66 4.07 1.87a5.97 5.97 0 0 1 1.33 3.76 7.1 7.1 0 0 1 1.95-.3c1.55 0 2.95.59 3.94 1.66a5.8 5.8 0 0 1 .8 7 5.3 5.3 0 0 1 1.78 2.82c.24.9.48 2.8-.8 4.74a5.22 5.22 0 0 1 .37 5.02c-1.02 2.32-3.57 4.14-8.51 6.1-3.08 1.22-5.9 2-5.92 2.01a44.33 44.33 0 0 1-10.93 1.6c-5.86 0-10.05-1.8-12.46-5.34-3.88-5.69-3.33-10.9 1.7-15.92 2.78-2.78 4.63-6.87 5.01-7.77.78-2.66 2.83-5.62 6.24-5.62a5.7 5.7 0 0 1 4.6 2.46c1-1.26 1.98-2.25 2.87-2.82A7.4 7.4 0 0 1 77.4 48Zm0 4c-.51 0-1.13.22-1.82.65-2.13 1.36-6.25 8.43-7.76 11.18a2.43 2.43 0 0 1-2.14 1.31c-1.54 0-2.75-1.53-.14-3.48 3.91-2.93 2.54-7.72.67-8.01a1.54 1.54 0 0 0-.24-.02c-1.7 0-2.45 2.93-2.45 2.93s-2.2 5.52-5.97 9.3c-3.78 3.77-3.98 6.8-1.22 10.83 1.87 2.75 5.47 3.58 9.15 3.58 3.82 0 7.73-.9 9.93-1.46.1-.03 13.45-3.8 11.76-7-.29-.54-.75-.76-1.34-.76-2.38 0-6.71 3.54-8.57 3.54-.42 0-.71-.17-.83-.6-.8-2.85 12.05-4.05 10.97-8.17-.19-.73-.7-1.02-1.44-1.02-3.14 0-10.2 5.53-11.68 5.53-.1 0-.19-.03-.23-.1-.74-1.2-.34-2.04 4.88-5.2 5.23-3.16 8.9-5.06 6.8-7.33-.23-.26-.57-.38-.98-.38-3.18 0-10.67 6.82-10.67 6.82s-2.02 2.1-3.24 2.1a.74.74 0 0 1-.68-.38c-.87-1.46 8.05-8.22 8.55-11.01.34-1.9-.24-2.85-1.31-2.85Z" />
      <path fill="#FFD21E" d="M56.33 76.69c-2.75-4.04-2.56-7.07 1.22-10.84 3.77-3.77 5.97-9.3 5.97-9.3s.82-3.2 2.7-2.9c1.86.3 3.23 5.08-.68 8.01-3.92 2.93.78 4.92 2.28 2.17 1.51-2.75 5.63-9.82 7.76-11.18 2.13-1.35 3.64-.6 3.13 2.2-.5 2.79-9.42 9.55-8.55 11 .86 1.47 3.92-1.71 3.92-1.71s9.58-8.71 11.66-6.44c2.08 2.27-1.58 4.17-6.8 7.33-5.23 3.16-5.63 4-4.9 5.2.75 1.2 12.28-8.53 13.36-4.4 1.08 4.11-11.76 5.3-10.97 8.15.8 2.85 9.05-5.38 10.74-2.18 1.69 3.21-11.65 6.98-11.76 7.01-4.31 1.12-15.26 3.49-19.08-2.12Z" />
    </svg>
  );
}

const MARK: Record<Provider, () => React.ReactElement> = { google: GoogleMark, github: GitHubMark, slack: SlackMark, huggingface: HuggingFaceMark };

function refillText(at: number): string {
  const mins = Math.max(1, Math.round((at - Date.now()) / 60_000));
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
}

/**
 * What Hugging Face is for, in plain words: the steps of a 3D model, why
 * they run on Hugging Face's GPUs, the daily limit — free vs PRO, with the
 * user's own plan and today's use — and what leaves the PC.
 */
function HuggingFaceGuide({ info }: { info: AccountInfo }): React.ReactElement {
  const hf = info.huggingface;
  const plan = hf?.plan ?? null;
  const [open, setOpen] = useState(false);
  const openLink = (key: 'huggingface-pro' | 'huggingface-zerogpu') => { void window.electronAPI?.settings?.accounts?.openLink(key); };
  const yours = <span className="hf-plan__badge">Your plan</span>;
  // Closed, the toggle still says the one thing worth a glance: the plan,
  // or that today's GPU time is gone.
  const pill = !info.connected || !hf ? null
    : hf.refillsAt ? { text: `Used up · refills in ${refillText(hf.refillsAt)}`, tone: 'out' }
    : plan ? { text: plan === 'pro' ? 'PRO' : 'Free plan', tone: plan }
    : null;
  return (
    <div className={`hf-guide${open ? ' hf-guide--open' : ''}`}>
      <button type="button" className="hf-guide__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="hf-guide__toggle-text">How it works &amp; daily limit</span>
        {pill && <span className={`hf-guide__pill hf-guide__pill--${pill.tone}`}>{pill.text}</span>}
        <svg className="hf-guide__chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="hf-guide__collapse">
        <div className="hf-guide__body" inert={!open}>
          <section className="hf-guide__section">
            <h4 className="hf-guide__label">How DEX makes a 3D model</h4>
            <ol className="hf-steps">
              <li><strong>You describe it</strong> — or give a photo of the object.</li>
              <li><strong>FLUX</strong> draws a clean picture of it <span className="hf-steps__time">~10 s</span></li>
              <li><strong>Hunyuan3D</strong> turns the picture into a textured 3D model <span className="hf-steps__time">2–3 min</span></li>
              <li><strong>Blender</strong>, here on your PC, places, lights and renders it — it lands in your task and on your phone.</li>
            </ol>
            <p className="hf-guide__note">
              Steps 2 and 3 need large NVIDIA GPUs, so they run on Hugging Face’s servers (ZeroGPU), on your own account — no card, no API key.
            </p>
          </section>

          <section className="hf-guide__section">
            <h4 className="hf-guide__label">Daily limit</h4>
            <div className="hf-plans">
              <div className={`hf-plan${plan === 'free' ? ' hf-plan--yours' : ''}`}>
                <span className="hf-plan__name">Free {plan === 'free' && yours}</span>
                <span className="hf-plan__amount">A few GPU minutes a day</span>
                <span className="hf-plan__detail">About 1–2 models, refilled every 24 hours</span>
              </div>
              <div className={`hf-plan hf-plan--pro${plan === 'pro' ? ' hf-plan--yours' : ''}`}>
                <span className="hf-plan__name">PRO · $9/month {plan === 'pro' && yours}</span>
                <span className="hf-plan__amount">About 8× the GPU time</span>
                <span className="hf-plan__detail">Around 25 minutes a day — roughly 8–10 models — and first in the queue</span>
              </div>
            </div>
            {info.connected && hf && (
              hf.refillsAt ? (
                <p className="hf-guide__status hf-guide__status--out" role="status">
                  Today’s GPU time is used up — it refills in {refillText(hf.refillsAt)}. Until then DEX builds models in Blender.
                </p>
              ) : (
                <p className="hf-guide__status" role="status">
                  {hf.modelsToday === 0 ? 'No AI models made today yet.' : `${hf.modelsToday} AI model${hf.modelsToday === 1 ? '' : 's'} made today.`}
                </p>
              )
            )}
            <p className="hf-guide__note">
              When the day’s time runs out, DEX builds the model in Blender with code instead — you still get one.
              {plan === 'pro' ? ' Your PRO time is used automatically.' : ' Subscribed to PRO? Nothing to set up: the same sign-in simply goes further.'}
            </p>
            <div className="hf-guide__actions">
              {plan !== 'pro' && (
                <button type="button" className="account-btn account-btn--ghost" onClick={() => openLink('huggingface-pro')}>Get more with PRO</button>
              )}
              <button type="button" className="account-btn account-btn--ghost" onClick={() => openLink('huggingface-zerogpu')}>About ZeroGPU</button>
            </div>
          </section>

          <p className="hf-guide__privacy">
            Your description or photo is sent to Hugging Face for steps 2–3; everything else, Blender included, stays on this PC.
            The limits are Hugging Face’s and can change.
          </p>
        </div>
      </div>
    </div>
  );
}

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

      {info.provider === 'huggingface' && <HuggingFaceGuide info={info} />}

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
