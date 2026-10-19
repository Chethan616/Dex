/**
 * Settings › Memory's graph: what DEX knows, as the things it's about and how
 * they link (shared/memoryGraph.ts). A force layout computed once per graph
 * (seeded, so it's the same each time), coloured by dimension, sized by links.
 * Hover lights a node's neighbours; click opens what DEX knows about it; drag
 * pans, the wheel zooms; the search and the dimension chips pick nodes out.
 */
import React, { useMemo, useRef, useState } from 'react';
import { DIMENSION_LABELS, type Dimension, type GraphNode, type MemoryGraph } from '../../shared/memoryGraph';

const W = 900;
const H = 560;

interface Placed { node: GraphNode; x: number; y: number; r: number }

function seeded(seed: number): () => number {
  let s = seed % 2147483647 || 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

/**
 * A few hundred steps of a simple force simulation: charge, springs, and a
 * pull towards a sector per dimension around the middle, so people, places,
 * work, studies and the rest each gather in their own part of the picture.
 * The best-linked node (the person themselves) is pinned in the middle.
 */
export function layout(g: MemoryGraph): Placed[] {
  const rnd = seeded(g.nodes.length * 31 + g.edges.length * 7 + 11);
  const maxDeg = Math.max(1, ...g.nodes.map((n) => n.degree ?? 0));
  const hub = [...g.nodes].sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))[0]?.id;
  const dims = [...new Set(g.nodes.filter((n) => n.id !== hub).map((n) => n.dimension))];
  const sector = new Map(dims.map((d, i) => [d, { x: W / 2 + Math.cos((i / dims.length) * Math.PI * 2 - Math.PI / 2) * W * 0.32, y: H / 2 + Math.sin((i / dims.length) * Math.PI * 2 - Math.PI / 2) * H * 0.36 }]));
  const P = g.nodes.map((node) => {
    const c = node.id === hub ? { x: W / 2, y: H / 2 } : sector.get(node.dimension)!;
    return { node, x: c.x + (rnd() - 0.5) * 90, y: c.y + (rnd() - 0.5) * 90, vx: 0, vy: 0, r: 5 + 13 * Math.sqrt((node.degree ?? 0) / maxDeg) };
  });
  const idx = new Map(P.map((p, i) => [p.node.id, i]));
  const links = g.edges.map((e) => [idx.get(e.from), idx.get(e.to)] as const).filter((l): l is readonly [number, number] => l[0] !== undefined && l[1] !== undefined);
  const steps = P.length > 120 ? 240 : 340;
  for (let s = 0; s < steps; s++) {
    const t = 1 - s / steps;
    for (let i = 0; i < P.length; i++) {
      for (let j = i + 1; j < P.length; j++) {
        const dx = P[j].x - P[i].x || 0.01, dy = P[j].y - P[i].y || 0.01;
        const d2 = dx * dx + dy * dy;
        const f = (2600 / Math.max(60, d2)) * (0.3 + t);
        const d = Math.sqrt(d2);
        P[i].vx -= (dx / d) * f; P[i].vy -= (dy / d) * f;
        P[j].vx += (dx / d) * f; P[j].vy += (dy / d) * f;
      }
    }
    for (const [a, b] of links) {
      const hubLink = P[a].node.id === hub || P[b].node.id === hub;
      const dx = P[b].x - P[a].x, dy = P[b].y - P[a].y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      // Links to the hub are loose, so it doesn't drag every group into the middle.
      const f = (d - (hubLink ? 170 : 55)) * (hubLink ? 0.004 : 0.03) * (0.3 + t);
      P[a].vx += (dx / d) * f; P[a].vy += (dy / d) * f;
      P[b].vx -= (dx / d) * f; P[b].vy -= (dy / d) * f;
    }
    for (const p of P) {
      if (p.node.id === hub) { p.x = W / 2; p.y = H / 2; p.vx = 0; p.vy = 0; continue; }
      const c = sector.get(p.node.dimension)!;
      p.vx += (c.x - p.x) * 0.012;
      p.vy += (c.y - p.y) * 0.012;
      p.x += Math.max(-14, Math.min(14, p.vx)); p.y += Math.max(-14, Math.min(14, p.vy));
      p.vx *= 0.55; p.vy *= 0.55;
      p.x = Math.max(28, Math.min(W - 28, p.x)); p.y = Math.max(28, Math.min(H - 28, p.y));
    }
  }
  return P.map(({ node, x, y, r }) => ({ node, x, y, r }));
}

