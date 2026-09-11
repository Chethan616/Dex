import React, { useEffect, useRef } from 'react';
import { subscribeThemeMode, resolveThemeMode, getThemeMode } from '../design/themeMode';
// The full wordmark, at source resolution. The 192x96 copy used for the
// on-screen <img> is too coarse to sample: the dot grid reads roughly one
// cell per two texels, and the letterforms come out mushy at the joins.
import dexMark from '../assets/dex-wordmark-hi.png';

const FRAME_INTERVAL_MS = 1000 / 12;

// Theme-paired palette for the WebGL dashboard background. Hardcoded floats
// (not CSS vars) because GLSL uniforms can't read from the cascade — but
// they're paired with the light/dark token philosophy in theme.global.css.
const PALETTE = {
  dark: {
    bg:  [0.055, 0.055, 0.067] as const,
    dot: [0.32,  0.38,  0.52]  as const,
    // The blue the mark is actually drawn in, so the lit dots read as the
    // logo rather than as "some blue dots arranged like the logo".
    accent: [0.24, 0.55, 0.98] as const,
    mix: 0.55,
  },
  light: {
    bg:  [0.957, 0.957, 0.965] as const, /* matches --color-bg-base #f4f4f6 */
    dot: [0.30,  0.40,  0.58]  as const, /* slate-blue, deeper for light bg */
    accent: [0.13, 0.42, 0.90] as const,
    mix: 0.55,
  },
};

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_bg;
uniform vec3 u_dot;
uniform float u_mix;

// The DEX wordmark itself, sampled as a texture rather than approximated in
// code. Drawing the letterforms by hand would be a resemblance; sampling the
// real artwork is the wordmark, in dots.
uniform sampler2D u_logo;
uniform float u_hasLogo;
uniform float u_logoAspect;
uniform vec3 u_accent;

// Signature field: three slow ridges at different angles, interfering.
//
// This replaces a single horizontal sine band. One band reads as decoration
// that happens to move; overlapping ridges at different angles never repeat
// the same shape twice, which gives the surface somewhere to go without ever
// asking for attention. Frequencies are deliberately non-harmonic (1.9 / 2.7 /
// 3.6) so the pattern does not visibly loop.
float ridge(vec2 p, vec2 dir, float freq, float phase) {
  return sin(dot(p, normalize(dir)) * freq + phase);
}

