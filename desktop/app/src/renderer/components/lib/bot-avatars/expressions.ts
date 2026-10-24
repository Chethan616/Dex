/*
 * Expressive faces for DEX's bot avatars.
 *
 * Replaces bot-avatars' stock face (two capsule strokes and a cup mouth) with
 * a small face rig whose parts move independently:
 *
 *   eyes     glossy ovals with two catchlights, eased open/shut by the blink
 *   lids     a top and a bottom lid that cut the eye: smiling crescents,
 *            sleepy, focused (inner ends down), worried (inner ends up), sly
 *   brows    short soft arcs that lift, tilt and go asymmetric
 *   mouths   smile, open grin, flat, frown, "o", cat "w", tongue-out,
 *            cross-faded by weight
 *   extras   blush, a thinking swirl in the eyes, a happy/sad tear,
 *            puppy-eye shine with a double eyebrow-raise (needs you),
 *            a sleep bubble that swells and shrinks with the breath
 *
 * Every feature is placed through the library's head projection, so it
 * turns, foreshortens and hides with the head exactly as the stock face did.
 * An expression is a set of target numbers; the face eases toward it every
 * frame (or snaps when the avatar is still), so changes read as motion, not
 * swaps. The library's own motion still plays on top: blinks, glances, the
 * working laugh and the sleeping state.
 */

export type BotExpression =
  | 'neutral'
  | 'content'
  | 'happy'
  | 'laugh'
  | 'wink'
  | 'love'
  | 'thinking'
  | 'focused'
  | 'patient'
  | 'hopeful'
  | 'worried'
  | 'sad'
  | 'surprised'
  | 'confused'
  | 'sleepy'
  | 'listening';

export const botExpressions: BotExpression[] = [
  'neutral', 'content', 'happy', 'laugh', 'wink', 'love', 'thinking', 'focused',
  'patient', 'hopeful', 'worried', 'sad', 'surprised', 'confused', 'sleepy', 'listening',
];

interface FaceParams {
  /** how far each lid covers the eye, 0..1 */
  lidTop: number;
  lidBot: number;
  /** extra top lid on one side (a squint, a sly look) */
  lidTopL: number;
  lidTopR: number;
  /** > 0 lifts the lids' inner ends (worried), < 0 drops them (focused) */
  slant: number;
  scaleL: number;
  scaleR: number;
  /** ^ ^ arcs, a right-eye wink, closed ‿ arcs */
  happy: number;
  winkR: number;
  closed: number;
  swirl: number;
  brow: number;
  browLift: number;
  browLiftL: number;
  /** > 0 worried (inner ends up), < 0 cross or focused */
  browTilt: number;
  smile: number;
  grin: number;
  flat: number;
  frown: number;
  oh: number;
  cat: number;
  tongue: number;
  mouthW: number;
  mouthX: number;
  mouthTilt: number;
  blush: number;
  tear: number;
  /** big twinkling catchlights (puppy eyes) */
  shine: number;
  /** a double eyebrow-raise every couple of seconds: "hey, over here" */
  browBounce: number;
  /** a sleep bubble at the mouth, breathing in and out */
  bubble: number;
  /** extra gaze, in face units */
  lookX: number;
  lookY: number;
}

const BASE: FaceParams = {
  lidTop: 0, lidBot: 0, lidTopL: 0, lidTopR: 0, slant: 0, scaleL: 1, scaleR: 1,
  happy: 0, winkR: 0, closed: 0, swirl: 0,
  brow: 0, browLift: 0, browLiftL: 0, browTilt: 0,
  smile: 1, grin: 0, flat: 0, frown: 0, oh: 0, cat: 0, tongue: 0,
  mouthW: 1, mouthX: 0, mouthTilt: 0,
  blush: 0.4, tear: 0, shine: 0, browBounce: 0, bubble: 0, lookX: 0, lookY: 0,
};

