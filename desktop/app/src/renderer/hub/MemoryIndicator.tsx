import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { closeAppPopup, openAnchoredAppPopup } from '../shared/appPopup';

interface ProcessInfo {
  pid?: number;
  label: string;
  type: string;
  component?: string;
  mb: number;
  cpuPercent?: number;
  sessionId?: string;
  engineId?: string;
  source?: string;
}

interface MemoryData {
  totalMb: number;
  totalCpuPercent?: number;
  sessions: Array<{ id: string; mb: number; cpuPercent?: number; status: string; processCount?: number }>;
  processes: ProcessInfo[];
  processCount: number;
  errors?: string[];
}

function formatGb(mb: number): string {
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function formatCpu(cpuPercent?: number): string {
  if (cpuPercent == null) return '0%';
  return `${Math.round(cpuPercent)}%`;
}

function statusDotClass(status: string): string {
  switch (status) {
    case 'running': return 'mem__dot--running';
    case 'stuck': return 'mem__dot--stuck';
    case 'paused': return 'mem__dot--paused';
    case 'idle': return 'mem__dot--idle';
    default: return 'mem__dot--stopped';
  }
}

export function MemoryIndicator(): React.ReactElement | null {
  const [popupId, setPopupId] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const { data } = useQuery<MemoryData>({
    queryKey: ['memory'],
    queryFn: async () => {
      const api = window.electronAPI;
      if (!api) return { totalMb: 0, totalCpuPercent: 0, sessions: [], processes: [], processCount: 0 };
      return api.sessions.memory();
    },
    refetchInterval: popupId ? 5000 : 15000,
    staleTime: 4000,
  });

  const openMenu = useCallback(async () => {
    const button = buttonRef.current;
    if (!button) return;
    if (popupId) {
      closeAppPopup(popupId);
      return;
    }
    const nextId = await openAnchoredAppPopup(
      button,
      {
        kind: 'memory-indicator',
        placement: 'bottom-start',
        width: 360,
        maxHeight: 420,
      },
      {
        onClosed: () => setPopupId(null),
      },
    );
    if (nextId) setPopupId(nextId);
  }, [popupId]);

  if (!data) return null;

  return (
    <div className="mem-indicator">
      <button
        ref={buttonRef}
        className="mem-indicator__btn"
        onClick={(e) => { e.stopPropagation(); void openMenu(); }}
        aria-expanded={Boolean(popupId)}
        aria-haspopup="menu"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="2" y="1.5" width="10" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="4" y="7" width="2" height="3.5" rx="0.5" fill="currentColor" opacity="0.5" />
          <rect x="7.5" y="4.5" width="2" height="6" rx="0.5" fill="currentColor" opacity="0.7" />
        </svg>
        <span>{formatGb(data.totalMb)} / {formatCpu(data.totalCpuPercent)}</span>
      </button>
    </div>
  );
}

export function MemoryIndicatorContent(): React.ReactElement {
  const [data, setData] = useState<MemoryData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async (): Promise<void> => {
      const api = window.electronAPI;
      if (!api) return;
      try {
        const next = await api.sessions.memory();
        if (!cancelled) setData(next);
      } catch (err) {
        console.warn('[MemoryIndicator] memory fetch failed', err);
      }
    };
    void fetchOnce();
    const interval = window.setInterval(fetchOnce, 5000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  if (!data) {
    return <div className="mem-popup mem-popup--loading">Loading…</div>;
  }

  return (
    <div className="mem-popup">
      <div className="mem__header">
        <span className="mem__title">Resource usage</span>
        <span className="mem__total">{formatGb(data.totalMb)} / {formatCpu(data.totalCpuPercent)}</span>
      </div>
      <div className="mem__processes">
        {(data.processes ?? [])
          .sort((a, b) => {
            if (a.sessionId && !b.sessionId) return -1;
            if (!a.sessionId && b.sessionId) return 1;
            return b.mb - a.mb || (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0);
          })
          .map((p, i) => (
            <div key={p.pid ?? i} className="mem__session-row" title={`${p.type}${p.pid ? ` pid ${p.pid}` : ''}${p.component ? ` (${p.component})` : ''}`}>
              <span className={`mem__dot ${p.sessionId ? statusDotClass(data.sessions.find((s) => s.id === p.sessionId)?.status ?? 'stopped') : 'mem__dot--system'}`} />
              <span className="mem__session-id">{p.label}</span>
              <span className="mem__session-mb">{Math.round(p.mb)} MB / {formatCpu(p.cpuPercent)}</span>
              {p.sessionId && (
                <button
                  className="mem__kill-btn"
                  onClick={() => {
                    const api = window.electronAPI;
                    if (!api || !p.sessionId) return;
                    api.sessions.cancel(p.sessionId).catch(() => {});
                  }}
                  aria-label="Stop session"
                >
                  <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                    <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
