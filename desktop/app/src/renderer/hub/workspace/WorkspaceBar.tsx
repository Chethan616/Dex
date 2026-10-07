/**
 * The workspace's browser chrome, above the live page: a tab strip, then
 * back / forward / reload, the address bar, (while DEX drives) a quiet
 * "DEX is working" chip with Pause, and the ⋯ menu. Everything here is
 * renderer DOM above the native page view, so it's always clickable; the
 * find bar stays inside the toolbar's height for the same reason, and the
 * ⋯ menu is native (main/workspace/pageMenu.ts) so it can draw over the page.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { displayAddress } from '../../../shared/address';
import { FileBadge } from '../chat/fileKinds';
import './workspace.css';

interface WorkspaceBarProps {
  sessionId: string;
  tabs: WorkspaceTab[];
  /** DEX is driving this task right now. */
  agentActive: boolean;
  onPause?: () => void;
  /** The pinned Chat tab (docs/unify/PLAN.md §3.12). */
  chat?: { active: boolean; unread: boolean; working: boolean; onSelect: () => void; icon?: React.ReactNode };
  /** A web tab was picked: the page takes the rect back from the chat. */
  onSelectPage?: () => void;
  /** Document tabs (docs/unify/PLAN.md §3.9), after Chat and before the web tabs. */
  docs?: { items: WorkspaceDoc[]; activeId: string | null; onSelect: (id: string) => void; onClose: (id: string) => void };
  /** The task has a browser: web tabs, "+" and the toolbar. */
  browser?: boolean;
  /** The Subagents tab: shown only once the task has launched at least one. */
  subagents?: { active: boolean; count: number; activeCount: number; onSelect: () => void };
}