const EXPRESSIONS: Record<BotExpression, Partial<FaceParams>> = {
  neutral: {},
  // At rest: smiling eyes (bottom lids up a touch), a soft smile, a little blush.
  content: { lidBot: 0.2, blush: 0.6 },
  // A finished task: ^ ^ eyes, an open grin, full blush.
  happy: { happy: 1, smile: 0, grin: 1, blush: 0.9 },
  laugh: { happy: 1, smile: 0, grin: 1, mouthW: 1.25, blush: 1, tear: 0.8, browLift: 2, brow: 0.5 },
  // A go-ahead: one eye shut, a lopsided smile, one brow up.
  wink: { winkR: 1, lidBot: 0.15, mouthW: 1.1, mouthX: 1.2, mouthTilt: -0.12, blush: 0.75, brow: 0.7, browLiftL: 3 },
  // Thanks: melting closed-eye smile, deep blush.
  love: { happy: 1, mouthW: 0.95, blush: 1 },
  // Reasoning: one eye squinting, a swirl in the eyes, one brow up, a sideways "hmm", eyes up.
  thinking: {
    lidTop: 0.04, lidTopR: 0.32, swirl: 1, brow: 1, browLiftL: 3.5, browTilt: -0.12,
    smile: 0, flat: 1, mouthW: 0.8, mouthX: 2.5, mouthTilt: -0.18, lookX: -1.2, lookY: -2.2,
  },
  // Working: lids down and angled in, focused brows, tongue out.
  focused: { lidTop: 0.3, slant: -0.22, brow: 0.95, browTilt: -0.24, browLift: -1, smile: 0, tongue: 1, blush: 0.25, lookY: 1 },
  // Waiting on the user's approval: calm and settled, never anxious.
  patient: { lidTop: 0.12, lidBot: 0.2, mouthW: 0.85, blush: 0.5, brow: 0.45, browLift: 1.5, browTilt: 0.06 },
  // Needs you: hopeful puppy eyes looking up at you, brows gently pleading,
  // a double eyebrow-raise now and then. Asking, not alarmed.
  hopeful: {
    scaleL: 1.12, scaleR: 1.12, shine: 1, brow: 0.9, browLift: 2.4, browTilt: 0.2, browBounce: 1,
    lidBot: 0.08, mouthW: 0.72, blush: 0.75, lookY: -0.8,
  },
  worried: { lidTop: 0.2, slant: 0.32, brow: 1, browTilt: 0.34, browLift: 1, smile: 0, frown: 0.55, flat: 0.45, mouthW: 0.8, blush: 0.2 },
  // A failed run: heavy worried lids, sad brows, a frown, a tear.
  sad: { lidTop: 0.32, slant: 0.36, brow: 1, browTilt: 0.38, smile: 0, frown: 1, blush: 0.15, tear: 1, lookY: 1.6 },
  surprised: { scaleL: 1.22, scaleR: 1.22, brow: 1, browLift: 4.5, smile: 0, oh: 1, blush: 0.25 },
  confused: { scaleL: 1.16, scaleR: 0.92, lidTopR: 0.24, brow: 1, browLiftL: 4, browTilt: -0.1, smile: 0, flat: 1, mouthX: 1.5, mouthTilt: 0.22 },
  sleepy: { closed: 1, smile: 0, oh: 0.75, mouthW: 0.7, blush: 0.3, bubble: 1 },
  // Mic open: wide eyes, brows up, a small attentive mouth.
  listening: { scaleL: 1.12, scaleR: 1.12, brow: 0.8, browLift: 3.2, smile: 0.55, oh: 0.45, mouthW: 0.8, blush: 0.45 },
};

export interface FaceState {
  cur?: FaceParams;
  last?: number;
}

/** The library's projector: places a feature on the head, with its alpha. */
type Project = (x: number, y: number, draw: () => void, alpha?: number) => void;

interface FacePose {
  w: [number, number, number];
  laugh: number;
  blinkL: number;
  blinkR: number;
  eyeOpen: number;
  lookX: number;
  lookY: number;
  pitch: number;
  breath: number;
  y: number;
}

interface FaceConfig {
  face: 'eyes' | 'mouth';
  ink: string;
  expression?: BotExpression;
  faceState?: FaceState;
  still?: boolean;
}

const TAU = Math.PI * 2;
const SPACING = 12.5; // half the eye spacing, as the stock face
// Strong enough to stay pink over any body colour (thinner pink goes grey on teal).
const BLUSH = 'rgba(255, 112, 150, A)';
const TONGUE = '#FF7D93';

