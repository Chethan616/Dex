/**
 * Settings › Extensions: the way into the Extensions panel (ExtensionsMarket),
 * the same card Settings › Connectors has for the Marketplace — what's on
 * offer, what's installed, and Browse. Everything else lives in the panel.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { EXTENSION_CATALOG } from '../../shared/extensionCatalog';
import { ExtMark, type ExtensionsView } from './ExtensionsMarket';

const open = (view: ExtensionsView = 'browse'): void => {
  window.dispatchEvent(new CustomEvent('dex:open-extensions', { detail: view }));
};

export function ExtensionsSection(): React.ReactElement {
  const [installed, setInstalled] = useState<ExtensionSummary[]>([]);
  const refresh = useCallback(() => {
    void window.electronAPI?.extensions?.list().then(setInstalled).catch(() => setInstalled([]));
  }, []);
  useEffect(() => {
    refresh();
    return window.electronAPI?.extensions?.onChanged(refresh);
  }, [refresh]);

  return (
    <div className="settings-market">
      <div className="settings-market__text">
        <span className="settings-market__title">Chrome extensions</span>
        <span className="settings-market__sub">
          {EXTENSION_CATALOG.length} picks — Dark Reader, uBlock Origin Lite, Grammarly, Bitwarden, Zotero and more — or anything from the Chrome Web Store. They work in your tasks’ tabs, never in DEX itself.
        </span>
        {installed.length > 0 && (
          <button type="button" className="settings-market__installed" onClick={() => open('installed')}>
            <span className="mk__stack">{installed.slice(0, 5).map((e) => <ExtMark key={e.id} icon={e.icon} name={e.name} size={22} />)}</span>
            {installed.length} installed ›
          </button>
        )}
      </div>
      <button type="button" className="settings-market__browse" onClick={() => open('browse')}>Browse</button>
    </div>
  );
}
