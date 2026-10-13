/**
 * chrome.contextMenus: what extensions add to a page's right-click menu
 * (and to their toolbar button's), following Chrome's rules:
 * - "page" applies only when nothing more specific (a link, an image, a
 *   selection, a text field) was clicked;
 * - an extension with more than one item gets its own submenu, under its
 *   name; with one item, the item sits in the menu directly;
 * - `%s` in a title is the selected text;
 * - checkboxes and radio groups keep their state.
 */
import { ApiError, type CallContext, type Handler } from './types';
import { matchesAny } from './matchPattern';

type ItemType = 'normal' | 'checkbox' | 'radio' | 'separator';

export interface MenuItemState {
  extensionId: string;
  id: string;
  parentId?: string;
  title: string;
  type: ItemType;
  contexts: string[];
  checked: boolean;
  enabled: boolean;
  visible: boolean;
  documentUrlPatterns?: string[];
  targetUrlPatterns?: string[];
  order: number;
}

/** What was right-clicked, from Electron's context-menu params. */
export interface MenuTarget {
  pageUrl: string;
  frameUrl?: string;
  frameId: number;
  linkUrl?: string;
  srcUrl?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'none' | string;
  selectionText?: string;
  editable: boolean;
}

/** One entry to draw: a separator, an item, or a submenu. */
export interface MenuEntry {
  extensionId: string;
  id: string | null;
  label: string;
  type: ItemType | 'submenu';
  checked: boolean;
  enabled: boolean;
  children: MenuEntry[];
}

const CONTEXTS = new Set(['all', 'page', 'frame', 'selection', 'link', 'editable', 'image', 'video', 'audio', 'launcher', 'browser_action', 'page_action', 'action']);
const TYPES = new Set<ItemType>(['normal', 'checkbox', 'radio', 'separator']);

/** The contexts a right-click falls in, by Chrome's rules. */
export function contextsOf(t: MenuTarget): Set<string> {
  const out = new Set<string>(['all']);
  if (t.selectionText) out.add('selection');
  if (t.linkUrl) out.add('link');
  if (t.editable) out.add('editable');
  if (t.mediaType === 'image' && t.srcUrl) out.add('image');
  if (t.mediaType === 'video') out.add('video');
  if (t.mediaType === 'audio') out.add('audio');
  if (t.frameUrl && t.frameId !== 0) out.add('frame');
  if (!['selection', 'link', 'editable', 'image', 'video', 'audio'].some((c) => out.has(c))) out.add('page');
  return out;
}

export function menuTitle(title: string, selection?: string): string {
  const sel = (selection ?? '').replace(/\s+/g, ' ').trim();
  const short = sel.length > 32 ? `${sel.slice(0, 31)}…` : sel;
  return title.replace(/%s/g, short);
}

export class MenuStore {
  private items = new Map<string, Map<string, MenuItemState>>();
  private order = 0;

  private of(extensionId: string): Map<string, MenuItemState> {
    let m = this.items.get(extensionId);
    if (!m) { m = new Map(); this.items.set(extensionId, m); }
    return m;
  }

  forgetExtension(extensionId: string): void {
    this.items.delete(extensionId);
  }

  get(extensionId: string, id: string): MenuItemState | undefined {
    return this.items.get(extensionId)?.get(id);
  }

  private parse(props: Record<string, unknown>, base?: MenuItemState): Partial<MenuItemState> {
    const out: Partial<MenuItemState> = {};
    if (props.title !== undefined) {
      if (typeof props.title !== 'string') throw new ApiError('Menu item title must be a string');
      out.title = props.title.slice(0, 300);
    }
    if (props.type !== undefined) {
      if (!TYPES.has(props.type as ItemType)) throw new ApiError(`Invalid menu item type: ${String(props.type)}`);
      out.type = props.type as ItemType;
    }
    if (props.contexts !== undefined) {
      const list = Array.isArray(props.contexts) ? props.contexts : [props.contexts];
      if (!list.every((c) => typeof c === 'string' && CONTEXTS.has(c))) throw new ApiError('Invalid menu item contexts');
      out.contexts = list as string[];
    }
    for (const key of ['checked', 'enabled', 'visible'] as const) {
      if (props[key] !== undefined) out[key] = Boolean(props[key]);
    }
    for (const key of ['documentUrlPatterns', 'targetUrlPatterns'] as const) {
      if (props[key] !== undefined) {
        const v = props[key];
        if (!Array.isArray(v) || !v.every((p) => typeof p === 'string')) throw new ApiError(`${key} must be a list of match patterns`);
        out[key] = v as string[];
      }
    }
    if (props.parentId !== undefined && props.parentId !== null) out.parentId = String(props.parentId);
    void base;
    return out;
  }

