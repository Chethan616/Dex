/**
 * The user's Chrome extensions, named in every task's prompt: an agent that
 * doesn't know a library proxy or a reference manager is installed never
 * reaches for it, and one that doesn't know `dex-ext` exists works around a
 * site that needs an extension instead of using it. Like dex-find and
 * dex-canvas, it's named right here, not only in a skill doc.
 */
export interface ExtensionForPrompt {
  name: string;
  description: string;
  /** Kept in the user's hands (main/extensions/ExtensionHost.ts offLimits). */
  offLimits: string | null;
}

let provider: (() => ExtensionForPrompt[]) | null = null;

/** Main hands over the installed, switched-on extensions once the browser is up. */
export function setExtensionsForPrompt(fn: () => ExtensionForPrompt[]): void {
  provider = fn;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

export function extensionsBriefing(): string[] {
  let list: ExtensionForPrompt[] = [];
  try { list = provider?.() ?? []; } catch { list = []; }
  const tools = '`dex-ext` (`dex-ext list`, `dex-ext click <name>` for its button, `dex-ext menu` for its right-click items; one that isn\'t installed: `dex-ext install <Chrome Web Store link>`, which asks the user) — see `./dex-tools/extensions.md`';
  if (!list.length) {
    return [`No Chrome extensions are installed in your browser. If a site needs one (a library proxy, "install our extension to continue"), use ${tools}.`];
  }
  const usable = list.filter((e) => !e.offLimits).map((e) => `${e.name}${e.description ? ` (${clip(e.description.replace(/\s+/g, ' '), 80)})` : ''}`);
  const off = list.filter((e) => e.offLimits).map((e) => `${e.name} (${e.offLimits})`);
  return [
    `The user's Chrome extensions run in your browser${usable.length ? `: ${usable.join('; ')}` : ''}.${off.length ? ` ${off.join(', ')} stay${off.length === 1 ? 's' : ''} the user's: never use ${off.length === 1 ? 'it' : 'them'}.` : ''} When a site needs an extension, or one of these would help, use ${tools}.`,
  ];
}
