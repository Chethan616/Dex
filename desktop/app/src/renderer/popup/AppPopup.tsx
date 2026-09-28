import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  AppPopupAction,
  AppPopupMenuItem,
  AppPopupOpenRequest,
} from '../../shared/app-popup';
import { EnginePickerMenuContent } from '../hub/EnginePicker';
import { BrowserCodeModelMenuContent } from '../hub/BrowserCodeModelPicker';
import { MemoryIndicatorContent } from '../hub/MemoryIndicator';
import { EditorIcon, FinderIcon } from '../shared/editorIcons';

declare global {
  interface Window {
    popupHostAPI: {
      ready: () => void;
      onRender: (cb: (request: AppPopupOpenRequest) => void) => () => void;
      contentReady: (popupId: string) => void;
      resize: (size: { popupId: string; width: number; height: number }) => void;
      action: (action: AppPopupAction) => void;
      close: (popupId: string, reason?: string) => void;
    };
  }
}

function useMeasuredPopup(request: AppPopupOpenRequest | null, ref: React.RefObject<HTMLDivElement>): void {
  useLayoutEffect(() => {
    if (!request) return;
    const node = ref.current;
    if (!node) return;
    const measure = (): void => {
      const rect = node.getBoundingClientRect();
      const width = Math.ceil(Math.max(rect.width, node.scrollWidth));
      const height = Math.ceil(Math.max(rect.height, node.scrollHeight));
      window.popupHostAPI.resize({
        popupId: request.id ?? '',
        width,
        height: Math.min(height, request.maxHeight ?? 640),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    const observed = new Set<Element>();
    const observeContent = (): void => {
      for (const element of [node, ...Array.from(node.querySelectorAll<HTMLElement>('*'))]) {
        if (observed.has(element)) continue;
        observed.add(element);
        observer.observe(element);
      }
    };
    observeContent();
    const mutationObserver = new MutationObserver(() => {
      observeContent();
      measure();
    });
    mutationObserver.observe(node, { childList: true, subtree: true });
    return () => {
      mutationObserver.disconnect();
      observer.disconnect();
    };
  }, [request, ref]);
}

function MenuIcon({ item }: { item: AppPopupMenuItem }): React.ReactElement | null {
  if (!item.icon) return null;
  if (item.icon.type === 'editor') return <EditorIcon id={item.icon.id} />;
  if (item.icon.type === 'finder') return <FinderIcon />;
  return null;
}

function CheckIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GenericMenu({
  request,
}: {
  request: Extract<AppPopupOpenRequest, { kind: 'menu' }>;
}): React.ReactElement {
  const popupId = request.id ?? '';
  const select = (item: AppPopupMenuItem): void => {
    if (item.disabled) return;
    window.popupHostAPI.action({
      popupId,
      kind: 'menu-select',
      itemId: item.id,
    });
  };

  // Arrow keys walk the enabled rows, wrapping, like a native menu.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const rows = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('.app-popup-menu__item:not(:disabled)'),
    );
    if (rows.length === 0) return;
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? rows.length - 1
      : event.key === 'ArrowDown' ? (at + 1) % rows.length
      : (at <= 0 ? rows.length - 1 : at - 1);
    rows[next]?.focus();
  };

  return (
    <div className="app-popup-menu" role="menu" onKeyDown={onKeyDown}>
      {request.items.map((item) => (
        <React.Fragment key={item.id}>
          {item.separatorBefore && <div className="app-popup-menu__sep" />}
          <button
            type="button"
            className={`app-popup-menu__item${item.tone === 'danger' ? ' app-popup-menu__item--danger' : ''}${item.hint ? ' app-popup-menu__item--two-line' : ''}`}
            role={item.checked !== undefined ? 'menuitemradio' : 'menuitem'}
            aria-checked={item.checked ?? undefined}
            disabled={item.disabled}
            onClick={() => select(item)}
          >
            {item.icon && <span className="app-popup-menu__icon"><MenuIcon item={item} /></span>}
            {item.hint ? (
              <span className="app-popup-menu__text">
                <span className="app-popup-menu__label">{item.label}</span>
                <span className="app-popup-menu__desc">{item.hint}</span>
              </span>
            ) : (
              <span className="app-popup-menu__label">{item.label}</span>
            )}
            {item.checked && <span className="app-popup-menu__check"><CheckIcon /></span>}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

export function AppPopup(): React.ReactElement {
  const [request, setRequest] = useState<AppPopupOpenRequest | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useMeasuredPopup(request, contentRef);

  useEffect(() => {
    const cleanup = window.popupHostAPI.onRender((next) => {
      setRequest(next);
    });
    window.popupHostAPI.ready();
    return cleanup;
  }, []);

  useLayoutEffect(() => {
    if (!request) return;
    window.popupHostAPI.contentReady(request.id ?? '');
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        window.popupHostAPI.close(request.id ?? '', 'escape');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [request]);

  const emitEngineSelect = useCallback((engineId: string): void => {
    if (!request) return;
    window.popupHostAPI.action({
      popupId: request.id ?? '',
      kind: 'engine-select',
      engineId,
    });
  }, [request]);

  const closeFromContent = useCallback((): void => {
    if (!request) return;
    window.popupHostAPI.close(request.id ?? '', 'request');
  }, [request]);

  const emitBrowserCodeChange = useCallback((): void => {
    if (!request) return;
    window.popupHostAPI.action({
      popupId: request.id ?? '',
      kind: 'browsercode-model-changed',
    });
  }, [request]);

  const contentKey = request?.id ?? 'empty';
  return (
    <div ref={contentRef} className={`app-popup app-popup--${request?.kind ?? 'empty'}`}>
      {request?.kind === 'menu' && <GenericMenu key={contentKey} request={request} />}
      {request?.kind === 'engine-picker' && (
        <EnginePickerMenuContent
          key={contentKey}
          value={request.value}
          onChange={emitEngineSelect}
          onClose={closeFromContent}
        />
      )}
      {request?.kind === 'browsercode-model-picker' && (
        <BrowserCodeModelMenuContent
          key={contentKey}
          onChanged={emitBrowserCodeChange}
          onClose={closeFromContent}
        />
      )}
      {request?.kind === 'memory-indicator' && <MemoryIndicatorContent key={contentKey} />}
    </div>
  );
}
