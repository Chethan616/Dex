/**
 * The chart widget (shared/genui.ts): radar, bar, line, area, pie, donut and
 * gauge, drawn as SVG in the hub's own colours (widgets.css `.cx-chart`), so
 * "a hexagon graph of my personality" is a real chart in the chat, not a PNG.
 * The phone draws the same specs (ui/components/Chart.kt).
 */
import React, { useState } from 'react';
import { chartMax, type ChartWidget } from '../../../shared/genui';
import './chart.css';

const fmt = (n: number): string => (Math.abs(n) >= 100 || Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(1));
const S = (i: number): string => `var(--cx-series-${(i % 4) + 1})`;

function Legend({ w }: { w: ChartWidget }): React.ReactElement | null {
  if (w.series.length < 2) return null;
  return (
    <div className="cx-chart__legend">
      {w.series.map((s, i) => <span key={i}><i style={{ background: S(i) }} />{s.name ?? `Series ${i + 1}`}</span>)}
    </div>
  );
}

function Radar({ w }: { w: ChartWidget }): React.ReactElement {
  const n = w.labels.length;
  const max = chartMax(w);
  const C = 200, R = 132;
  const pt = (i: number, f: number): [number, number] => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [C + Math.cos(a) * R * f, C + Math.sin(a) * R * f];
  };
  const ring = (f: number): string => w.labels.map((_, i) => pt(i, f).join(',')).join(' ');
  return (
    <svg className="cx-chart__svg cx-chart__svg--radar" viewBox="0 0 400 400" role="img" aria-label={w.title ?? 'Radar chart'}>
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} className="cx-chart__grid" points={ring(f)} />)}
      {w.labels.map((_, i) => { const [x, y] = pt(i, 1); return <line key={i} className="cx-chart__axis" x1={C} y1={C} x2={x} y2={y} />; })}
      {w.series.map((s, si) => (
        <g key={si} className="cx-chart__radar" style={{ ['--c' as string]: S(si), animationDelay: `${si * 90}ms` }}>
          <polygon points={s.values.map((v, i) => pt(i, Math.max(0, Math.min(1, v / max))).join(',')).join(' ')} />
          {s.values.map((v, i) => {
            const [x, y] = pt(i, Math.max(0, Math.min(1, v / max)));
            return <circle key={i} cx={x} cy={y} r="4.5"><title>{`${w.labels[i]}: ${fmt(v)}${w.unit ?? ''}`}</title></circle>;
          })}
        </g>
      ))}
      {w.labels.map((l, i) => {
        const [x, y] = pt(i, 1.18);
        const anchor = Math.abs(x - C) < 8 ? 'middle' : x > C ? 'start' : 'end';
        const v = w.series.length === 1 ? ` ${fmt(w.series[0].values[i])}` : '';
        return (
          <text key={i} className="cx-chart__label" x={x} y={y} textAnchor={anchor} dy="0.35em">
            {l}{v && <tspan className="cx-chart__value">{v}</tspan>}
          </text>
        );
      })}
    </svg>
  );
}