const Icon = {
  back: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M12.5 8h-9m0 0L8 3.5M3.5 8 8 12.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  forward: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 8h9m0 0L8 3.5M12.5 8 8 12.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  reload: (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.46-3.54M13 3v2.6h-2.6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  stop: (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
  ),
  plus: (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
  ),
  close: (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
  ),
  globe: (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="5.8" stroke="currentColor" strokeWidth="1.3" fill="none" /><path d="M2.4 8h11.2M8 2.2c1.7 1.6 2.6 3.6 2.6 5.8S9.7 12.2 8 13.8M8 2.2C6.3 3.8 5.4 5.8 5.4 8s.9 4.2 2.6 5.8" stroke="currentColor" strokeWidth="1.1" fill="none" /></svg>
  ),
  lock: (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.6" stroke="currentColor" strokeWidth="1.3" fill="none" /><path d="M5.6 7V5.4a2.4 2.4 0 0 1 4.8 0V7" stroke="currentColor" strokeWidth="1.3" fill="none" /></svg>
  ),
  chat: (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7.5L4.5 14v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" /></svg>
  ),
  crashed: (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2.5 14 13H2L8 2.5Z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" /><path d="M8 6.5v3M8 11.2v.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
  ),
  more: (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" fill="currentColor" /><circle cx="8" cy="8" r="1.3" fill="currentColor" /><circle cx="12.5" cy="8" r="1.3" fill="currentColor" /></svg>
  ),
  up: (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  down: (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  subagents: (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="5.5" cy="5.5" r="2.1" stroke="currentColor" strokeWidth="1.2" fill="none" /><circle cx="11" cy="7" r="1.6" stroke="currentColor" strokeWidth="1.2" fill="none" /><path d="M2 13c0-2.2 1.6-3.8 3.5-3.8S9 10.8 9 13M9.3 12.3c.2-1.6 1.4-2.7 2.8-2.7 1.6 0 2.9 1.3 2.9 3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" /></svg>
  ),
};

/** The find bar's count: "3 of 12", "No matches", or nothing before a search. */
export function findCount(text: string, found: { active: number; matches: number } | null): string {
  if (!text || !found) return '';
  return found.matches === 0 ? 'No matches' : `${found.active} of ${found.matches}`;
}

function tabLabel(tab: WorkspaceTab): string {
  if (tab.isNewTab) return 'New tab';
  return tab.title || displayAddress(tab.url) || 'Loading…';
}

function TabIcon({ tab }: { tab: WorkspaceTab }): React.ReactElement {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [tab.faviconUrl]);
  if (tab.crashed) return <span className="ws-tab__icon ws-tab__icon--crashed">{Icon.crashed}</span>;
  if (tab.loading) return <span className="ws-tab__icon"><span className="ws-spinner" /></span>;
  if (tab.faviconUrl && !broken) {
    return <img className="ws-tab__icon" src={tab.faviconUrl} alt="" onError={() => setBroken(true)} draggable={false} />;
  }
  return <span className="ws-tab__icon ws-tab__icon--globe">{Icon.globe}</span>;
}

export function WorkspaceBar({ sessionId, tabs, agentActive, onPause, chat, onSelectPage, docs, browser = true, subagents }: WorkspaceBarProps): React.ReactElement {
  const api = window.electronAPI?.workspace;
  const active = tabs.find((t) => t.active) ?? tabs[0];
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const act = useCallback((action: WorkspaceTabAction) => {
    void api?.tab(sessionId, action);
  }, [api, sessionId]);

  // What the address bar shows when you're not typing in it.
  const shown = active ? (active.isNewTab ? '' : displayAddress(active.url)) : '';
  useEffect(() => {
    if (!editing) setDraft(active?.url && !active.isNewTab ? active.url : '');
  }, [active?.url, active?.isNewTab, editing]);
  // Another tab: what the bar held belonged to the last one. Ctrl+T focuses
  // the bar before the new tab arrives, so it had copied tab A's address —
  // and Enter then loaded A in the new tab.
  const draftTab = useRef(active?.id);
  useEffect(() => {
    if (draftTab.current === active?.id) return;
    draftTab.current = active?.id;
    setDraft(active?.url && !active.isNewTab ? active.url : '');
  }, [active?.id, active?.url, active?.isNewTab]);

  const focusAddress = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // Ctrl+L / a new tab, pressed while the page itself had focus.
  useEffect(() => api?.onFocusAddress((id) => { if (id === sessionId) requestAnimationFrame(focusAddress); }), [api, sessionId, focusAddress]);
  // A fresh new tab starts with the cursor in the address bar.
  useEffect(() => {
    if (active?.isNewTab && active.openedBy === 'user') requestAnimationFrame(focusAddress);
  }, [active?.id, active?.isNewTab, active?.openedBy, focusAddress]);

  // Find in page (Ctrl+F, or the ⋯ menu): a small bar at the toolbar's end.
  const findRef = useRef<HTMLInputElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [found, setFound] = useState<{ active: number; matches: number } | null>(null);
  const activeId = active?.id;
  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindText('');
    setFound(null);
    void api?.find?.(sessionId, { tabId: activeId, stop: true });
  }, [api, sessionId, activeId]);
  const findStep = useCallback((forward: boolean) => {
    if (findText) void api?.find?.(sessionId, { tabId: activeId, text: findText, next: true, forward });
  }, [api, sessionId, activeId, findText]);
  /** What owns the rect: the chat, a document, the Subagents tab, or the active web page. */
  const pageInFront = !chat?.active && !docs?.activeId && !subagents?.active;
  const pageInFrontRef = useRef(pageInFront);
  pageInFrontRef.current = pageInFront;
  useEffect(() => api?.onFind?.((id) => {
    if (id !== sessionId || !pageInFrontRef.current) return;
    setFindOpen(true);
    requestAnimationFrame(() => { findRef.current?.focus(); findRef.current?.select(); });
  }), [api, sessionId]);
  useEffect(() => api?.onFound?.((id, tabId, result) => {
    if (id === sessionId && tabId === activeId) setFound(result);
  }), [api, sessionId, activeId]);
  // Another tab, or the page leaves the front: the search ends with it.
  useEffect(() => {
    if (!pageInFront && findOpen) closeFind();
  }, [pageInFront, findOpen, closeFind]);
  const lastTab = useRef(activeId);
  useEffect(() => {
    const previous = lastTab.current;
    lastTab.current = activeId;
    if (previous === activeId || !findOpen) return;
    // The highlights are in the tab you left.
    void api?.find?.(sessionId, { tabId: previous, stop: true });
    setFindOpen(false);
    setFindText('');
    setFound(null);
  }, [activeId, findOpen, api, sessionId]);

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || !active) return;
    act({ op: 'navigate', tabId: active.id, input: text });
    setEditing(false);
    inputRef.current?.blur();
  }, [act, active, draft]);

  const secure = active?.url.startsWith('https://');

  return (
    <div className="ws" onClick={(e) => e.stopPropagation()}>
      <div className="ws-tabs" role="tablist" aria-label="Tabs">
        {chat && (
          <div
            role="tab"
            aria-selected={chat.active}
            tabIndex={chat.active ? 0 : -1}
            className={`ws-tab ws-tab--chat${chat.active ? ' ws-tab--active' : ''}`}
            title="The conversation"
            onClick={chat.onSelect}
          >
            <span className="ws-tab__icon">{chat.icon ?? (chat.working ? <span className="ws-spinner" /> : Icon.chat)}</span>
            <span className="ws-tab__title">Chat</span>
            {chat.unread && <span className="ws-tab__dot" aria-label="New reply" />}
          </div>
        )}
        {subagents && subagents.count > 0 && (
          <div
            role="tab"
            aria-selected={subagents.active}
            tabIndex={subagents.active ? 0 : -1}
            className={`ws-tab ws-tab--subagents${subagents.active ? ' ws-tab--active' : ''}`}
            title={`${subagents.count} subagent${subagents.count === 1 ? '' : 's'}`}
            onClick={subagents.onSelect}
          >
            <span className="ws-tab__icon">{Icon.subagents}</span>
            <span className="ws-tab__title">Subagents</span>
            {subagents.activeCount > 0 && <span className="ws-tab__dot" aria-label={`${subagents.activeCount} active`} />}
          </div>
        )}
        {docs?.items.map((doc) => {
          const on = doc.id === docs.activeId && !chat?.active;
          return (
            <div
              key={doc.id}
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              className={`ws-tab ws-tab--doc${on ? ' ws-tab--active' : ''}`}
              title={doc.openedBy === 'agent' ? `${doc.path}\nOpened by DEX` : doc.path}
              onMouseDown={(e) => {
                if (e.button === 1) { e.preventDefault(); docs.onClose(doc.id); }
              }}
              onClick={() => docs.onSelect(doc.id)}
            >
              <span className="ws-tab__icon"><FileBadge name={doc.name} size="sm" /></span>
              <span className="ws-tab__title">{doc.name}</span>
              <button
                type="button"
                className="ws-tab__close"
                aria-label={`Close ${doc.name}`}
                onClick={(e) => { e.stopPropagation(); docs.onClose(doc.id); }}
              >
                {Icon.close}
              </button>
            </div>
          );
        })}
        {browser && tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.active && pageInFront}
            tabIndex={tab.active && pageInFront ? 0 : -1}
            className={`ws-tab${tab.active && pageInFront ? ' ws-tab--active' : ''}${tab.openedBy === 'task' ? ' ws-tab--task' : ''}`}
            title={tab.title ? `${tab.title}\n${tab.url}` : tab.url || 'New tab'}
            onMouseDown={(e) => {
              if (e.button === 1) { e.preventDefault(); act({ op: 'close', tabId: tab.id }); }
            }}
            onClick={() => { act({ op: 'activate', tabId: tab.id }); onSelectPage?.(); }}
          >
            <TabIcon tab={tab} />
            <span className="ws-tab__title">{tabLabel(tab)}</span>
            <button
              type="button"
              className="ws-tab__close"
              aria-label={`Close ${tabLabel(tab)}`}
              onClick={(e) => { e.stopPropagation(); act({ op: 'close', tabId: tab.id }); }}
            >
              {Icon.close}
            </button>
          </div>
        ))}
        {browser && (
          <button type="button" className="ws-newtab" aria-label="New tab (Ctrl+T)" title="New tab (Ctrl+T)" onClick={() => { act({ op: 'new' }); onSelectPage?.(); }}>
            {Icon.plus}
          </button>
        )}
      </div>

      {browser && pageInFront && <div className="ws-toolbar">
        <div className="ws-nav">
          <button type="button" className="ws-btn" aria-label="Back (Alt+←)" title="Back" disabled={!active?.canGoBack} onClick={() => act({ op: 'back', tabId: active?.id })}>{Icon.back}</button>
          <button type="button" className="ws-btn" aria-label="Forward (Alt+→)" title="Forward" disabled={!active?.canGoForward} onClick={() => act({ op: 'forward', tabId: active?.id })}>{Icon.forward}</button>
          <span className="ws-nav__sep" />
          {active?.loading ? (
            <button type="button" className="ws-btn" aria-label="Stop" title="Stop" onClick={() => act({ op: 'stop', tabId: active.id })}>{Icon.stop}</button>
          ) : (
            <button type="button" className="ws-btn" aria-label="Reload (Ctrl+R)" title="Reload" disabled={!active || active.isNewTab} onClick={() => act({ op: 'reload', tabId: active?.id })}>{Icon.reload}</button>
          )}
        </div>

        <form
          className={`ws-address${editing ? ' ws-address--editing' : ''}`}
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          {!editing && secure && <span className="ws-address__lock" title="Secure connection">{Icon.lock}</span>}
          <input
            ref={inputRef}
            className="ws-address__input"
            value={editing ? draft : shown}
            placeholder="Search or enter a URL"
            spellCheck={false}
            autoComplete="off"
            aria-label="Address and search bar"
            onFocus={(e) => {
              setEditing(true);
              setDraft(active?.url && !active.isNewTab ? active.url : '');
              requestAnimationFrame(() => e.target.select());
            }}
            onBlur={() => setEditing(false)}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setEditing(false);
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {!editing && active?.zoom !== undefined && active.zoom !== 100 && (
            <button
              type="button"
              className="ws-address__zoom"
              title="Back to 100% (Ctrl+0)"
              aria-label={`Zoomed to ${active.zoom}%. Reset zoom`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { void api?.shortcut(sessionId, 'zoom-reset'); }}
            >
              {active.zoom}%
            </button>
          )}
        </form>

        {findOpen && (
          <div className="ws-find" role="search">
            <input
              ref={findRef}
              className="ws-find__input"
              value={findText}
              placeholder="Find in page"
              aria-label="Find in page"
              spellCheck={false}
              onChange={(e) => {
                const text = e.target.value;
                setFindText(text);
                if (!text) setFound(null);
                void api?.find?.(sessionId, { tabId: activeId, text });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); findStep(!e.shiftKey); }
                if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
              }}
            />
            <span className="ws-find__count" aria-live="polite">{findCount(findText, found)}</span>
            <button type="button" className="ws-btn ws-find__btn" aria-label="Previous match (Shift+Enter)" title="Previous" disabled={!found?.matches} onClick={() => findStep(false)}>{Icon.up}</button>
            <button type="button" className="ws-btn ws-find__btn" aria-label="Next match (Enter)" title="Next" disabled={!found?.matches} onClick={() => findStep(true)}>{Icon.down}</button>
            <button type="button" className="ws-btn ws-find__btn" aria-label="Close find (Esc)" title="Close" onClick={closeFind}>{Icon.close}</button>
          </div>
        )}

        {agentActive && (
          <div className="ws-agent" role="status">
            <span className="ws-agent__dot" aria-hidden="true" />
            <span className="ws-agent__text">DEX is working — you can use the page too</span>
            {onPause && (
              <button type="button" className="ws-agent__pause" onClick={onPause}>Pause</button>
            )}
          </div>
        )}

        <button
          type="button"
          className="ws-btn ws-more"
          aria-label="More for this page"
          title="Find, zoom, print, open in your browser…"
          disabled={!active || !api?.pageMenu}
          onClick={(e) => {
            if (!active) return;
            const r = e.currentTarget.getBoundingClientRect();
            // The native menu opens from its top-left corner; most of it sits left of the button.
            void api?.pageMenu?.(sessionId, active.id, Math.max(0, r.right - 236), r.bottom + 4);
          }}
        >
          {Icon.more}
        </button>
      </div>}
    </div>
  );
}