export function MemoryGraphView({ graph, query, noteText }: {
  graph: MemoryGraph;
  query: string;
  noteText: (id: string) => string | undefined;
}): React.ReactElement {
  const placed = useMemo(() => layout(graph), [graph]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.node.id, p])), [placed]);
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>(graph.nodes.map((n) => [n.id, new Set<string>()]));
    for (const e of graph.edges) { m.get(e.from)?.add(e.to); m.get(e.to)?.add(e.from); }
    return m;
  }, [graph]);
  const dims = useMemo(() => [...new Set(graph.nodes.map((n) => n.dimension))], [graph]);
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [only, setOnly] = useState<Dimension | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    return new Set(graph.nodes.filter((n) => `${n.label} ${n.summary ?? ''} ${n.notes.map((id) => noteText(id) ?? '').join(' ')}`.toLowerCase().includes(q)).map((n) => n.id));
  }, [graph, q, noteText]);
  const focus = hover ?? picked;
  const lit = (id: string): boolean => {
    if (only && byId.get(id)?.node.dimension !== only) return false;
    if (matches && !matches.has(id)) return false;
    if (focus) return id === focus || Boolean(neighbours.get(focus)?.has(id));
    return true;
  };
  const sel = picked ? byId.get(picked)?.node : null;
  const toLocal = (e: React.WheelEvent | React.PointerEvent): { x: number; y: number } => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  return (
    <div className="mg">
      <div className="mg__chips" role="group" aria-label="Show one kind">
        {dims.map((d) => (
          <button key={d} type="button" className={`mg__chip mg-d--${d}`} aria-pressed={only === d} onClick={() => setOnly(only === d ? null : d)}>
            <i aria-hidden="true" />{DIMENSION_LABELS[d]}<b>{graph.nodes.filter((n) => n.dimension === d).length}</b>
          </button>
        ))}
      </div>
      <div className="mg__stage">
        <svg
          ref={svg}
          className="mg__svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`DEX's memory: ${graph.nodes.length} things, ${graph.edges.length} links`}
          onWheel={(e) => {
            const p = toLocal(e);
            const k = Math.max(0.5, Math.min(3, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
            setView({ k, x: p.x - ((p.x - view.x) * k) / view.k, y: p.y - ((p.y - view.y) * k) / view.k });
          }}
          onPointerDown={(e) => { if ((e.target as Element).closest('.mg__node')) return; drag.current = { ...toLocal(e), vx: view.x, vy: view.y }; (e.target as Element).setPointerCapture?.(e.pointerId); }}
          onPointerMove={(e) => { if (!drag.current) return; const p = toLocal(e); setView((v) => ({ ...v, x: drag.current!.vx + p.x - drag.current!.x, y: drag.current!.vy + p.y - drag.current!.y })); }}
          onPointerUp={() => { drag.current = null; }}
          onClick={(e) => { if (!(e.target as Element).closest('.mg__node')) setPicked(null); }}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {graph.edges.map((e, i) => {
              const a = byId.get(e.from), b = byId.get(e.to);
              if (!a || !b) return null;
              const on = lit(e.from) && lit(e.to);
              const hot = focus && (e.from === focus || e.to === focus);
              return <line key={i} className={`mg__edge${on ? '' : ' mg__edge--dim'}${hot ? ' mg__edge--hot' : ''}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}><title>{`${a.node.label} — ${e.label} — ${b.node.label}`}</title></line>;
            })}
            {placed.map((p) => {
              const on = lit(p.node.id);
              const showLabel = p.r > 10 || p.node.id === focus || (focus && neighbours.get(focus)?.has(p.node.id)) || (matches?.has(p.node.id) ?? false);
              return (
                <g
                  key={p.node.id}
                  className={`mg__node mg-d--${p.node.dimension}${on ? '' : ' mg__node--dim'}${picked === p.node.id ? ' mg__node--on' : ''}`}
                  transform={`translate(${p.x} ${p.y})`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${p.node.label}, ${DIMENSION_LABELS[p.node.dimension]}, ${p.node.degree ?? 0} links`}
                  onMouseEnter={() => setHover(p.node.id)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(p.node.id)}
                  onBlur={() => setHover(null)}
                  onClick={() => setPicked(picked === p.node.id ? null : p.node.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPicked(p.node.id); } }}
                >
                  <circle className="mg__halo" r={p.r + 5} />
                  <circle className="mg__dot" r={p.r} />
                  {showLabel && <text className="mg__label" y={p.r + 14} textAnchor="middle">{p.node.label.length > 26 ? `${p.node.label.slice(0, 25)}…` : p.node.label}</text>}
                </g>
              );
            })}
          </g>
        </svg>
        <div className="mg__hint">Drag to move · scroll to zoom · click a dot</div>
        {sel && (
          <aside className="mg__panel" aria-label={sel.label}>
            <div className="mg__panel-head">
              <span className={`mg__panel-dot mg-d--${sel.dimension}`} aria-hidden="true" />
              <div>
                <div className="mg__panel-title">{sel.label}</div>
                <div className="mg__panel-sub">{DIMENSION_LABELS[sel.dimension]} · {sel.degree ?? 0} links{sel.community !== undefined && graph.communities[sel.community] ? ` · in “${graph.communities[sel.community].label}”` : ''}</div>
              </div>
              <button type="button" className="mg__panel-x" aria-label="Close" onClick={() => setPicked(null)}>×</button>
            </div>
            {sel.summary && <p className="mg__panel-sum">{sel.summary}</p>}
            {(neighbours.get(sel.id)?.size ?? 0) > 0 && (
              <div className="mg__panel-block">
                <div className="mg__panel-label">Linked to</div>
                <div className="mg__panel-links">
                  {[...neighbours.get(sel.id)!].map((id) => {
                    const n = byId.get(id)!.node;
                    const e = graph.edges.find((x) => (x.from === sel.id && x.to === id) || (x.to === sel.id && x.from === id));
                    return <button key={id} type="button" className={`mg__link mg-d--${n.dimension}`} onClick={() => setPicked(id)}><i aria-hidden="true" />{e?.label ? <em>{e.label}</em> : null}{n.label}</button>;
                  })}
                </div>
              </div>
            )}
            {sel.notes.length > 0 && (
              <div className="mg__panel-block">
                <div className="mg__panel-label">From what you told DEX</div>
                <ul className="mg__panel-notes">{sel.notes.map((id) => noteText(id)).filter(Boolean).slice(0, 6).map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
