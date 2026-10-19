// @vitest-environment jsdom
/**
 * Gen-UI beyond the kit (shared/genui.ts): charts the hub draws itself, and
 * agent-written views in a sandbox. Asked for "a hexagon graph of my
 * personality", an agent sent a PNG; now it's a radar in the chat.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetView } from '../../../../src/renderer/hub/chat/Widgets';
import { parseWidget, type Widget } from '../../../../src/shared/widgets';
import { chartMax, customDocument, DEX_TOKENS, type DexTokens } from '../../../../src/shared/genui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ok = (raw: unknown, hint?: { type?: string }): Widget => {
  const { widget, error } = parseWidget(raw, hint);
  if (!widget) throw new Error(error);
  return widget;
};

describe('reading the charts agents write', () => {
  it('takes a hexagon as a plain map of scores', () => {
    const w = ok({ type: 'hexagon', title: 'Your personality', scores: { 'Problem-solving': 9, Learning: 9, Craft: 8, Leadership: 7, Creativity: 7, Communication: 6 }, outOf: 10 });
    expect(w).toMatchObject({ type: 'chart', kind: 'radar', max: 10, labels: ['Problem-solving', 'Learning', 'Craft', 'Leadership', 'Creativity', 'Communication'] });
    if (w.type === 'chart') expect(w.series[0].values).toEqual([9, 9, 8, 7, 7, 6]);
  });

  it('takes rows, Chart.js datasets, and kinds by other names', () => {
    expect(ok({ chartType: 'doughnut', data: [{ label: 'Rent', value: '40%' }, { label: 'Food', value: 25 }] }, { type: 'chart' })).toMatchObject({ kind: 'donut', labels: ['Rent', 'Food'], series: [{ values: [40, 25] }] });
    expect(ok({ type: 'chart', kind: 'column', labels: ['Mon', 'Tue'], datasets: [{ label: 'This week', data: [3, 5] }, { label: 'Last', data: [2, 4] }] }))
      .toMatchObject({ kind: 'bar', series: [{ name: 'This week', values: [3, 5] }, { name: 'Last', values: [2, 4] }] });
  });

  it('says what to fix when the spec does not fit', () => {
    const { error } = parseWidget({ type: 'chart', kind: 'radar', labels: ['A', 'B', 'C'], series: [{ values: [1, 2] }] });
    expect(error).toMatch(/one value per label/);
    expect(parseWidget({ type: 'chart', kind: 'radar', labels: ['A', 'B'], series: [{ values: [1, 2] }] }).error).toMatch(/at least 3 axes/);
  });

  it('scales to the data when no max is given', () => {
    const w = ok({ type: 'chart', kind: 'bar', labels: ['a', 'b'], series: [{ values: [37, 12] }] });
    expect(w.type === 'chart' && chartMax(w)).toBe(40);
  });
});

describe('drawing them, and agent-written views', () => {
  let host: HTMLDivElement;
  let root: Root;
  const onReply = vi.fn();
  const onOpenUrl = vi.fn();
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); onReply.mockReset(); onOpenUrl.mockReset(); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const render = (w: Widget) => act(() => root.render(<WidgetView widget={w} answered={false} onReply={onReply} onOpenUrl={onOpenUrl} />));

  it('draws a radar with one corner per label and the scores beside them', () => {
    render(ok({ type: 'chart', kind: 'radar', title: 'Strengths', labels: ['A', 'B', 'C', 'D', 'E', 'F'], series: [{ values: [9, 8, 7, 6, 5, 4] }], max: 10 }));
    const shape = host.querySelector('.cx-chart__radar polygon')!;
    expect(shape.getAttribute('points')!.split(' ')).toHaveLength(6);
    expect(host.querySelectorAll('.cx-chart__grid')).toHaveLength(4);
    expect(host.textContent).toContain('Strengths');
    expect(host.querySelector('.cx-chart__label')?.textContent).toBe('A 9');
  });

  it('draws bars, a donut with shares, and a gauge', () => {
    render(ok({ type: 'chart', kind: 'bar', labels: ['x', 'y', 'z'], series: [{ values: [1, 2, 3] }] }));
    expect(host.querySelectorAll('.cx-chart__bar')).toHaveLength(3);
    render(ok({ type: 'chart', kind: 'donut', labels: ['a', 'b'], series: [{ values: [3, 1] }] }));
    expect(host.querySelectorAll('.cx-chart__slice')).toHaveLength(2);
    expect(host.textContent).toContain('75%');
    render(ok({ type: 'chart', kind: 'gauge', labels: ['Battery'], series: [{ values: [72] }], max: 100, unit: '%' }));
    expect(host.querySelector('.cx-chart__big')?.textContent).toBe('72%');
  });

  it('runs a custom view in a frame that may only run scripts, in DEX colours', () => {
    render(ok({ type: 'custom', title: 'Pick a slot', html: '<button>10:00</button>' }));
    const frame = host.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    const doc = frame.getAttribute('srcdoc')!;
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain('--dex-accent:');
    expect(doc).toContain('<button>10:00</button>');
  });

  it('acts only on messages from its own frame', () => {
    render(ok({ type: 'custom', html: '<p>hi</p>' }));
    const frame = host.querySelector('iframe')!;
    const id = /var id="([^"]+)"/.exec(frame.getAttribute('srcdoc')!)![1];
    const send = (data: unknown, source: unknown) => act(() => { window.dispatchEvent(new MessageEvent('message', { data, source: source as MessageEventSource })); });
    send({ dexFrame: id, kind: 'reply', text: 'Book 10:00' }, window); // not the frame
    expect(onReply).not.toHaveBeenCalled();
    send({ dexFrame: id, kind: 'reply', text: 'Book 10:00' }, frame.contentWindow);
    expect(onReply).toHaveBeenCalledWith('Book 10:00');
    send({ dexFrame: id, kind: 'open', url: 'javascript:alert(1)' }, frame.contentWindow);
    send({ dexFrame: id, kind: 'open', url: 'https://example.com' }, frame.contentWindow);
    expect(onOpenUrl).toHaveBeenCalledTimes(1);
    send({ dexFrame: id, kind: 'height', height: 420 }, frame.contentWindow);
    expect(frame.style.height).toBe('420px');
  });

  it('documents every token it injects', () => {
    const tokens = Object.fromEntries(DEX_TOKENS.map((k) => [k, '#123'])) as DexTokens;
    const doc = customDocument('<p/>', tokens, 'f1');
    for (const k of DEX_TOKENS) expect(doc).toContain(`--dex-${k}:#123;`);
  });
});
