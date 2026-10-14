/**
 * Where each node of a workflow's graph goes (WorkflowGraph.tsx; the phone's
 * WorkflowGraph.kt mirrors it). The trigger first, then the steps in order,
 * laid out like a snake: left to right, down, right to left, down… so twenty
 * steps stay readable on a screen instead of shrinking into one long line.
 * One column on narrow screens.
 */

export const NODE_W = 232;
export const NODE_H = 84;
export const GAP_X = 64;
export const GAP_Y = 64;

export interface NodeBox { x: number; y: number; row: number; col: number }
export interface Edge {
  from: number;
  to: number;
  d: string;
  /** The side of the next node it enters. */
  enters: 'left' | 'right' | 'top';
  /** Where it leaves and arrives: the connection dots. */
  start: [number, number];
  end: [number, number];
}
export interface GraphLayout { nodes: NodeBox[]; edges: Edge[]; width: number; height: number; cols: number }

/** How many nodes fit side by side in `width` pixels: 1 to 4. */
export function columnsFor(width: number, count: number): number {
  const fit = Math.floor((width - 96 + GAP_X) / (NODE_W + GAP_X));
  return Math.max(1, Math.min(4, fit, count));
}

export function layoutGraph(count: number, cols: number): GraphLayout {
  const c = Math.max(1, Math.min(cols, count));
  const nodes: NodeBox[] = [];
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / c);
    const pos = i % c;
    const col = row % 2 === 0 ? pos : c - 1 - pos;
    nodes.push({ x: col * (NODE_W + GAP_X), y: row * (NODE_H + GAP_Y), row, col });
  }
  const edges: Edge[] = [];
  for (let i = 0; i + 1 < count; i += 1) {
    const a = nodes[i];
    const b = nodes[i + 1];
    if (a.row === b.row) {
      const right = b.col > a.col;
      const x1 = right ? a.x + NODE_W : a.x;
      const x2 = right ? b.x : b.x + NODE_W;
      const y = a.y + NODE_H / 2;
      const k = Math.abs(x2 - x1) / 2;
      const d = `M ${x1} ${y} C ${x1 + (right ? k : -k)} ${y}, ${x2 + (right ? -k : k)} ${y}, ${x2} ${y}`;
      edges.push({ from: i, to: i + 1, d, enters: right ? 'left' : 'right', start: [x1, y], end: [x2, y] });
    } else {
      const x = a.x + NODE_W / 2;
      const y1 = a.y + NODE_H;
      const y2 = b.y;
      const k = (y2 - y1) / 2;
      edges.push({ from: i, to: i + 1, d: `M ${x} ${y1} C ${x} ${y1 + k}, ${x} ${y2 - k}, ${x} ${y2}`, enters: 'top', start: [x, y1], end: [x, y2] });
    }
  }
  const rows = count ? nodes[count - 1].row + 1 : 0;
  return {
    nodes,
    edges,
    width: c * NODE_W + (c - 1) * GAP_X,
    height: rows * NODE_H + Math.max(0, rows - 1) * GAP_Y,
    cols: c,
  };
}

/** The scale and offset that fit the whole graph in a view, never larger than life. */
export function fitView(layout: Pick<GraphLayout, 'width' | 'height'>, viewW: number, viewH: number, pad = 48): { k: number; x: number; y: number } {
  const k = Math.min(1, (viewW - pad * 2) / Math.max(1, layout.width), (viewH - pad * 2) / Math.max(1, layout.height));
  const scale = Math.max(0.25, k);
  return { k: scale, x: (viewW - layout.width * scale) / 2, y: (viewH - layout.height * scale) / 2 };
}
