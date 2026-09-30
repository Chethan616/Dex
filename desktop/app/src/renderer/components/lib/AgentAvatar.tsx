/*
 * AgentAvatar — every agent's face, from bot-avatars.
 *
 * Identity is stable and per task: a session id picks the body shape (a hash,
 * the same on the phone), so a list of tasks isn't a row of identical faces.
 * Without a session — the engine pickers — the engine picks: Claude Code a
 * flower, Codex a circle, BrowserCode a droid.
 * The status drives the animation: running hops, paused sleeps, the rest are
 * awake — blinking, glancing round, following the pointer, the odd flip.
 *
 * Alive by default: every avatar animates (`animate={false}` freezes one).
 * The cost is kept down where there are many — small avatars use the
 * `smooth` shading instead of per-pixel `plastic` — and bot-avatars itself
 * stops drawing offscreen canvases and honours prefers-reduced-motion.
 */

import React from 'react';
import { BotAvatar, botAvatarTypes, type BotAvatarType, type BotAvatarState } from 'bot-avatars';
import { useLibTheme } from '../../design/useLibTheme';

const ENGINE_TYPE: Record<string, BotAvatarType> = {
  'claude-code': 'flower',
  codex: 'circle',
  browsercode: 'droid',
  opencode: 'droid',
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function avatarTypeFor(engineId?: string | null, sessionId?: string | null): BotAvatarType {
  if (!sessionId && engineId && ENGINE_TYPE[engineId]) return ENGINE_TYPE[engineId];
  const key = sessionId ?? engineId ?? 'dex';
  return botAvatarTypes[hash(key) % botAvatarTypes.length];
}

export function avatarStateFor(status?: string | null): BotAvatarState {
  if (status === 'running' || status === 'starting') return 'working';
  // Only an explicit pause sleeps. "Waiting for you" is awake and looking
  // around — a sleeping face read as a dead session.
  if (status === 'paused') return 'sleeping';
  return 'default';
}

export interface AgentAvatarProps {
  engineId?: string | null;
  sessionId?: string | null;
  status?: string | null;
  /** Explicit shape, overriding the engine/session mapping. */
  type?: BotAvatarType;
  size?: number;
  /** Follow the pointer and hop on click. Default: on from 18px up. */
  interactive?: boolean;
  /** Animate (default) or freeze on the state's still pose. */
  animate?: boolean;
  face?: 'eyes' | 'mouth';
  /** Body colour override (#RRGGBB); the type's own colour otherwise. */
  color?: string | null;
  className?: string;
  label?: string;
  /** The trail round a working spin, 0–2. Off by default. */
  whirl?: number;
}

/**
 * The ref is the avatar's canvas: `ref.current.click()` makes it hop and turn
 * round, as a click does — the chat's "done!" when a reply lands.
 */
export const AgentAvatar = React.forwardRef<HTMLCanvasElement, AgentAvatarProps>(function AgentAvatar({
  engineId, sessionId, status, type, size = 24, interactive, animate = true, face, color,
  className, label, whirl,
}, ref): React.ReactElement {
  const theme = useLibTheme();
  const state = avatarStateFor(status);
  const seed = sessionId ? (hash(sessionId) % 1000) / 1000 : undefined;
  return (
    <BotAvatar
      ref={ref}
      type={type ?? avatarTypeFor(engineId, sessionId)}
      state={state}
      size={size}
      // The mouth carries the expression (smile while working, a yawn
      // asleep); below ~20px it's a smudge, so eyes only there.
      face={face ?? (size >= 20 ? 'mouth' : 'eyes')}
      theme={theme}
      color={color ?? undefined}
      seed={seed}
      interactive={interactive ?? size >= 18}
      paused={!animate}
      shading={size < 28 ? 'smooth' : 'plastic'}
      className={`lib-avatar${className ? ` ${className}` : ''}`}
      aria-label={label}
      whirl={whirl}
    />
  );
});
