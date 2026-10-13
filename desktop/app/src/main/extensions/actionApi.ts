/**
 * chrome.action: the extension's toolbar button. Electron keeps an action
 * object but draws nothing, so DEX keeps the state itself — icon, title,
 * badge, popup, enabled — globally and per tab, as Chrome does, and the
 * workspace toolbar draws it (hub/workspace/ExtensionsBar.tsx).
 */
import { ApiError, type CallContext, type Handler } from './types';

export interface ActionState {
  title?: string;
  badgeText?: string;
  badgeBackgroundColor?: string;
  badgeTextColor?: string;
  popup?: string;
  /** A PNG data URL. */
  icon?: string;
  enabled?: boolean;
}

export interface IconTools {
  /** An image from the extension's own files, as a PNG data URL (32 px). */
  fromFile(extensionId: string, relPath: string): string | null;
  /** Raw RGBA pixels from an ImageData, as a PNG data URL. */
  fromPixels(width: number, height: number, rgba: Uint8Array): string | null;
}

/** "#rrggbb" or "rgba(...)" from a CSS colour string or Chrome's [r,g,b,a]. */
export function colorOf(value: unknown): string | null {
  if (typeof value === 'string') return /^[#a-zA-Z0-9(),.\s%-]{1,40}$/.test(value) ? value : null;
  if (Array.isArray(value) && value.length >= 3 && value.every((n) => typeof n === 'number')) {
    const [r, g, b, a = 255] = value as number[];
    const c = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
    return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${(c(a) / 255).toFixed(3)})`;
  }
  return null;
}

/** Pick the image closest to 32 px from a single image or a {size: image} map. */
function bestOf<T>(value: T | Record<string, T> | undefined, isOne: (v: unknown) => v is T): T | null {
  if (value === undefined || value === null) return null;
  if (isOne(value)) return value;
  const map = value as Record<string, T>;
  const sizes = Object.keys(map).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const size = sizes.find((s) => s >= 32) ?? sizes[sizes.length - 1];
  return size === undefined ? null : map[String(size)] ?? null;
}

interface Pixels { __imageData: true; width: number; height: number; data: Uint8Array }
const isPixels = (v: unknown): v is Pixels => Boolean(v && typeof v === 'object' && (v as Pixels).__imageData === true);
const isPath = (v: unknown): v is string => typeof v === 'string';

export class ActionStore {
  private global = new Map<string, ActionState>();
  private perTab = new Map<string, Map<number, ActionState>>();
  private listeners = new Set<(extensionId: string) => void>();

  constructor(private readonly icons: IconTools, private readonly defaults: (extensionId: string) => ActionState) {}

  onChanged(listener: (extensionId: string) => void): void {
    this.listeners.add(listener);
  }

  private changed(extensionId: string): void {
    for (const l of this.listeners) l(extensionId);
  }

  /** What the button shows on tab `tabId` (or globally). */
  stateFor(extensionId: string, tabId?: number): Required<Omit<ActionState, 'icon' | 'popup' | 'title'>> & ActionState {
    const base = { ...this.defaults(extensionId), ...this.global.get(extensionId) };
    const tab = tabId === undefined ? undefined : this.perTab.get(extensionId)?.get(tabId);
    const s = { ...base, ...tab };
    return {
      ...s,
      badgeText: s.badgeText ?? '',
      badgeBackgroundColor: s.badgeBackgroundColor ?? '#5f6368',
      badgeTextColor: s.badgeTextColor ?? '#ffffff',
      enabled: s.enabled !== false,
    };
  }

  private set(extensionId: string, tabId: unknown, patch: ActionState): void {
    if (typeof tabId === 'number') {
      const tabs = this.perTab.get(extensionId) ?? new Map<number, ActionState>();
      tabs.set(tabId, { ...tabs.get(tabId), ...patch });
      this.perTab.set(extensionId, tabs);
    } else {
      this.global.set(extensionId, { ...this.global.get(extensionId), ...patch });
    }
    this.changed(extensionId);
  }

  /** declarativeNetRequest's blocked count, shown as the badge on one tab. */
  setTabBadge(extensionId: string, tabId: number, text: string): void {
    this.set(extensionId, tabId, { badgeText: text });
  }

  /** A tab closed: its own values go with it. */
  forgetTab(tabId: number): void {
    for (const [ext, tabs] of this.perTab) if (tabs.delete(tabId)) this.changed(ext);
  }

  forgetExtension(extensionId: string): void {
    this.global.delete(extensionId);
    this.perTab.delete(extensionId);
  }

  handlers(openPopup: (ctx: CallContext, tabId?: number) => Promise<void>): Record<string, Handler> {
    const details = (args: unknown[]) => (args[0] ?? {}) as Record<string, unknown>;
    const read = (ctx: CallContext, args: unknown[], key: keyof ActionState) => {
      const d = details(args);
      return this.stateFor(ctx.extensionId, typeof d.tabId === 'number' ? d.tabId : undefined)[key];
    };
    return {
      'action.setIcon': (ctx, args) => {
        const d = details(args);
        let icon: string | null = null;
        const pixels = bestOf(d.imageData as Pixels | Record<string, Pixels> | undefined, isPixels);
        if (pixels) icon = this.icons.fromPixels(pixels.width, pixels.height, pixels.data);
        else {
          const file = bestOf(d.path as string | Record<string, string> | undefined, isPath);
          if (file) icon = this.icons.fromFile(ctx.extensionId, file);
        }
        if (!icon) throw new ApiError('Icon invalid.');
        this.set(ctx.extensionId, d.tabId, { icon });
      },
      'action.setTitle': (ctx, args) => {
        const d = details(args);
        this.set(ctx.extensionId, d.tabId, { title: typeof d.title === 'string' ? d.title.slice(0, 200) : undefined });
      },
      'action.getTitle': (ctx, args) => read(ctx, args, 'title') ?? '',
      'action.setBadgeText': (ctx, args) => {
        const d = details(args);
        this.set(ctx.extensionId, d.tabId, { badgeText: typeof d.text === 'string' ? d.text.slice(0, 8) : '' });
      },
      'action.getBadgeText': (ctx, args) => read(ctx, args, 'badgeText'),
      'action.setBadgeBackgroundColor': (ctx, args) => {
        const d = details(args);
        const c = colorOf(d.color);
        if (!c) throw new ApiError('The color specification could not be parsed.');
        this.set(ctx.extensionId, d.tabId, { badgeBackgroundColor: c });
      },
      'action.getBadgeBackgroundColor': (ctx, args) => read(ctx, args, 'badgeBackgroundColor'),
      'action.setBadgeTextColor': (ctx, args) => {
        const d = details(args);
        const c = colorOf(d.color);
        if (!c) throw new ApiError('The color specification could not be parsed.');
        this.set(ctx.extensionId, d.tabId, { badgeTextColor: c });
      },
      'action.getBadgeTextColor': (ctx, args) => read(ctx, args, 'badgeTextColor'),
      'action.setPopup': (ctx, args) => {
        const d = details(args);
        const popup = typeof d.popup === 'string' ? d.popup.replace(/^chrome-extension:\/\/[a-p]{32}\//, '') : '';
        this.set(ctx.extensionId, d.tabId, { popup });
      },
      'action.getPopup': (ctx, args) => {
        const popup = read(ctx, args, 'popup');
        return popup ? `chrome-extension://${ctx.extensionId}/${String(popup).replace(/^\/+/, '')}` : '';
      },
      'action.enable': (ctx, [tabId]) => this.set(ctx.extensionId, tabId, { enabled: true }),
      'action.disable': (ctx, [tabId]) => this.set(ctx.extensionId, tabId, { enabled: false }),
      'action.isEnabled': (ctx, [tabId]) => this.stateFor(ctx.extensionId, typeof tabId === 'number' ? tabId : undefined).enabled,
      'action.openPopup': (ctx, args) => openPopup(ctx, (details(args) as { windowId?: number }).windowId),
      'action.getUserSettings': () => ({ isOnToolbar: true }),
    };
  }
}
