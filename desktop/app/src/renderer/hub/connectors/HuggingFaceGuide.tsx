/** The guide on the Marketplace's Hugging Face page. */
import React, { useState } from 'react';

function refillText(at: number): string {
  const mins = Math.max(1, Math.round((at - Date.now()) / 60_000));
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
}

/**
 * What Hugging Face is for, in plain words: the steps of a 3D model, why
 * they run on Hugging Face's GPUs, the daily limit — free vs PRO, with the
 * user's own plan and today's use — and what leaves the PC.
 */
export function HuggingFaceGuide({ info }: { info: AccountInfo }): React.ReactElement {
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
                <button type="button" className="mk__btn mk__btn--quiet" onClick={() => openLink('huggingface-pro')}>Get more with PRO</button>
              )}
              <button type="button" className="mk__btn mk__btn--quiet" onClick={() => openLink('huggingface-zerogpu')}>About ZeroGPU</button>
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
