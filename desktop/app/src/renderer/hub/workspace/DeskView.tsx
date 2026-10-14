/**
 * The Desk tab (docs/desktop-control/PLAN.md §Phase 3): the Windows app DEX
 * is working in, live, while it stays parked off your screen.
 *
 * Two pictures a second while DEX acts, none when it's idle or when this tab
 * isn't showing (main/desktop/deskLive.ts). A box marks the control DEX is
 * acting on — drawn here, in the mirror, never on the real app. The caption
 * says what it's doing ("Pressing “Shuffle” in Spotify").
 *
 * - Show me: the window comes onto your screen, in front. It's yours then:
 *   DEX leaves it alone until you hand it back.
 * - Hand back: DEX may use it again (and parks it again if DEX opened it).
 * - Pause / Resume / Stop: the task's own.
 *
 * Fluidity: one canvas, drawn only when a picture arrives or the pane
 * resizes; no animation on the picture.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Block } from '../../logs/transcript';
import { appName } from '../../../shared/deskWords';
import { DeskChanges } from '../chat/DeskChanges';
import './desk.css';

type Change = Extract<Block, { kind: 'change' }>;

interface DeskViewProps {
  sessionId: string;
  state: DeskStateInfo | null;
  changes: Change[];
  running: boolean;
  paused: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
}

/** A picture this recent means DEX is working in the window right now. */
const LIVE_MS = 3_000;

function opError(r: DeskOpResult | undefined): string {
  if (r?.error === 'closed') return 'That window is closed.';
  if (r?.error === 'no_window') return 'DEX isn’t working in a window yet.';
  if (r?.error === 'refused' || r?.error === 'unreachable') return 'DEX can’t move that window.';
  return 'That didn’t work. Try again.';
}