function isDark(color: string): boolean {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return true;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(h, 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 128;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Ease the face's current numbers toward the expression's. */
function step(state: FaceState, expression: BotExpression, still: boolean): FaceParams {
  const target = { ...BASE, ...(EXPRESSIONS[expression] ?? {}) };
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (!state.cur || still) {
    state.cur = { ...target };
    state.last = now;
    return state.cur;
  }
  const dt = Math.min(0.1, Math.max(0, (now - (state.last ?? now)) / 1000));
  state.last = now;
  const k = 1 - Math.exp(-dt * 9);
  const cur = state.cur;
  for (const key of Object.keys(target) as (keyof FaceParams)[]) cur[key] += (target[key] - cur[key]) * k;
  return cur;
}

/** One eye: lids cut a glossy oval; collapses into a line when shut. */
function drawEye(
  t: CanvasRenderingContext2D,
  rx: number, ry: number, lidT: number, lidB: number, slant: number, inner: number,
  ink: string, hi: string, swirl: number, detail: boolean, now: number, shine = 0,
): void {
  const yT = -ry + 2 * ry * lidT;
  const yB = ry - 2 * ry * lidB;
  const topEdge = (x: number) => yT - slant * ry * 0.55 * (x / rx) * inner - (lidT > 0.02 ? 0.1 * ry * (1 - (x / rx) ** 2) : 0);
  const botEdge = (x: number) => yB - Math.min(1, lidB * 4) * 0.5 * ry * (1 - Math.min(1, (x / rx) ** 2));
  if (yB - yT < ry * 0.14) {
    const m = (yT + yB) / 2;
    t.beginPath();
    t.moveTo(-rx, m);
    t.quadraticCurveTo(0, m + ry * 0.3, rx, m);
    t.strokeStyle = ink;
    t.lineWidth = 3.4;
    t.lineCap = 'round';
    t.stroke();
    return;
  }
  const eye = new Path2D();
  eye.ellipse(0, 0, rx, ry, 0, 0, TAU);
  const W = rx * 1.5;
  const open = new Path2D();
  for (let i = 0; i <= 10; i += 1) {
    const x = -W + (2 * W * i) / 10;
    if (i === 0) open.moveTo(x, topEdge(x));
    else open.lineTo(x, topEdge(x));
  }
  for (let i = 10; i >= 0; i -= 1) {
    const x = -W + (2 * W * i) / 10;
    open.lineTo(x, botEdge(x));
  }
  open.closePath();

  t.save();
  t.clip(eye);
  t.clip(open);
  t.fillStyle = ink;
  t.fill(eye);
  // A soft gloss toward the light (top left), then the catchlights.
  const g = t.createRadialGradient(-rx * 0.35, -ry * 0.45, 0, -rx * 0.35, -ry * 0.45, ry * 1.1);
  g.addColorStop(0, hi === '#FFFFFF' ? 'rgba(120,128,180,0.45)' : 'rgba(0,0,0,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  t.fillStyle = g;
  t.fill(eye);
  t.fillStyle = hi;
  t.beginPath();
  t.arc(-rx * 0.3, -ry * 0.36, Math.max(1.6, rx * 0.36) * (1 + 0.45 * shine), 0, TAU);
  t.fill();
  if (detail || shine > 0.3) {
    t.save();
    t.globalAlpha *= 0.85;
    t.beginPath();
    t.arc(rx * 0.32, ry * 0.36, rx * 0.17 * (1 + 0.7 * shine), 0, TAU);
    t.fill();
    t.restore();
  }
  // Puppy-eye twinkle: a small four-point star that pulses by the catchlight.
  if (shine > 0.05) {
    const k = rx * 0.24 * shine * (0.75 + 0.25 * Math.sin(now / 280));
    t.save();
    t.translate(rx * 0.16, -ry * 0.6);
    t.beginPath();
    t.moveTo(0, -k);
    t.quadraticCurveTo(0, 0, k, 0);
    t.quadraticCurveTo(0, 0, 0, k);
    t.quadraticCurveTo(0, 0, -k, 0);
    t.quadraticCurveTo(0, 0, 0, -k);
    t.fill();
    t.restore();
  }
  if (swirl > 0.02 && detail) {
    t.save();
    t.globalAlpha *= swirl;
    t.rotate(-now / 260);
    t.strokeStyle = hi;
    t.lineWidth = 1.4;
    t.lineCap = 'round';
    t.beginPath();
    t.arc(0, ry * 0.12, rx * 0.5, 0, Math.PI * 1.45);
    t.stroke();
    t.restore();
  }
  t.restore();

  // Lid lines where a lid crosses the eye.
  if (detail && (lidT > 0.05 || lidB > 0.05)) {
    t.save();
    const rim = new Path2D();
    rim.ellipse(0, 0, rx * 1.12, ry * 1.06, 0, 0, TAU);
    t.clip(rim);
    t.strokeStyle = ink;
    t.lineCap = 'round';
    const edge = (fn: (x: number) => number, width: number) => {
      t.beginPath();
      for (let i = 0; i <= 10; i += 1) {
        const x = -rx * 1.1 + (2.2 * rx * i) / 10;
        if (i === 0) t.moveTo(x, fn(x));
        else t.lineTo(x, fn(x));
      }
      t.lineWidth = width;
      t.stroke();
    };
    if (lidT > 0.05) edge(topEdge, 2);
    if (lidB > 0.05) { t.globalAlpha *= 0.55; edge(botEdge, 1.4); }
    t.restore();
  }
}

/** Arc eyes: ^ (happy) or ‿ (asleep). */
function drawArcEye(t: CanvasRenderingContext2D, rx: number, ry: number, up: boolean, ink: string): void {
  t.beginPath();
  if (up) {
    t.moveTo(-rx * 0.95, ry * 0.25);
    t.quadraticCurveTo(0, -ry * 1.05, rx * 0.95, ry * 0.25);
  } else {
    t.moveTo(-rx, -ry * 0.05);
    t.quadraticCurveTo(0, ry * 0.6, rx, -ry * 0.05);
  }
  t.strokeStyle = ink;
  t.lineWidth = 4.2;
  t.lineCap = 'round';
  t.stroke();
}

function drawMouth(t: CanvasRenderingContext2D, f: FaceParams, w: Record<string, number>, ink: string, mouthFill: string): void {
  const W = f.mouthW;
  t.rotate(f.mouthTilt);
  t.lineCap = 'round';
  t.lineJoin = 'round';
  const withAlpha = (a: number, draw: () => void) => {
    if (a < 0.02) return;
    t.save();
    t.globalAlpha *= Math.min(1, a);
    draw();
    t.restore();
  };
  withAlpha(w.smile, () => {
    t.beginPath();
    t.moveTo(-5 * W, -1);
    t.quadraticCurveTo(0, 4.6, 5 * W, -1);
    t.strokeStyle = ink;
    t.lineWidth = 3.2;
    t.stroke();
  });
  withAlpha(w.grin, () => {
    const p = new Path2D();
    p.moveTo(-6.2 * W, -1.8);
    p.lineTo(6.2 * W, -1.8);
    p.quadraticCurveTo(0, 10.5, -6.2 * W, -1.8);
    p.closePath();
    t.fillStyle = mouthFill;
    t.fill(p);
    t.save();
    t.clip(p);
    t.fillStyle = TONGUE;
    t.beginPath();
    t.ellipse(0, 5.4, 3.8 * W, 2.6, 0, 0, TAU);
    t.fill();
    t.restore();
    t.strokeStyle = ink;
    t.lineWidth = 1.6;
    t.stroke(p);
  });
  withAlpha(w.flat, () => {
    t.beginPath();
    t.moveTo(-3.8 * W, 0.4);
    t.lineTo(3.8 * W, 0.4);
    t.strokeStyle = ink;
    t.lineWidth = 3.2;
    t.stroke();
  });
  withAlpha(w.frown, () => {
    t.beginPath();
    t.moveTo(-4.6 * W, 2.4);
    t.quadraticCurveTo(0, -2.8, 4.6 * W, 2.4);
    t.strokeStyle = ink;
    t.lineWidth = 3.2;
    t.stroke();
  });
  withAlpha(w.oh, () => {
    t.beginPath();
    t.ellipse(0, 1.2, 2.6 * W, 3.2, 0, 0, TAU);
    t.fillStyle = mouthFill;
    t.fill();
  });
  withAlpha(w.cat, () => {
    t.beginPath();
    t.moveTo(-4.8, -0.8);
    t.quadraticCurveTo(-2.4, 3, 0, -0.3);
    t.quadraticCurveTo(2.4, 3, 4.8, -0.8);
    t.strokeStyle = ink;
    t.lineWidth = 2.6;
    t.stroke();
  });
  withAlpha(w.tongue, () => {
    t.fillStyle = TONGUE;
    t.beginPath();
    t.ellipse(2.4, 2.2, 1.9, 2.3, 0, 0, TAU);
    t.fill();
    t.beginPath();
    t.moveTo(-3.6, 0.3);
    t.lineTo(3, 0.3);
    t.strokeStyle = ink;
    t.lineWidth = 3;
    t.stroke();
  });
}

/**
 * Draw the face. Called by the vendored bot-avatars renderer in face space
 * (the face's centre at the origin, design units, already clipped to the
 * body), with its projector.
 */
export function drawExpressiveFace(t: CanvasRenderingContext2D, e: FacePose, s: FaceConfig, project: Project): void {
  const state = s.faceState ?? {};
  const f = step(state, s.expression ?? 'neutral', Boolean(s.still));
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const [wDefault, wWork, wSleep] = e.w;
  const laugh = wWork * e.laugh;
  const ink = s.ink;
  const darkInk = isDark(ink);
  const hi = darkInk ? '#FFFFFF' : 'rgba(30,26,51,0.55)';
  const mouthFill = darkInk ? '#4A1A33' : ink;
  const eyeY = s.face === 'mouth' ? -3.5 : 1;

  // Small avatars: keep to eyes, mouth and blush; lid lines, brows and the
  // swirl are only drawn where there are pixels for them.
  const m = t.getTransform();
  const detail = Math.hypot(m.a, m.b) > 0.28;

  // The library's gaze-dependent eye shape: a touch taller looking up.
  const dz = (v: number, d: number) => (Math.abs(v) <= d ? 0 : (Math.sign(v) * (Math.abs(v) - d)) / (1 - d));
  const c1 = (v: number) => Math.max(-1, Math.min(1, v));
  const M = dz(c1(-e.pitch / 0.26 - e.lookY / 7), 0.34);
  const S = Math.abs(dz(c1(e.lookX / 4.5), 0.4));
  const sy = Math.max(0.3, 1 + 0.3 * M - 0.08 * S);
  const sx = 1 - 0.05 * M + 0.1 * S;

  const happy = Math.max(f.happy, laugh);
  const closed = Math.max(f.closed, wSleep);
  const lookX = e.lookX + f.lookX;
  const lookY = e.lookY + f.lookY;

  // "Hey, over here": two quick eyebrow-raises every 2.6 s, with a matching
  // pop of the eyes so it still reads on avatars too small for brows.
  const beat = (now / 1000) % 2.6;
  const bump = (p: number) => (p >= 0 && p < 0.2 ? Math.sin((Math.PI * p) / 0.2) : 0);
  const raise = s.still ? 0 : f.browBounce * (bump(beat) + bump(beat - 0.32));

  // Blush, under everything.
  if (f.blush > 0.02) {
    for (const side of [-1, 1]) {
      project(side * 19 + lookX * 0.4, eyeY + 9 + lookY * 0.3, () => {
        t.fillStyle = BLUSH.replace('A', String(0.85 * clamp01(f.blush)));
        t.beginPath();
        t.ellipse(0, 0, 4.4, 2.5, 0, 0, TAU);
        t.fill();
      });
    }
  }

  // Mouth.
  if (s.face === 'mouth') {
    const rest = 1 - clamp01(laugh + wSleep);
    const weights = {
      smile: f.smile * rest,
      grin: Math.max(f.grin * rest, laugh),
      flat: f.flat * rest,
      frown: f.frown * rest,
      oh: Math.max(f.oh * rest, wSleep * 0.8),
      cat: f.cat * rest,
      tongue: f.tongue * rest,
    };
    const breathe = 1 + 0.04 * e.breath;
    project(lookX * 0.35 + f.mouthX, 12.5 + lookY * 0.25, () => {
      t.scale(breathe, breathe);
      drawMouth(t, f, weights, ink, mouthFill);
    });
  }

  // Sleep bubble: swells on the in-breath, shrinks on the out-breath, at the
  // corner of the mouth (below the eyes when there's no mouth).
  if (f.bubble > 0.02) {
    const r = (2.4 + 5.6 * (0.5 + 0.5 * e.breath)) * clamp01(f.bubble);
    const bx = (s.face === 'mouth' ? lookX * 0.35 + f.mouthX + 3.4 : 4.5) + r * 0.75;
    const by = (s.face === 'mouth' ? 13.6 : eyeY + 10) - r * 0.2;
    project(bx, by, () => {
      const g = t.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(225, 245, 255, 0.25)');
      g.addColorStop(1, 'rgba(160, 210, 255, 0.5)');
      t.fillStyle = g;
      t.beginPath();
      t.arc(0, 0, r, 0, TAU);
      t.fill();
      t.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      t.lineWidth = 0.9;
      t.stroke();
      t.fillStyle = 'rgba(255, 255, 255, 0.9)';
      t.beginPath();
      t.ellipse(-r * 0.38, -r * 0.38, r * 0.26, r * 0.17, -0.7, 0, TAU);
      t.fill();
    }, clamp01(f.bubble));
  }

  // Eyes.
  for (const side of [-1, 1]) {
    const left = side < 0;
    const scale = (left ? f.scaleL : f.scaleR) * (1 + 0.07 * raise);
    const rx = 6.3 * sx * scale;
    const ry = 8.6 * sy * scale * (1 + 0.04 * Math.max(0, -e.y) / 26);
    const blink = left ? e.blinkL : e.blinkR;
    const open = clamp01(e.eyeOpen * (1 - blink));
    const lidTop = clamp01(f.lidTop + (left ? f.lidTopL : f.lidTopR));
    const lidBot = clamp01(f.lidBot);
    const lidT = lidTop + (1 - lidTop - lidBot) * (1 - open);
    const wink = left ? 0 : f.winkR;
    const arcUp = Math.max(happy, wink) * (1 - closed);
    const openA = clamp01(1 - Math.max(arcUp, closed));
    const ex = side * SPACING + lookX * openA;
    const ey = eyeY + lookY * openA * 0.9;
    project(ex, ey, () => {
      if (openA > 0.02) {
        t.save();
        t.globalAlpha *= openA;
        drawEye(t, rx, ry, lidT, lidBot, f.slant, -side, ink, hi, f.swirl, detail, now, f.shine);
        t.restore();
      }
      if (arcUp > 0.02) {
        t.save();
        t.globalAlpha *= arcUp;
        drawArcEye(t, rx, ry, true, ink);
        t.restore();
      }
      if (closed > 0.02) {
        t.save();
        t.globalAlpha *= closed;
        drawArcEye(t, rx, ry, false, ink);
        t.restore();
      }
    });

    // Brow.
    if (detail && f.brow > 0.02) {
      const lift = f.browLift + (left ? f.browLiftL : 0) + 2.8 * raise;
      project(ex * 0.98, ey - ry - 3.6 - lift, () => {
        t.rotate(left ? -f.browTilt : f.browTilt);
        t.beginPath();
        t.moveTo(-4.6, 1.1);
        t.quadraticCurveTo(0, -1.8, 4.6, 1.1);
        t.strokeStyle = ink;
        t.globalAlpha *= 0.62 * clamp01(f.brow);
        t.lineWidth = 2.5;
        t.lineCap = 'round';
        t.stroke();
      });
    }
  }

  // A tear by the right eye (sad), or both (laughing).
  if (f.tear > 0.02) {
    const fall = ((now / 1600) % 1) * 3;
    for (const side of f.happy > 0.5 ? [-1, 1] : [1]) {
      project(side * (SPACING + 6.5) + lookX, eyeY + 6 + fall, () => {
        t.globalAlpha *= clamp01(f.tear) * (1 - fall / 4);
        t.fillStyle = '#7CCBFF';
        t.beginPath();
        t.moveTo(0, -3.2);
        t.quadraticCurveTo(2.4, 0.6, 0, 2.2);
        t.quadraticCurveTo(-2.4, 0.6, 0, -3.2);
        t.fill();
      });
    }
  }

  void wDefault;
}
