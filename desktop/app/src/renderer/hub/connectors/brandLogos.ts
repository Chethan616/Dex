/**
 * Each connector's own logo, drawn on a white tile like an app icon.
 *
 * assets/brand-logos/: the vectors are Simple Icons (CC0) in the brand's
 * colour; Google, Microsoft, Slack, Reddit and Hugging Face are their
 * full-colour marks; the rest are the services' own icons from their sites.
 * The logos are their owners' trademarks, shown only to name the service
 * (LICENSES.md).
 */
const FILES = import.meta.glob<string>('../../assets/brand-logos/*.{svg,png}', { eager: true, query: '?url', import: 'default' });

const BY_NAME = new Map(Object.entries(FILES).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1).replace(/\.\w+$/, ''), url]));

/** Icons that are a whole tile already: they fill it instead of sitting inside it. */
const FULL_BLEED = new Set(['biorender', 'context7', 'deepwiki', 'exa', 'kiwi']);
/** The tile, when the brand's own icon isn't on white. */
const TILE: Record<string, string> = { miro: '#ffd02f' };
/** Connectors that share another's logo. */
const SAME_AS: Record<string, string> = { 'cloudflare-docs': 'cloudflare', 'huggingface-hub': 'huggingface' };

export interface BrandLogo {
  src: string;
  bleed: boolean;
  tile?: string;
}

/** A hosted connector's id or a built-in account's provider. */
export function brandLogo(id: string): BrandLogo | undefined {
  const name = SAME_AS[id] ?? id;
  const src = BY_NAME.get(name);
  return src ? { src, bleed: FULL_BLEED.has(name), tile: TILE[name] } : undefined;
}
