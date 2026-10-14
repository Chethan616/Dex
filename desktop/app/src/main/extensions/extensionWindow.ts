/**
 * A window for an extension's options page or a Chrome Web Store page opened
 * from Settings › Extensions, where no task is in front (a task's toolbar
 * opens them as that task's tabs instead).
 *
 * It runs on the web profile (`persist:dex-web`), so the extension works in
 * it and the store's "Add to DEX" button does too. It isn't a task's tab, so
 * DEX's agent never reaches it.
 */
import { BrowserWindow, type Session } from 'electron';

let win: BrowserWindow | null = null;

/** Only what Settings opens: store pages and extensions' own pages. */
export function allowedInExtensionWindow(url: string): boolean {
  return /^https:\/\/chromewebstore\.google\.com\//.test(url) || /^chrome-extension:\/\/[a-p]{32}\//.test(url);
}

export function openExtensionWindow(url: string, ses: Session, opts: { backgroundColor?: string } = {}): boolean {
  if (!allowedInExtensionWindow(url)) return false;
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 560,
      minHeight: 420,
      show: false,
      autoHideMenuBar: true,
      title: 'Chrome extensions — DEX',
      backgroundColor: opts.backgroundColor,
      webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setMenuBarVisibility(false);
    win.on('closed', () => { win = null; });
    // Links that would open a new window stay in this one.
    win.webContents.setWindowOpenHandler(({ url: next }) => {
      if (/^https?:\/\//.test(next) || allowedInExtensionWindow(next)) void win?.loadURL(next);
      return { action: 'deny' };
    });
    const shown = win;
    shown.once('ready-to-show', () => { if (!shown.isDestroyed()) { shown.show(); shown.focus(); } });
  } else {
    win.show();
    win.focus();
  }
  void win.loadURL(url).catch(() => { /* a failed load shows Chromium's error page */ });
  return true;
}