float field(vec2 uv, float aspect, float t) {
  vec2 p = vec2(uv.x * aspect, uv.y);

  // Slow, unequal drift rates — the beat between them is what keeps it alive.
  float a = ridge(p, vec2( 1.0,  0.35), 1.9, t * 0.11);
  float b = ridge(p, vec2(-0.45, 1.0),  2.7, t * 0.07 + 1.7);
  float c = ridge(p, vec2( 0.8, -0.65), 3.6, t * 0.05 + 4.2);

  // Weighted so no single ridge dominates; normalized back to 0..1.
  float sum = (a * 0.5 + b * 0.32 + c * 0.24) / 1.06;
  float density = sum * 0.5 + 0.5;

  // Directional falloff: brighter toward the lower-left, fading up and right.
  // Gives the composition an implied light source, so it reads as depth rather
  // than as a flat texture, and keeps the top-right quiet where the toolbar and
  // primary controls sit.
  float lean = 1.0 - smoothstep(-0.15, 1.25, (uv.x * 0.72 + uv.y * 0.52));
  density *= mix(0.22, 1.0, lean);

  return clamp(density, 0.0, 1.0);
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;

  // Uniform dot lattice in pixel space — the medium is kept deliberately:
  // it is what makes the surface feel machined rather than painted.
  // Grid pitch decides how much of the artwork survives. At 12px a pane-sized
  // box gives roughly 68x34 cells, which is too coarse for the thin strokes in
  // the letterforms — the joins fill in and the x stops reading as an x. 6px
  // roughly quadruples the sample count and the wordmark resolves properly.
  float DOT_SPACING = 6.0;
  float MAX_RADIUS  = 1.9;
  vec2 cell = floor(gl_FragCoord.xy / DOT_SPACING);
  vec2 cellCenter = (cell + 0.5) * DOT_SPACING;
  float distPx = length(gl_FragCoord.xy - cellCenter);

  // Sample once per cell so every pixel of a dot shares one radius.
  vec2 cellUv = cellCenter / u_resolution;
  float density = field(cellUv, aspect, u_time);

  // Nonlinear curve: most of the field stays near-invisible and only the
  // ridge crests resolve into dots, so the pattern suggests itself instead of
  // stating itself.
  float sizeCurve = pow(density, 3.4);

  // -- the mark ------------------------------------------------------------
  //
  // Fit the artwork into a centred box, preserving its own proportions, and
  // read its alpha at this cell. Everything below is driven by that one
  // sample, so the shape is exact by construction.
  float markAlpha = 0.0;
  vec2 markUv = vec2(0.0);
  if (u_hasLogo > 0.5) {
    // Sized from the width, because the wordmark is wide (2:1) and driving it
    // from height would push the letters off both edges.
    float boxW = u_resolution.x * 0.66;
    float boxH = boxW / max(u_logoAspect, 0.001);
    // Never let it outgrow the viewport on a short window either.
    float overflow = boxH / max(u_resolution.y * 0.55, 1.0);
    if (overflow > 1.0) { boxW /= overflow; boxH /= overflow; }

    vec2 boxOrigin = (u_resolution - vec2(boxW, boxH)) * 0.5;
    markUv = (cellCenter - boxOrigin) / vec2(boxW, boxH);
    if (markUv.x > 0.0 && markUv.x < 1.0 && markUv.y > 0.0 && markUv.y < 1.0) {
      // Flip Y: texture space is top-down, gl_FragCoord is bottom-up.
      markAlpha = texture(u_logo, vec2(markUv.x, 1.0 - markUv.y)).a;
    }
  }

  // A wave travelling along the letterforms rather than a global fade, so the
  // wordmark reads as being drawn continuously instead of switching on and
  // off. Shallow on purpose: at the old depth the trough dimmed whole letters
  // out of legibility, which is the opposite of what a logo should do.
  float sweep = sin((markUv.x * 1.6 + markUv.y * 0.5) * 3.0 - u_time * 1.1);
  float blink = 0.78 + 0.22 * (sweep * 0.5 + 0.5);

  // Tight threshold on alpha. The artwork's antialiased edge would otherwise
  // scatter half-lit dots around every stroke and soften the shape; snapping
  // it is what keeps the outline crisp at this grid pitch.
  float markMask = smoothstep(0.42, 0.58, markAlpha) * blink;

  // The mark sets a floor under the dot size, so it emerges from the existing
  // field rather than replacing it — the ridges still move underneath.
  // Mark dots run at full radius so the letterforms read as solid strokes
  // against the sparser ambient field.
  float radius = MAX_RADIUS * max(sizeCurve * 0.85, markMask);
  float dotMask = 1.0 - smoothstep(radius - 0.5, radius + 0.35, distPx);
  dotMask *= max(smoothstep(0.02, 0.14, density), markMask);

  vec3 tint = mix(u_dot, u_accent, clamp(markMask * 1.35, 0.0, 1.0));
  fragColor = vec4(mix(u_bg, tint, dotMask * u_mix), 1.0);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

export function DashboardBackground(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: false });
    if (!gl) {
      console.warn('[DashboardBackground] WebGL2 unavailable');
      return;
    }

    let program: WebGLProgram | null = null;
    let vs: WebGLShader | null = null;
    let fs: WebGLShader | null = null;
    try {
      vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      program = gl.createProgram();
      if (!program) throw new Error('createProgram failed');
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
      }
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      vs = null;
      fs = null;
    } catch (err) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      if (program) gl.deleteProgram(program);
      console.error('[DashboardBackground] shader setup failed', err);
      return;
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const resLoc = gl.getUniformLocation(program, 'u_resolution');
    const timeLoc = gl.getUniformLocation(program, 'u_time');
    const bgLoc  = gl.getUniformLocation(program, 'u_bg');
    const dotLoc = gl.getUniformLocation(program, 'u_dot');
    const mixLoc = gl.getUniformLocation(program, 'u_mix');
    const logoLoc = gl.getUniformLocation(program, 'u_logo');
    const hasLogoLoc = gl.getUniformLocation(program, 'u_hasLogo');
    const logoAspectLoc = gl.getUniformLocation(program, 'u_logoAspect');
    const accentLoc = gl.getUniformLocation(program, 'u_accent');

    gl.useProgram(program);

    // The mark is loaded asynchronously and the field renders fine without it,
    // so start with it off and switch it on when the image arrives. A failed
    // decode simply leaves the original background — a missing texture should
    // never cost the user their wallpaper.
    const logoTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, logoTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(logoLoc, 0);
    gl.uniform1f(hasLogoLoc, 0);
    gl.uniform1f(logoAspectLoc, 1);

    let logoImage: HTMLImageElement | null = new Image();
    logoImage.onload = () => {
      if (!logoImage) return;
      try {
        gl.useProgram(program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, logoTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, logoImage);
        gl.uniform1f(logoAspectLoc, logoImage.naturalWidth / logoImage.naturalHeight);
        gl.uniform1f(hasLogoLoc, 1);
        schedule();
      } catch (err) {
        console.warn('[DashboardBackground] mark texture upload failed', err);
      }
    };
    logoImage.onerror = () => {
      console.warn('[DashboardBackground] mark image failed to load');
    };
    logoImage.src = dexMark;

    let palette = PALETTE[resolveThemeMode(getThemeMode())];
    const applyPalette = () => {
      gl.uniform3f(bgLoc,  palette.bg[0],  palette.bg[1],  palette.bg[2]);
      gl.uniform3f(dotLoc, palette.dot[0], palette.dot[1], palette.dot[2]);
      gl.uniform3f(accentLoc, palette.accent[0], palette.accent[1], palette.accent[2]);
      gl.uniform1f(mixLoc, palette.mix);
      // Pre-fill the framebuffer with the bg color so the first composited
      // frame already matches the theme — no black flash before render().
      gl.clearColor(palette.bg[0], palette.bg[1], palette.bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    };
    applyPalette();
    const unsubscribeTheme = subscribeThemeMode((_mode, resolved) => {
      palette = PALETTE[resolved];
      applyPalette();
      schedule();
    });

    const dpr = 1;

    const resize = () => {
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let raf: number | null = null;
    let frameTimer: number | null = null;
    let running = true;
    let visible = true;
    const start = performance.now();

    const shouldRun = () => running && visible && !document.hidden;

    const cancelScheduledFrame = () => {
      if (frameTimer != null) {
        window.clearTimeout(frameTimer);
        frameTimer = null;
      }
      if (raf != null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    };

    const schedule = () => {
      if (!shouldRun()) return;
      if (frameTimer != null || raf != null) return;
      frameTimer = window.setTimeout(() => {
        frameTimer = null;
        raf = requestAnimationFrame(render);
      }, FRAME_INTERVAL_MS);
    };

    const render = () => {
      raf = null;
      if (!shouldRun()) return;
      const t = (performance.now() - start) / 1000;
      gl.uniform2f(resLoc, canvas.width, canvas.height);
      gl.uniform1f(timeLoc, t);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      schedule();
    };
    schedule();

    const onVisibility = () => {
      if (document.hidden) {
        cancelScheduledFrame();
      } else {
        schedule();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (!visible) {
        cancelScheduledFrame();
      } else {
        schedule();
      }
    });
    io.observe(canvas);

    return () => {
      running = false;
      cancelScheduledFrame();
      unsubscribeTheme();
      document.removeEventListener('visibilitychange', onVisibility);
      io.disconnect();
      ro.disconnect();
      if (logoImage) {
        logoImage.onload = null;
        logoImage.onerror = null;
        logoImage = null;
      }
      gl.deleteTexture(logoTexture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  return <canvas ref={canvasRef} className="dashboard__bg" aria-hidden="true" />;
}

export default DashboardBackground;
