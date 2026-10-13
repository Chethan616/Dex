/**
 * chrome.proxy.settings for extensions, applied to the web profile's own
 * proxy (session.setProxy). DEX's own windows keep the system proxy.
 *
 * Like Chrome, one extension controls the proxy at a time — the last one to
 * set it — and its setting is remembered across restarts until it clears it
 * or is removed. That's what a library-proxy extension (the VIT one) needs:
 * turn it on once and journal sites keep going through the library.
 */
import fs from 'node:fs';
import { ApiError, type Handler } from './types';

export interface ElectronProxyConfig {
  mode: 'direct' | 'auto_detect' | 'pac_script' | 'fixed_servers' | 'system';
  pacScript?: string;
  proxyRules?: string;
  proxyBypassRules?: string;
}

interface ProxyServer { scheme?: string; host?: string; port?: number }

function server(s: unknown): string | null {
  const p = (s ?? {}) as ProxyServer;
  if (typeof p.host !== 'string' || !/^[A-Za-z0-9.\-:[\]_]+$/.test(p.host)) return null;
  const scheme = typeof p.scheme === 'string' ? p.scheme.toLowerCase() : 'http';
  if (!['http', 'https', 'quic', 'socks4', 'socks5'].includes(scheme)) return null;
  const port = typeof p.port === 'number' && p.port > 0 && p.port < 65536 ? `:${p.port}` : '';
  return `${scheme}://${p.host}${port}`;
}

/** Chrome's ProxyConfig as Electron's (throws for a malformed one). */
export function toElectronProxy(value: unknown): ElectronProxyConfig {
  const v = (value ?? {}) as { mode?: string; rules?: Record<string, unknown>; pacScript?: { url?: string; data?: string } };
  switch (v.mode) {
    case 'direct': return { mode: 'direct' };
    case 'auto_detect': return { mode: 'auto_detect' };
    case 'system': return { mode: 'system' };
    case 'pac_script': {
      const pac = v.pacScript ?? {};
      if (typeof pac.data === 'string' && pac.data) {
        return { mode: 'pac_script', pacScript: `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(pac.data, 'utf8').toString('base64')}` };
      }
      if (typeof pac.url === 'string' && /^(https?|data|file):/i.test(pac.url)) return { mode: 'pac_script', pacScript: pac.url };
      throw new ApiError('A PAC script needs a url or data');
    }
    case 'fixed_servers': {
      const r = v.rules ?? {};
      const parts: string[] = [];
      if (r.singleProxy) {
        const s = server(r.singleProxy);
        if (!s) throw new ApiError('Invalid proxy server');
        parts.push(s);
      } else {
        for (const [key, scheme] of [['proxyForHttp', 'http'], ['proxyForHttps', 'https'], ['proxyForFtp', 'ftp']] as const) {
          if (!r[key]) continue;
          const s = server(r[key]);
          if (!s) throw new ApiError('Invalid proxy server');
          parts.push(`${scheme}=${s}`);
        }
        if (r.fallbackProxy) {
          const s = server(r.fallbackProxy);
          if (!s) throw new ApiError('Invalid proxy server');
          parts.push(`socks=${s}`);
        }
      }
      if (parts.length === 0) throw new ApiError('Fixed servers need at least one proxy');
      const bypass = Array.isArray(r.bypassList) ? r.bypassList.filter((b): b is string => typeof b === 'string' && /^[^\s,;]+$/.test(b)) : [];
      return { mode: 'fixed_servers', proxyRules: parts.join(';'), ...(bypass.length ? { proxyBypassRules: bypass.join(',') } : {}) };
    }
    default:
      throw new ApiError(`Unsupported proxy mode: ${String(v.mode)}`);
  }
}

interface Saved { extensionId: string; value: unknown }

export class ProxyControl {
  private current: Saved | null = null;

  constructor(private readonly deps: {
    file: string;
    apply(config: ElectronProxyConfig): Promise<void>;
    /** Tell every extension with "proxy" what the setting is now. */
    changed(): void;
    log?(event: string, data: Record<string, unknown>): void;
  }) {
    try {
      const saved = JSON.parse(fs.readFileSync(deps.file, 'utf8')) as Saved;
      if (saved && typeof saved.extensionId === 'string') this.current = saved;
    } catch { /* none */ }
  }

  /** An extension loaded: put its remembered proxy back. */
  async restore(extensionId: string): Promise<void> {
    if (this.current?.extensionId !== extensionId) return;
    try {
      await this.deps.apply(toElectronProxy(this.current.value));
    } catch (err) {
      this.deps.log?.('extensions.proxy.restoreFailed', { extensionId, error: (err as Error).message });
    }
  }

  /** An extension went away (removed or turned off): its proxy goes with it. */
  async release(extensionId: string, forget: boolean): Promise<void> {
    if (this.current?.extensionId !== extensionId) return;
    await this.deps.apply({ mode: 'system' });
    if (forget) { this.current = null; this.save(); }
    this.deps.changed();
  }

  private save(): void {
    try {
      if (this.current) fs.writeFileSync(this.deps.file, JSON.stringify(this.current));
      else fs.rmSync(this.deps.file, { force: true });
    } catch { /* best effort */ }
  }

  /** What chrome.proxy.settings.get answers, for `extensionId`. */
  stateFor(extensionId: string): { value: unknown; levelOfControl: string } {
    if (!this.current) return { value: { mode: 'system' }, levelOfControl: 'controllable_by_this_extension' };
    return {
      value: this.current.value,
      levelOfControl: this.current.extensionId === extensionId ? 'controlled_by_this_extension' : 'controlled_by_other_extensions',
    };
  }

  handlers(): Record<string, Handler> {
    return {
      'proxy.settings.get': (ctx) => this.stateFor(ctx.extensionId),
      'proxy.settings.set': async (ctx, [details]) => {
        const d = (details ?? {}) as { value?: unknown; scope?: string };
        if (d.scope && d.scope !== 'regular' && d.scope !== 'regular_only') throw new ApiError('Only the regular scope is supported');
        const config = toElectronProxy(d.value);
        await this.deps.apply(config);
        this.current = { extensionId: ctx.extensionId, value: d.value };
        this.save();
        this.deps.log?.('extensions.proxy.set', { extensionId: ctx.extensionId, mode: config.mode });
        this.deps.changed();
      },
      'proxy.settings.clear': async (ctx) => {
        if (this.current?.extensionId !== ctx.extensionId) return;
        await this.deps.apply({ mode: 'system' });
        this.current = null;
        this.save();
        this.deps.changed();
      },
    };
  }
}