function Bars({ w }: { w: ChartWidget }): React.ReactElement {
  const max = chartMax(w);
  const W = 640, H = 300, L = 40, B = 46, T = 18;
  const n = w.labels.length, k = w.series.length;
  const band = (W - L - 8) / n;
  const bw = Math.min(46, (band * 0.72) / k);
  return (
    <svg className="cx-chart__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={w.title ?? 'Bar chart'}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = H - B - f * (H - B - T);
        return <g key={f}><line className="cx-chart__grid" x1={L} x2={W - 8} y1={y} y2={y} /><text className="cx-chart__tick" x={L - 8} y={y} textAnchor="end" dy="0.35em">{fmt(max * f)}</text></g>;
      })}
      {w.labels.map((l, i) => {
        const x0 = L + i * band + (band - bw * k) / 2;
        return (
          <g key={i}>
            {w.series.map((s, si) => {
              const v = s.values[i];
              const h = Math.max(0, (v / max) * (H - B - T));
              return (
                <g key={si}>
                  <rect className="cx-chart__bar" x={x0 + si * bw} y={H - B - h} width={bw - 3} height={h} rx="5" style={{ fill: S(si), animationDelay: `${i * 40}ms` }}><title>{`${l}: ${fmt(v)}${w.unit ?? ''}`}</title></rect>
                  {k === 1 && <text className="cx-chart__value" x={x0 + bw / 2 - 1.5} y={H - B - h - 6} textAnchor="middle">{fmt(v)}</text>}
                </g>
              );
            })}
            <text className="cx-chart__label" x={L + i * band + band / 2} y={H - B + 20} textAnchor="middle">{l.length > 14 ? `${l.slice(0, 13)}…` : l}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Lines({ w, area }: { w: ChartWidget; area: boolean }): React.ReactElement {
  const max = chartMax(w);
  const W = 640, H = 300, L = 40, B = 46, T = 18, Rt = 16;
  const n = w.labels.length;
  const x = (i: number): number => L + (n === 1 ? (W - L - Rt) / 2 : (i / (n - 1)) * (W - L - Rt));
  const y = (v: number): number => H - B - (Math.max(0, v) / max) * (H - B - T);
  return (
    <svg className="cx-chart__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={w.title ?? 'Line chart'}>
      <defs>{w.series.map((_, si) => (
        <linearGradient key={si} id={`cxg-${si}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={S(si)} stopOpacity="0.32" /><stop offset="1" stopColor={S(si)} stopOpacity="0" /></linearGradient>
      ))}</defs>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const yy = H - B - f * (H - B - T);
        return <g key={f}><line className="cx-chart__grid" x1={L} x2={W - Rt} y1={yy} y2={yy} /><text className="cx-chart__tick" x={L - 8} y={yy} textAnchor="end" dy="0.35em">{fmt(max * f)}</text></g>;
      })}
      {w.series.map((s, si) => {
        const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
        return (
          <g key={si} className="cx-chart__series" style={{ ['--c' as string]: S(si) }}>
            {area && <path className="cx-chart__area" d={`${d} L${x(n - 1)} ${H - B} L${x(0)} ${H - B} Z`} fill={`url(#cxg-${si})`} />}
            <path className="cx-chart__line" d={d} pathLength={1} />
            {s.values.map((v, i) => <circle key={i} className="cx-chart__dot" cx={x(i)} cy={y(v)} r="4"><title>{`${w.labels[i]}: ${fmt(v)}${w.unit ?? ''}`}</title></circle>)}
          </g>
        );
      })}
      {w.labels.map((l, i) => (n <= 12 || i % Math.ceil(n / 12) === 0) && <text key={i} className="cx-chart__label" x={x(i)} y={H - B + 20} textAnchor="middle">{l.length > 10 ? `${l.slice(0, 9)}…` : l}</text>)}
    </svg>
  );
}

function Pie({ w, hole }: { w: ChartWidget; hole: boolean }): React.ReactElement {
  const vals = w.series[0].values.map((v) => Math.max(0, v));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const [hover, setHover] = useState<number | null>(null);
  const C = 120, R = 104, r = hole ? 62 : 0;
  let a0 = -Math.PI / 2;
  const arc = (a1: number, a2: number): string => {
    const big = a2 - a1 > Math.PI ? 1 : 0;
    const p = (a: number, rr: number): string => `${(C + Math.cos(a) * rr).toFixed(2)} ${(C + Math.sin(a) * rr).toFixed(2)}`;
    return r
      ? `M${p(a1, R)} A${R} ${R} 0 ${big} 1 ${p(a2, R)} L${p(a2, r)} A${r} ${r} 0 ${big} 0 ${p(a1, r)} Z`
      : `M${C} ${C} L${p(a1, R)} A${R} ${R} 0 ${big} 1 ${p(a2, R)} Z`;
  };
  return (
    <div className="cx-chart__pie">
      <svg className="cx-chart__svg cx-chart__svg--pie" viewBox="0 0 240 240" role="img" aria-label={w.title ?? 'Pie chart'}>
        {vals.map((v, i) => {
          const a1 = a0, a2 = a0 + (v / total) * Math.PI * 2 - (vals.length > 1 ? 0.012 : 0);
          a0 += (v / total) * Math.PI * 2;
          if (v <= 0) return null;
          return <path key={i} className={`cx-chart__slice${hover === i ? ' cx-chart__slice--on' : ''}`} d={arc(a1, Math.max(a1 + 0.001, a2))} style={{ fill: S(i), animationDelay: `${i * 60}ms` }} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}><title>{`${w.labels[i]}: ${fmt(v)}${w.unit ?? ''}`}</title></path>;
        })}
        {hole && (
          <text className="cx-chart__center" x={C} y={C} textAnchor="middle" dy="0.35em">
            {hover === null ? fmt(total) : `${Math.round((vals[hover] / total) * 100)}%`}
          </text>
        )}
      </svg>
      <ul className="cx-chart__keys">
        {w.labels.map((l, i) => (
          <li key={i} className={hover === i ? 'is-on' : undefined} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <i style={{ background: S(i) }} /><span>{l}</span><b>{fmt(vals[i])}{w.unit ?? ''}</b><em>{Math.round((vals[i] / total) * 100)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Gauge({ w }: { w: ChartWidget }): React.ReactElement {
  const v = w.series[0].values[0];
  const max = chartMax(w);
  const f = Math.max(0, Math.min(1, v / max));
  const C = 150, R = 110;
  const p = (a: number): string => `${(C + Math.cos(a) * R).toFixed(2)} ${(C + Math.sin(a) * R).toFixed(2)}`;
  const end = Math.PI + f * Math.PI;
  return (
    <svg className="cx-chart__svg cx-chart__svg--gauge" viewBox="0 0 300 180" role="img" aria-label={w.title ?? 'Gauge'}>
      <path className="cx-chart__track" d={`M${p(Math.PI)} A${R} ${R} 0 0 1 ${p(0)}`} />
      <path className="cx-chart__meter" d={`M${p(Math.PI)} A${R} ${R} 0 0 1 ${p(end)}`} pathLength={1} />
      <text className="cx-chart__big" x={C} y={C - 18} textAnchor="middle">{fmt(v)}<tspan className="cx-chart__unit">{w.unit ?? (w.max ? ` / ${fmt(max)}` : '')}</tspan></text>
      <text className="cx-chart__label" x={C} y={C + 14} textAnchor="middle">{w.labels[0]}</text>
    </svg>
  );
}

export function ChartView({ widget: w }: { widget: ChartWidget }): React.ReactElement {
  return (
    <div className={`cx-chart cx-chart--${w.kind}`}>
      {(w.title || w.note) && (
        <div className="cx-chart__head">
          {w.title && <span className="cx-chart__title">{w.title}</span>}
          {w.note && <span className="cx-chart__note">{w.note}</span>}
        </div>
      )}
      <div className="cx-chart__body">
        {w.kind === 'radar' && <Radar w={w} />}
        {w.kind === 'bar' && <Bars w={w} />}
        {(w.kind === 'line' || w.kind === 'area') && <Lines w={w} area={w.kind === 'area'} />}
        {(w.kind === 'pie' || w.kind === 'donut') && <Pie w={w} hole={w.kind === 'donut'} />}
        {w.kind === 'gauge' && <Gauge w={w} />}
      </div>
      <Legend w={w} />
    </div>
  );
}
