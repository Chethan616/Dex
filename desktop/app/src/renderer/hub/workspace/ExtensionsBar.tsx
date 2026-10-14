/**
 * Extensions in the workspace toolbar, as in Chrome: the buttons you pinned
 * (with their badges), then the puzzle piece with every extension, pinning,
 * and the way to the Chrome Web Store. A click opens the extension's popup
 * under its button (drawn by main above the page), right-click its menu.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { PuzzleIcon } from '../icons/PuzzleIcon';

function anchorOf(el: Element): ExtensionAnchor {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

export function ExtensionsBar({ sessionId, activeTabId }: { sessionId: string; activeTabId?: string }): React.ReactElement | null {
  const api = window.electronAPI?.extensions;
  const [items, setItems] = useState<ExtensionToolbarItem[]>([]);

  const refresh = useCallback(() => {
    void api?.toolbar(sessionId).then(setItems).catch(() => setItems([]));
  }, [api, sessionId]);

  useEffect(() => { refresh(); }, [refresh, activeTabId]);
  useEffect(() => api?.onChanged(refresh), [api, refresh]);

  if (!api) return null;
  const pinned = items.filter((i) => i.pinned);

  return (
    <div className="ws-ext" role="group" aria-label="Extensions">
      {pinned.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`ws-btn ws-ext__btn${item.enabled ? '' : ' ws-ext__btn--off'}`}
          title={item.title}
          aria-label={item.badgeText ? `${item.title} (${item.badgeText})` : item.title}
          onClick={(e) => { void api.action(item.id, sessionId, anchorOf(e.currentTarget)); }}
          onContextMenu={(e) => {
            e.preventDefault();
            void api.actionMenu(item.id, sessionId, e.clientX, e.clientY);
          }}
        >
          {item.icon
            ? <img className="ws-ext__icon" src={item.icon} alt="" draggable={false} />
            : <span className="ws-ext__icon ws-ext__icon--blank">{item.name.slice(0, 1)}</span>}
          {item.badgeText && (
            <span className="ws-ext__badge" style={{ background: item.badgeBackgroundColor, color: item.badgeTextColor }}>
              {item.badgeText}
            </span>
          )}
        </button>
      ))}
      <button
        type="button"
        className="ws-btn ws-ext__menu"
        title="Extensions"
        aria-label="Extensions"
        onClick={(e) => { void api.menu(sessionId, anchorOf(e.currentTarget)); }}
      >
        <PuzzleIcon size={18} />
      </button>
    </div>
  );
}