export function DeskView({ sessionId, state, changes, running, paused, onPause, onResume, onStop }: DeskViewProps): React.ReactElement {
  const api = window.electronAPI?.desk;
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<{ bitmap: ImageBitmap; meta: DeskFrameInfo } | null>(null);
  const accentRef = useRef<string | null>(null);
  const [frameAt, setFrameAt] = useState<number | null>(null);
  const [frameWindow, setFrameWindow] = useState<DeskFrameInfo['window']>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<'show' | 'back' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = stage.clientWidth;
    const cssH = stage.clientHeight;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const frame = frameRef.current;
    if (!frame) return;
    const { bitmap, meta } = frame;
    // Fit the whole window in, centred; never enlarged past its own pixels × dpr.
    const scale = Math.min(w / bitmap.width, h / bitmap.height, dpr * 1.5);
    const dw = bitmap.width * scale;
    const dh = bitmap.height * scale;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, dx, dy, dw, dh);
    if (meta.focus) {
      const [bx, by, bw, bh] = meta.focus.box;
      // The picture may be scaled from the meta's own size.
      const sx = dw / meta.width;
      const sy = dh / meta.height;
      const pad = 3 * dpr;
      accentRef.current ??= getComputedStyle(stage).getPropertyValue('--color-accent-default').trim() || '#4c8dff';
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = accentRef.current;
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = accentRef.current;
      const rx = dx + bx * sx - pad;
      const ry = dy + by * sy - pad;
      const rw = bw * sx + pad * 2;
      const rh = bh * sy + pad * 2;
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, 6 * dpr);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
  }, []);

  // Pictures while this tab is showing.
  useEffect(() => {
    if (!api) return;
    void api.watch(sessionId, true);
    let gen = 0;
    const off = api.onFrame((id, meta, jpeg) => {
      if (id !== sessionId) return;
      const mine = ++gen;
      createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' })).then((bitmap) => {
        if (mine !== gen) { bitmap.close(); return; }      // a newer one already arrived
        frameRef.current?.bitmap.close();
        frameRef.current = { bitmap, meta };
        setFrameAt(meta.at || Date.now());
        setFrameWindow((prev) => (prev?.hwnd === meta.window?.hwnd && prev?.title === meta.window?.title ? prev : meta.window ?? null));
        requestAnimationFrame(draw);
      }).catch(() => { /* a bad picture: keep the last */ });
    });
    return () => {
      off();
      void api.watch(sessionId, false);
      frameRef.current?.bitmap.close();
      frameRef.current = null;
    };
  }, [api, sessionId, draw]);

  // Redraw on resize (the canvas keeps the pane's real pixels).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(stage);
    return () => ro.disconnect();
  }, [draw]);

  // "Live" fades to "Idle" a few seconds after the last picture.
  const live = Boolean(state?.acting) || (frameAt !== null && now - frameAt < LIVE_MS);
  useEffect(() => {
    if (frameAt === null) return;
    const t = setTimeout(() => setNow(Date.now()), LIVE_MS + 50);
    return () => clearTimeout(t);
  }, [frameAt]);

  const win = state?.window ?? null;
  const taken = Boolean(win && state?.taken.includes(win.hwnd));
  const shownProcess = frameWindow?.process ?? win?.process;
  const shownTitle = frameWindow?.title ?? win?.title ?? '';
  const name = shownProcess ? appName(shownProcess, shownTitle) : null;

  const showMe = async (): Promise<void> => {
    if (!api) return;
    setBusy('show');
    setError(null);
    const r = await api.showMe(sessionId).catch(() => undefined);
    setBusy(null);
    if (!r?.ok) setError(opError(r));
  };
  const handBack = async (): Promise<void> => {
    if (!api) return;
    setBusy('back');
    setError(null);
    const r = await api.handBack(sessionId).catch(() => undefined);
    setBusy(null);
    if (!r?.ok) setError(opError(r));
  };

  return (
    <div className="desk">
      <div className="desk-head">
        <div className="desk-head__text">
          <div className="desk-head__name">
            <span className="desk-head__app">{name ?? 'Windows'}</span>
            {shownTitle && name !== shownTitle && <span className="desk-head__title" title={shownTitle}>{shownTitle}</span>}
            <span className={`desk-chip${taken ? ' desk-chip--yours' : live ? ' desk-chip--live' : ''}`}>
              {taken ? 'Yours' : live ? 'Live' : 'Idle'}
            </span>
          </div>
          <div className="desk-head__caption">
            {taken
              ? `You have ${name ?? 'this window'}. DEX is leaving it alone.`
              : state?.caption ?? 'DEX hasn’t done anything here yet.'}
          </div>
        </div>
        <div className="desk-actions">
          {win && !taken && (
            <button type="button" className="desk-btn" disabled={busy !== null} onClick={() => { void showMe(); }} title="Put this window on your screen. DEX leaves it alone until you hand it back.">
              {busy === 'show' ? 'Showing…' : 'Show me'}
            </button>
          )}
          {taken && (
            <button type="button" className="desk-btn desk-btn--primary" disabled={busy !== null} onClick={() => { void handBack(); }} title={win?.openedByDex ? 'DEX may use it again, off your screen.' : 'DEX may use it again.'}>
              {busy === 'back' ? 'Handing back…' : 'Hand back'}
            </button>
          )}
          {running && onPause && <button type="button" className="desk-btn" onClick={onPause}>Pause</button>}
          {paused && onResume && <button type="button" className="desk-btn" onClick={onResume}>Resume</button>}
          {(running || paused) && onStop && <button type="button" className="desk-btn desk-btn--danger" onClick={onStop}>Stop</button>}
        </div>
      </div>
      {error && <div className="desk-error" role="alert">{error}</div>}

      <div className="desk-stage" ref={stageRef}>
        <canvas ref={canvasRef} className="desk-canvas" aria-label={name ? `What DEX sees in ${name}` : 'What DEX sees'} />
        {frameAt === null && (
          <div className="desk-empty">
            {win
              ? <>DEX is working in {appName(win.process, win.title)}, off your screen. A picture shows here while it acts.</>
              : <>When DEX uses a Windows app for this task, you’ll see it here.</>}
          </div>
        )}
      </div>

      {changes.length > 0 && (
        <div className="desk-changes">
          <DeskChanges sessionId={sessionId} changes={changes} heading="Changes to this PC" />
        </div>
      )}
    </div>
  );
}

/** The Desk tab's state, live from main. */
export function useDeskState(sessionId: string): DeskStateInfo | null {
  const [state, setState] = useState<DeskStateInfo | null>(null);
  useEffect(() => {
    const api = window.electronAPI?.desk;
    setState(null);
    if (!api) return;
    let live = true;
    api.state(sessionId).then((s) => { if (live) setState(s); }).catch(() => { /* none yet */ });
    const off = api.onChanged((id, s) => { if (id === sessionId) setState(s); });
    return () => { live = false; off(); };
  }, [sessionId]);
  return state;
}
