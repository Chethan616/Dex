/**
 * The stage: an off-screen window that holds every tab that isn't on your
 * screen — background tabs, tabs of tasks you aren't looking at, and all of
 * them while DEX is closed to the tray.
 *
 * A page outside every window has nowhere to draw, so Chromium never paints
 * it: the agent's screenshots of it hang, and the page runs as a hidden tab
 * (no animation frames, no lazy loading). On the stage it has a surface.
 * Idle tabs sit there hidden and cost nothing (≈1 frame/s); a tab the agent
 * is using is shown — on the stage, where nobody sees it — so it behaves
 * like the tab in front, and screenshots work as usual.
 * (Measured in docs/unify/P1-background-tabs.md.)
 *
 * It's a BaseWindow, so it has no page of its own and isn't one of
 * `BrowserWindow.getAllWindows()` — nothing that looks for DEX's windows
 * finds it. It never takes focus and isn't in the taskbar or Alt+Tab.
 *
 * Windows only: macOS keeps windows on screen, so there it stays off (null)
 * and tabs park the old way.
 */
import { BaseWindow, type View } from 'electron';
import { browserLogger } from '../logger';

export interface StageHost {
  contentView: { addChildView(view: View): void; removeChildView(view: View): void };
  isDestroyed(): boolean;
  getContentSize(): number[];
  setContentSize(width: number, height: number): void;
}

// Far past any real monitor layout; Windows clamps it to about -26000.
const OFF_SCREEN = -32000;

let stage: BaseWindow | null = null;

export function stageEnabled(): boolean {
  return process.platform === 'win32' && typeof BaseWindow === 'function' && process.env.DEX_STAGE !== '0';
}

/** The stage, made on first use. null where there isn't one. */
export function getStage(): StageHost | null {
  if (stage && !stage.isDestroyed()) return stage;
  if (!stageEnabled()) return null;
  try {
    stage = new BaseWindow({
      show: false,
      x: OFF_SCREEN,
      y: OFF_SCREEN,
      width: 1280,
      height: 800,
      frame: false,
      focusable: false,
      skipTaskbar: true,
      // WS_EX_TOOLWINDOW: not in Alt+Tab or Task View.
      type: 'toolbar',
      title: 'DEX stage',
    });
    // Shown, but where no one can see it — that's what gives its tabs a surface.
    stage.showInactive();
    stage.on('closed', () => { stage = null; });
    browserLogger.info('stage.created', { bounds: stage.getBounds() });
    return stage;
  } catch (err) {
    browserLogger.warn('stage.create.failed', { error: (err as Error).message });
    stage = null;
    return null;
  }
}

/** Big enough for a tab of `width`×`height` (tabs keep the pane's size). */
export function fitStage(host: StageHost, width: number, height: number): void {
  try {
    const [w, h] = host.getContentSize();
    if (width > w || height > h) host.setContentSize(Math.max(w, width), Math.max(h, height));
  } catch { /* destroyed */ }
}

export function destroyStage(): void {
  if (stage && !stage.isDestroyed()) {
    try { stage.destroy(); } catch { /* gone */ }
  }
  stage = null;
}

/**
 * Wait until a just-shown page has drawn a frame, so a screenshot taken next
 * shows it as it is now. Bounded: a page that can't draw doesn't stall the agent.
 */
export async function waitForFrame(wc: {
  isDestroyed(): boolean;
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: Array<{ code: string }>, userGesture?: boolean): Promise<unknown>;
}): Promise<void> {
  if (wc.isDestroyed()) return;
  try {
    await wc.executeJavaScriptInIsolatedWorld(1_000_418, [{
      code: 'new Promise((r) => { const t = setTimeout(r, 200); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); r(1); })); })',
    }], false);
  } catch { /* navigating */ }
}
