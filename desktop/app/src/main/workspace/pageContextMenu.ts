/**
 * The right-click menu in a task's tab, like a browser's. Electron shows
 * nothing on its own, so a right-click in DEX's browser used to do nothing.
 *
 * What it offers depends on what you clicked, as in Chrome: a link, an
 * image, video or audio, selected text, a text field (with spelling
 * suggestions), or the page itself — then whatever extensions add, then
 * Inspect. The actions are passed in, so this stays a plain function.
 */
import type { MenuItemConstructorOptions } from 'electron';
import type { MenuEntry } from '../extensions/menusApi';

export interface ContextParams {
  x: number;
  y: number;
  linkURL: string;
  linkText: string;
  srcURL: string;
  mediaType: string;
  hasImageContents: boolean;
  selectionText: string;
  isEditable: boolean;
  misspelledWord: string;
  dictionarySuggestions: string[];
  editFlags: { canUndo: boolean; canRedo: boolean; canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean; canEditRichly?: boolean };
  pageURL: string;
  frameURL: string;
}

export interface PageMenuActions {
  canGoBack: boolean;
  canGoForward: boolean;
  back(): void;
  forward(): void;
  reload(): void;
  openInNewTab(url: string): void;
  copyText(text: string): void;
  copyImageAt(x: number, y: number): void;
  download(url: string): void;
  search(text: string): void;
  replaceMisspelling(word: string): void;
  addToDictionary(word: string): void;
  editCommand(cmd: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'pasteAndMatchStyle' | 'selectAll'): void;
  print(): void;
  inspect(x: number, y: number): void;
  /** An extension's item was picked. */
  extensionClick(entry: MenuEntry): void;
  extensionIcon(extensionId: string): Electron.NativeImage | undefined;
}

const isWeb = (url: string) => /^(https?|ftp):/i.test(url);

function quote(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 32 ? `${t.slice(0, 31)}…` : t;
}

function extensionItems(entries: MenuEntry[], a: PageMenuActions, top: boolean): MenuItemConstructorOptions[] {
  return entries.map((e): MenuItemConstructorOptions => {
    if (e.type === 'separator') return { type: 'separator' };
    const icon = top ? a.extensionIcon(e.extensionId) : undefined;
    if (e.type === 'submenu') {
      return { label: e.label, enabled: e.enabled, icon, submenu: extensionItems(e.children, a, false) };
    }
    return {
      label: e.label,
      enabled: e.enabled,
      icon,
      type: e.type === 'checkbox' ? 'checkbox' : e.type === 'radio' ? 'radio' : 'normal',
      checked: e.type === 'checkbox' || e.type === 'radio' ? e.checked : undefined,
      click: () => a.extensionClick(e),
    };
  });
}

export function pageContextMenu(p: ContextParams, a: PageMenuActions, extensions: MenuEntry[] = []): MenuItemConstructorOptions[] {
  const groups: MenuItemConstructorOptions[][] = [];
  const selection = p.selectionText.trim();

  if (p.isEditable) {
    const spelling: MenuItemConstructorOptions[] = [];
    if (p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 5)) spelling.push({ label: s, click: () => a.replaceMisspelling(s) });
      if (spelling.length === 0) spelling.push({ label: 'No spelling suggestions', enabled: false });
      spelling.push({ label: 'Add to dictionary', click: () => a.addToDictionary(p.misspelledWord) });
    }
    if (spelling.length) groups.push(spelling);
    groups.push([
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', enabled: p.editFlags.canUndo, click: () => a.editCommand('undo') },
      { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', enabled: p.editFlags.canRedo, click: () => a.editCommand('redo') },
    ]);
    groups.push([
      { label: 'Cut', accelerator: 'CmdOrCtrl+X', enabled: p.editFlags.canCut, click: () => a.editCommand('cut') },
      { label: 'Copy', accelerator: 'CmdOrCtrl+C', enabled: p.editFlags.canCopy, click: () => a.editCommand('copy') },
      { label: 'Paste', accelerator: 'CmdOrCtrl+V', enabled: p.editFlags.canPaste, click: () => a.editCommand('paste') },
      { label: 'Paste as plain text', accelerator: 'CmdOrCtrl+Shift+V', enabled: p.editFlags.canPaste, click: () => a.editCommand('pasteAndMatchStyle') },
      { label: 'Select all', accelerator: 'CmdOrCtrl+A', enabled: p.editFlags.canSelectAll, click: () => a.editCommand('selectAll') },
    ]);
  } else {
    if (p.linkURL) {
      groups.push([
        ...(isWeb(p.linkURL) ? [{ label: 'Open link in new tab', click: () => a.openInNewTab(p.linkURL) }] : []),
        { label: 'Copy link address', click: () => a.copyText(p.linkURL) },
        ...(p.linkText.trim() ? [{ label: 'Copy link text', click: () => a.copyText(p.linkText.trim()) }] : []),
        ...(isWeb(p.linkURL) ? [{ label: 'Save link as…', click: () => a.download(p.linkURL) }] : []),
      ]);
    }
    if (p.mediaType === 'image' && p.srcURL) {
      groups.push([
        ...(isWeb(p.srcURL) ? [{ label: 'Open image in new tab', click: () => a.openInNewTab(p.srcURL) }] : []),
        ...(p.hasImageContents ? [{ label: 'Copy image', click: () => a.copyImageAt(p.x, p.y) }] : []),
        { label: 'Copy image address', click: () => a.copyText(p.srcURL) },
        ...(isWeb(p.srcURL) ? [{ label: 'Save image as…', click: () => a.download(p.srcURL) }] : []),
      ]);
    } else if ((p.mediaType === 'video' || p.mediaType === 'audio') && p.srcURL && isWeb(p.srcURL)) {
      groups.push([
        { label: `Open ${p.mediaType} in new tab`, click: () => a.openInNewTab(p.srcURL) },
        { label: `Copy ${p.mediaType} address`, click: () => a.copyText(p.srcURL) },
        { label: `Save ${p.mediaType} as…`, click: () => a.download(p.srcURL) },
      ]);
    }
    if (selection) {
      groups.push([
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => a.editCommand('copy') },
        { label: `Search Google for “${quote(selection)}”`, click: () => a.search(selection) },
      ]);
    }
    if (!p.linkURL && !selection && p.mediaType !== 'image') {
      groups.push([
        { label: 'Back', enabled: a.canGoBack, click: () => a.back() },
        { label: 'Forward', enabled: a.canGoForward, click: () => a.forward() },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => a.reload() },
      ]);
      groups.push([
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => a.print() },
        ...(isWeb(p.pageURL) ? [{ label: 'Copy page address', click: () => a.copyText(p.pageURL) }] : []),
      ]);
    }
  }

  const ext = extensionItems(extensions, a, true);
  if (ext.length) groups.push(ext);
  groups.push([{ label: 'Inspect', click: () => a.inspect(p.x, p.y) }]);

  const out: MenuItemConstructorOptions[] = [];
  for (const g of groups) {
    if (g.length === 0) continue;
    if (out.length) out.push({ type: 'separator' });
    out.push(...g);
  }
  return out;
}
