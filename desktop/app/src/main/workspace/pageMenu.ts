/**
 * The workspace's ⋯ menu for the page in front (docs/unify/PLAN.md §3.2 #5).
 *
 * A native menu, not hub DOM: the live page is a native view drawn above
 * all of the hub's DOM, and a native menu draws above both, so the page
 * doesn't have to move out of the way while it's open.
 */
import type { MenuItemConstructorOptions } from 'electron';

export interface PageMenuInfo {
  url: string;
  /** Percent. */
  zoom: number;
}

export interface PageMenuActions {
  find(): void;
  zoom(step: 'in' | 'out' | 'reset'): void;
  print(): void;
  copyLink(): void;
  openExternally(): void;
  clearSiteData(): void;
  devTools(): void;
}

function webOrigin(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

export function pageMenuTemplate(info: PageMenuInfo, act: PageMenuActions): MenuItemConstructorOptions[] {
  const web = webOrigin(info.url);
  const loaded = !!info.url && info.url !== 'about:blank';
  return [
    { id: 'find', label: 'Find in page…', accelerator: 'CmdOrCtrl+F', enabled: loaded, click: () => act.find() },
    { type: 'separator' },
    { id: 'zoom-in', label: 'Zoom in', accelerator: 'CmdOrCtrl+=', click: () => act.zoom('in') },
    { id: 'zoom-out', label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: () => act.zoom('out') },
    {
      id: 'zoom-reset',
      label: info.zoom === 100 ? 'Actual size' : `Actual size (now ${info.zoom}%)`,
      accelerator: 'CmdOrCtrl+0',
      enabled: info.zoom !== 100,
      click: () => act.zoom('reset'),
    },
    { type: 'separator' },
    { id: 'print', label: 'Print…', enabled: loaded, click: () => act.print() },
    { id: 'copy-link', label: 'Copy link', enabled: !!web, click: () => act.copyLink() },
    { id: 'open-external', label: 'Open in your browser', enabled: !!web, click: () => act.openExternally() },
    { type: 'separator' },
    {
      id: 'clear-site-data',
      label: web ? `Clear data for ${web.host}…` : 'Clear site data…',
      enabled: !!web,
      click: () => act.clearSiteData(),
    },
    { id: 'devtools', label: 'Developer tools', enabled: loaded, click: () => act.devTools() },
  ];
}