  create(extensionId: string, props: Record<string, unknown>): void {
    const id = String(props.id ?? '');
    if (!id) throw new ApiError('A menu item needs an id');
    const items = this.of(extensionId);
    if (items.has(id) && !props.generatedId) throw new ApiError(`Cannot create item with duplicate id ${id}`);
    const parsed = this.parse(props);
    if (parsed.parentId && !items.has(parsed.parentId)) throw new ApiError(`Cannot find menu item with id ${parsed.parentId}`);
    const type = parsed.type ?? 'normal';
    if (type !== 'separator' && !parsed.title) throw new ApiError('Menu items need a title');
    items.set(id, {
      extensionId, id, parentId: parsed.parentId, title: parsed.title ?? '', type,
      contexts: parsed.contexts ?? ['page'], checked: parsed.checked ?? false,
      enabled: parsed.enabled ?? true, visible: parsed.visible ?? true,
      documentUrlPatterns: parsed.documentUrlPatterns, targetUrlPatterns: parsed.targetUrlPatterns,
      order: this.order++,
    });
    if (items.size > 1000) { items.delete(id); throw new ApiError('Too many menu items'); }
  }

  update(extensionId: string, id: string, props: Record<string, unknown>): void {
    const item = this.of(extensionId).get(id);
    if (!item) throw new ApiError(`Cannot find menu item with id ${id}`);
    const parsed = this.parse(props, item);
    if (parsed.parentId === id) throw new ApiError("A menu item can't be its own parent");
    if (parsed.parentId && !this.of(extensionId).has(parsed.parentId)) throw new ApiError(`Cannot find menu item with id ${parsed.parentId}`);
    Object.assign(item, parsed);
  }

  remove(extensionId: string, id: string): void {
    const items = this.of(extensionId);
    if (!items.has(id)) throw new ApiError(`Cannot find menu item with id ${id}`);
    const doomed = [id];
    for (let i = 0; i < doomed.length; i++) {
      for (const item of items.values()) if (item.parentId === doomed[i]) doomed.push(item.id);
    }
    for (const d of doomed) items.delete(d);
  }

  removeAll(extensionId: string): void {
    this.items.delete(extensionId);
  }

  /** A click: flip checkboxes and radios; what onClicked reports. */
  clicked(extensionId: string, id: string): { wasChecked?: boolean; checked?: boolean } {
    const item = this.of(extensionId).get(id);
    if (!item) return {};
    if (item.type === 'checkbox') {
      const was = item.checked;
      item.checked = !was;
      return { wasChecked: was, checked: item.checked };
    }
    if (item.type === 'radio') {
      const was = item.checked;
      for (const other of this.of(extensionId).values()) {
        if (other.type === 'radio' && other.parentId === item.parentId) other.checked = false;
      }
      item.checked = true;
      return { wasChecked: was, checked: true };
    }
    return {};
  }

  /**
   * The entries extensions add for this right-click, one group per
   * extension. `contexts` picks between a page's menu and an action's.
   */
  entriesFor(target: MenuTarget | null, names: (extensionId: string) => string, onlyExtension?: string): MenuEntry[] {
    const contexts = target ? contextsOf(target) : new Set(['all', 'action', 'browser_action', 'page_action']);
    const groups: MenuEntry[] = [];
    for (const [extensionId, items] of this.items) {
      if (onlyExtension && extensionId !== onlyExtension) continue;
      const shows = (item: MenuItemState): boolean => {
        if (!item.visible) return false;
        if (!item.contexts.some((c) => contexts.has(c))) return false;
        if (target && item.documentUrlPatterns && !matchesAny(item.documentUrlPatterns, target.frameUrl || target.pageUrl)) return false;
        const targetUrl = target?.linkUrl || target?.srcUrl;
        if (target && item.targetUrlPatterns && (!targetUrl || !matchesAny(item.targetUrlPatterns, targetUrl))) return false;
        return true;
      };
      const build = (parentId: string | undefined): MenuEntry[] => [...items.values()]
        .filter((i) => i.parentId === parentId && shows(i))
        .sort((a, b) => a.order - b.order)
        .map((i) => {
          const children = build(i.id);
          return {
            extensionId, id: i.id, label: menuTitle(i.title, target?.selectionText),
            type: children.length ? 'submenu' as const : i.type,
            checked: i.checked, enabled: i.enabled, children,
          };
        });
      const top = build(undefined);
      if (top.length === 0) continue;
      if (top.length === 1 || !target) groups.push(...top);
      else groups.push({ extensionId, id: null, label: names(extensionId), type: 'submenu', checked: false, enabled: true, children: top });
    }
    return groups;
  }

  handlers(): Record<string, Handler> {
    const props = (v: unknown) => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return {
      'contextMenus.create': (ctx: CallContext, [p]) => this.create(ctx.extensionId, props(p)),
      'contextMenus.update': (ctx, [id, p]) => this.update(ctx.extensionId, String(id), props(p)),
      'contextMenus.remove': (ctx, [id]) => this.remove(ctx.extensionId, String(id)),
      'contextMenus.removeAll': (ctx) => this.removeAll(ctx.extensionId),
      'contextMenus.refresh': () => undefined,
    };
  }
}
