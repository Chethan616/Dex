/**
 * The workspace's browser chrome, above the live page: a tab strip, then
 * back / forward / reload, the address bar, and (while DEX drives) a quiet
 * "DEX is working" chip with Pause. Everything here is renderer DOM above
 * the native page view, so it's always clickable.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { displayAddress } from '../../../shared/address';
import './workspace.css';

interface WorkspaceBarProps {
  sessionId: string;
  tabs: WorkspaceTab[];
  /** DEX is driving this task right now. */
  agentActive: boolean;
  onPause?: () => void;
  /** The pinned Chat tab (docs/unify/PLAN.md §3.12). */
  chat?: { active: boolean; unread: boolean; working: boolean; onSelect: () => void };
  /** A web tab was picked: the page takes the rect back from the chat. */
  onSelectPage?: () => void;
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
};

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

export function WorkspaceBar({ sessionId, tabs, agentActive, onPause, chat, onSelectPage }: WorkspaceBarProps): React.ReactElement {
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
            <span className="ws-tab__icon">{chat.working ? <span className="ws-spinner" /> : Icon.chat}</span>
            <span className="ws-tab__title">Chat</span>
            {chat.unread && <span className="ws-tab__dot" aria-label="New reply" />}
          </div>
        )}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.active && !chat?.active}
            tabIndex={tab.active && !chat?.active ? 0 : -1}
            className={`ws-tab${tab.active && !chat?.active ? ' ws-tab--active' : ''}${tab.openedBy === 'task' ? ' ws-tab--task' : ''}`}
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
        <button type="button" className="ws-newtab" aria-label="New tab (Ctrl+T)" title="New tab (Ctrl+T)" onClick={() => { act({ op: 'new' }); onSelectPage?.(); }}>
          {Icon.plus}
        </button>
      </div>

      {!chat?.active && <div className="ws-toolbar">
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
        </form>

        {agentActive && (
          <div className="ws-agent" role="status">
            <span className="ws-agent__dot" aria-hidden="true" />
            <span className="ws-agent__text">DEX is working — you can use the page too</span>
            {onPause && (
              <button type="button" className="ws-agent__pause" onClick={onPause}>Pause</button>
            )}
          </div>
        )}
      </div>}
    </div>
  );
}
