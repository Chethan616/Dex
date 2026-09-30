/*
 * AgentAvatar — every agent's face, from bot-avatars.
 *
 * Identity is stable and per task: a session id picks the body shape (a hash,
 * the same on the phone), so a list of tasks isn't a row of identical faces.
 * Without a session — the engine pickers — the engine picks: Claude Code a
 * flower, Codex a circle, BrowserCode a droid.
 *
 * A task's bot wears its `mood` (botMood.ts): thinking, working, needs you,
 * happy, sad, asleep. bot-avatars draws three states itself — awake, working
 * (hops, spins, a laugh) and sleeping — so each mood picks one of those, tunes
 * the motion (eager hops when it needs you, slow and grey when it failed), and
 * adds a small accent beside the head: thought dots, a "!", sparkles, a sweat
 * drop, floating z's. Without a mood, `status` drives it as before.
 *
 * Alive by default: every avatar animates (`animate={false}` freezes one).
 * The cost is kept down where there are many — small avatars use the
 * `smooth` shading instead of per-pixel `plastic` — and bot-avatars itself
 * stops drawing offscreen canvases and honours prefers-reduced-motion.
 */

import React, { useEffect, useImperativeHandle, useRef } from 'react';
import { BotAvatar, botAvatarTypes, type BotAvatarType, type BotAvatarState } from 'bot-avatars';
import { useLibTheme } from '../../design/useLibTheme';
import type { BotMood } from './botMood';

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

/** How each mood moves: which drawn state, and how it's tuned. */
const MOOD_MOTION: Record<BotMood, { state: BotAvatarState; speed?: number; turn?: number; jumpEvery?: number; saturation?: number; brightness?: number }> = {
  awake: { state: 'default' },
  // A quieter, inward look: less glancing round, no idle flips.
  thinking: { state: 'default', speed: 0.8, turn: 0.35, jumpEvery: 0 },
  working: { state: 'working' },
  // Eager: little hops every couple of seconds to catch your eye.
  'needs-you': { state: 'default', speed: 1.25, turn: 1.4, jumpEvery: 2.2 },
  happy: { state: 'default', speed: 1.15, jumpEvery: 3 },
  sad: { state: 'default', speed: 0.55, turn: 0.25, jumpEvery: 0, saturation: 0.75, brightness: 0.88 },
  sleeping: { state: 'sleeping' },
};

export interface AgentAvatarProps {
  engineId?: string | null;
  sessionId?: string | null;
  status?: string | null;
  /** What the task is doing (botMood.ts). Wins over `status`. */
  mood?: BotMood;
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

/** The accent beside the head: drawn in CSS (lib.css), sized from the avatar. */
function Accent({ mood }: { mood: BotMood }): React.ReactElement | null {
  switch (mood) {
    case 'thinking':
      return <span className="lib-mood lib-mood--thinking" aria-hidden="true"><i /><i /><i /></span>;
    case 'needs-you':
      return <span className="lib-mood lib-mood--needs-you" aria-hidden="true">!</span>;
    case 'happy':
      return <span className="lib-mood lib-mood--happy" aria-hidden="true"><i /><i /><i /></span>;
    case 'sad':
      return <span className="lib-mood lib-mood--sad" aria-hidden="true" />;
    case 'sleeping':
      return <span className="lib-mood lib-mood--sleeping" aria-hidden="true"><i>z</i><i>z</i></span>;
    default:
      return null;
  }
}

const MOOD_LABEL: Record<BotMood, string> = {
  awake: 'ready',
  thinking: 'thinking',
  working: 'working',
  'needs-you': 'needs you',
  happy: 'done',
  sad: 'hit a problem',
  sleeping: 'asleep',
};

/**
 * The ref is the avatar's canvas: `ref.current.click()` makes it hop and turn
 * round, as a click does — the chat's "done!" when a reply lands.
 */
export const AgentAvatar = React.forwardRef<HTMLCanvasElement, AgentAvatarProps>(function AgentAvatar({
  engineId, sessionId, status, mood, type, size = 24, interactive, animate = true, face, color,
  className, label, whirl,
}, ref): React.ReactElement {
  const theme = useLibTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useImperativeHandle(ref, () => canvasRef.current as HTMLCanvasElement);
  const motion = mood ? MOOD_MOTION[mood] : null;
  const state = motion?.state ?? avatarStateFor(status);
  const seed = sessionId ? (hash(sessionId) % 1000) / 1000 : undefined;
  const canPoke = interactive ?? size >= 18;

  // A finished task jumps for joy the moment it turns happy.
  useEffect(() => {
    if (mood !== 'happy' || !animate || !canPoke) return;
    const t = setTimeout(() => canvasRef.current?.click(), 120);
    return () => clearTimeout(t);
  }, [mood, animate, canPoke]);

  const avatar = (
    <BotAvatar
      ref={canvasRef}
      type={type ?? avatarTypeFor(engineId, sessionId)}
      state={state}
      size={size}
      // The mouth carries the expression (smile while working, a yawn
      // asleep); below ~20px it's a smudge, so eyes only there.
      // Thinking and sad don't smile.
      face={face ?? (size >= 20 && mood !== 'sad' && mood !== 'thinking' ? 'mouth' : 'eyes')}
      theme={theme}
      color={color ?? undefined}
      seed={seed}
      interactive={canPoke}
      paused={!animate}
      shading={size < 28 ? 'smooth' : 'plastic'}
      className={`lib-avatar${className ? ` ${className}` : ''}`}
      aria-label={label ?? (mood ? `DEX, ${MOOD_LABEL[mood]}` : undefined)}
      whirl={whirl ?? (mood === 'working' && size >= 22 ? 1 : undefined)}
      speed={motion?.speed}
      turn={motion?.turn}
      jumpEvery={motion?.jumpEvery}
      saturation={motion?.saturation}
      brightness={motion?.brightness}
    />
  );
  // Only moods get the wrapper, so every other avatar's layout is untouched.
  if (!mood) return avatar;
  return (
    <span
      className={`lib-mood-host lib-mood-host--${mood}${animate ? '' : ' lib-mood-host--still'}`}
      style={{ '--avatar-size': `${size}px` } as React.CSSProperties}
      data-mood={mood}
    >
      {avatar}
      {size >= 14 && <Accent mood={mood} />}
    </span>
  );
});
