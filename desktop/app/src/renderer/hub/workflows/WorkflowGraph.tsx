/**
 * A workflow as a graph, n8n-style (the owner's ask, 2026-10-14): the trigger
 * and each step as a node, joined by curves, on a dotted canvas you can pan
 * and zoom. Opened by a workflow card's View (WorkflowCards.tsx).
 *
 * Drawn in DEX's own tokens and line glyphs, light and dark. Smooth over
 * flashy: panning and zooming write the layer's transform straight to the
 * DOM (no React render per frame), and the only animation is the sheet
 * rising in.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { nextRunText, triggerText, type Workflow } from '../../../shared/workflows';
import { columnsFor, fitView, layoutGraph, NODE_H, NODE_W } from './layout';
import { KIND_LABEL, WfGlyph } from './glyphs';
import './workflows.css';

interface View { k: number; x: number; y: number }

const MIN_K = 0.25;
const MAX_K = 2;

export interface WorkflowGraphProps {
  workflow: Workflow;
  onClose: () => void;
  onRun?: () => void;
  /** Run now's state, from the card that opened this. */
  runState?: 'idle' | 'starting' | 'started' | 'failed';
}

export function WorkflowGraph({ workflow, onClose, onRun, runState = 'idle' }: WorkflowGraphProps): React.ReactElement {
  const canvasRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ k: 1, x: 0, y: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });

  const count = workflow.steps.length + 1;
  const cols = size.w ? columnsFor(size.w, count) : 1;
  const layout = useMemo(() => layoutGraph(count, cols), [count, cols]);

  const apply = useCallback(() => {
    const v = view.current;
    if (layerRef.current) layerRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    // The dots move with the canvas, so panning feels like moving a sheet.
    if (canvasRef.current) {
      canvasRef.current.style.backgroundPosition = `${v.x}px ${v.y}px`;
      canvasRef.current.style.backgroundSize = `${22 * v.k}px ${22 * v.k}px`;
    }
  }, []);

  const fit = useCallback(() => {
    if (!size.w) return;
    view.current = fitView(layout, size.w, size.h);
    apply();
  }, [layout, size, apply]);

  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // A new size (or column count) re-fits: the graph is always whole when it opens.
  useLayoutEffect(() => { fit(); }, [fit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === '0' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); fit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, fit]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    const v = view.current;
    const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
    // Keep the point under the cursor where it is.
    view.current = { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
    apply();
  }, [apply]);

  // Wheel pans (as a trackpad expects); Ctrl+wheel and pinch zoom.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
      } else {
        view.current = { ...view.current, x: view.current.x - e.deltaX, y: view.current.y - e.deltaY };
        apply();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, apply]);

  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    canvasRef.current?.classList.add('wfg__canvas--grab');
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    view.current = { ...view.current, x: view.current.x + e.clientX - d.x, y: view.current.y + e.clientY - d.y };
    d.x = e.clientX;
    d.y = e.clientY;
    apply();
  };
  const endDrag = () => {
    drag.current = null;
    canvasRef.current?.classList.remove('wfg__canvas--grab');
  };

  const zoomButton = (factor: number) => zoomAt(factor, size.w / 2, size.h / 2);
  const next = nextRunText(workflow, Date.now());
  const scheduled = workflow.trigger.kind !== 'manual';

  return createPortal(
    <div className="wfg" role="dialog" aria-modal="true" aria-label={`${workflow.name} — workflow`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wfg__sheet">
        <header className="wfg__head">
          <span className="wfg__head-icon"><WfGlyph name="flow" size={17} /></span>
          <div className="wfg__head-text">
            <h2 className="wfg__title">{workflow.name}</h2>
            <span className="wfg__sub">
              {triggerText(workflow.trigger)} · {workflow.steps.length} step{workflow.steps.length === 1 ? '' : 's'}
              {next ? ` · ${next}` : ''}
            </span>
          </div>
          {onRun && (
            <button type="button" className="wfg__run" onClick={onRun} disabled={runState === 'starting'}>
              <WfGlyph name={runState === 'started' ? 'check' : 'play'} size={14} />
              <span>{runState === 'starting' ? 'Starting…' : runState === 'started' ? 'Started' : 'Run now'}</span>
            </button>
          )}
          <button type="button" className="wfg__icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)"><WfGlyph name="close" /></button>
        </header>
        {workflow.description && <p className="wfg__desc">{workflow.description}</p>}
        <div
          ref={canvasRef}
          className="wfg__canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={fit}
        >
          <div ref={layerRef} className="wfg__layer" style={{ width: layout.width, height: layout.height }}>
            <svg className="wfg__edges" width={layout.width} height={layout.height} aria-hidden="true">
              {layout.edges.map((e) => <path key={e.from} d={e.d} className="wfg__edge" />)}
            </svg>
            {layout.nodes.map((n, i) => {
              const style = { left: n.x, top: n.y, width: NODE_W, height: NODE_H };
              if (i === 0) {
                return (
                  <div key="trigger" className="wfg__node wfg__node--trigger" style={style}>
                    <span className="wfg__node-icon"><WfGlyph name={scheduled ? 'clock' : 'play'} size={17} /></span>
                    <div className="wfg__node-text">
                      <span className="wfg__node-kind">{scheduled ? 'Schedule' : 'Start'}</span>
                      <span className="wfg__node-title">{triggerText(workflow.trigger)}</span>
                    </div>
                  </div>
                );
              }
              const s = workflow.steps[i - 1];
              return (
                <div key={s.id} className="wfg__node" style={style} title={s.prompt ?? s.detail ?? s.title}>
                  <span className="wfg__node-icon"><WfGlyph name={s.kind} size={17} /></span>
                  <div className="wfg__node-text">
                    <span className="wfg__node-kind">{i} · {KIND_LABEL[s.kind]}</span>
                    <span className="wfg__node-title">{s.title}</span>
                    {s.detail && <span className="wfg__node-detail">{s.detail}</span>}
                  </div>
                </div>
              );
            })}
            {/* n8n's connection points, on top of the nodes' edges: hollow where a curve leaves, filled where it arrives. */}
            <svg className="wfg__dots" width={layout.width} height={layout.height} aria-hidden="true">
              {layout.edges.map((e) => (
                <g key={e.from}>
                  <circle cx={e.start[0]} cy={e.start[1]} r="4" className="wfg__dot" />
                  <circle cx={e.end[0]} cy={e.end[1]} r="4" className="wfg__dot wfg__dot--in" />
                </g>
              ))}
            </svg>
          </div>
          <div className="wfg__controls" onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" className="wfg__icon-btn" onClick={() => zoomButton(1.2)} aria-label="Zoom in" title="Zoom in (Ctrl+wheel)"><WfGlyph name="plus" /></button>
            <button type="button" className="wfg__icon-btn" onClick={() => zoomButton(1 / 1.2)} aria-label="Zoom out" title="Zoom out"><WfGlyph name="minus" /></button>
            <button type="button" className="wfg__icon-btn" onClick={fit} aria-label="Fit to view" title="Fit (Ctrl+0)"><WfGlyph name="fit" /></button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
