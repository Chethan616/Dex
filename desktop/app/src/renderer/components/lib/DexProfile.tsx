/*
 * "Your DEX" in the renderer: the profile hook, the avatar that shows it, and
 * the Netflix-style picker used by onboarding and Settings → Appearance.
 * The profile itself lives in main (main/profile.ts) and syncs to the phone
 * through the Firebase bridge.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AgentAvatar } from './AgentAvatar';

export const DEX_BOTS = [
  'clover', 'flower', 'triangle', 'square', 'blob', 'ghost', 'circle', 'drop', 'star',
  'droid', 'mech', 'alien', 'hexagon', 'cat', 'cloud', 'pill', 'pebble', 'puddle',
] as const;

/** null = the bot's own colour. Picked to read well on both themes. */
export const DEX_COLORS: Array<string | null> = [
  null, '#35B8FF', '#2FCB7A', '#9A62FF', '#DC48FF', '#FF5C8A', '#FF8C42', '#FFD32B', '#1ED3C6', '#95A6C4',
];

const FALLBACK: DexProfile = { bot: 'flower', color: null, name: null, chosen: false, updatedAt: 0 };

export function useDexProfile(): [DexProfile, (next: Partial<DexProfile>) => Promise<void>] {
  const api = window.electronAPI?.profile;
  const [profile, setProfile] = useState<DexProfile>(FALLBACK);
  useEffect(() => {
    void api?.get().then(setProfile).catch(() => {});
    return api?.onChange(setProfile);
  }, [api]);
  const save = useCallback(async (next: Partial<DexProfile>) => {
    const saved = await api?.set({ bot: next.bot, color: next.color, name: next.name });
    if (saved) setProfile(saved);
  }, [api]);
  return [profile, save];
}

/** Your DEX's face. */
export function DexAvatar({ size = 40, interactive, status, className }: {
  size?: number;
  interactive?: boolean;
  status?: string;
  className?: string;
}): React.ReactElement {
  const [profile] = useDexProfile();
  return (
    <AgentAvatar
      type={profile.bot as (typeof DEX_BOTS)[number]}
      color={profile.color}
      size={size}
      interactive={interactive}
      status={status}
      className={className}
      label={profile.name ?? 'DEX'}
    />
  );
}

/**
 * Pick your DEX: an animated grid of all eighteen bots (hover wakes one up,
 * the chosen one hops), a row of colours, a name, and Shuffle.
 */
export function ProfilePicker({ initial, onSave, saveLabel = 'Save', onCancel }: {
  initial: DexProfile;
  onSave: (profile: { bot: string; color: string | null; name: string | null }) => void | Promise<void>;
  saveLabel?: string;
  onCancel?: () => void;
}): React.ReactElement {
  const [bot, setBot] = useState(initial.bot);
  const [color, setColor] = useState<string | null>(initial.color);
  const [name, setName] = useState(initial.name ?? '');
  const [hover, setHover] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const shuffle = () => {
    const nextBot = DEX_BOTS[Math.floor(Math.random() * DEX_BOTS.length)];
    const nextColor = DEX_COLORS[Math.floor(Math.random() * DEX_COLORS.length)];
    setBot(nextBot);
    setColor(nextColor);
  };

  const grid = useMemo(() => DEX_BOTS.map((b) => {
    const selected = b === bot;
    return (
      <button
        key={b}
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={b}
        className={`dex-pick__tile${selected ? ' dex-pick__tile--selected' : ''}`}
        onClick={() => setBot(b)}
        onMouseEnter={() => setHover(b)}
        onMouseLeave={() => setHover((h) => (h === b ? null : h))}
      >
        <AgentAvatar
          type={b}
          color={selected ? color : null}
          size={56}
          status={selected ? 'running' : hover === b ? 'idle' : 'stopped'}
          interactive={false}
        />
      </button>
    );
  }), [bot, color, hover]);

  return (
    <div className="dex-pick">
      <div className="dex-pick__hero">
        <AgentAvatar type={bot as (typeof DEX_BOTS)[number]} color={color} size={112} interactive status="idle" label={name || 'DEX'} />
        <input
          className="dex-pick__name"
          value={name}
          maxLength={32}
          placeholder="Name your DEX"
          onChange={(e) => setName(e.target.value)}
          aria-label="Name your DEX"
        />
      </div>

      <div className="dex-pick__grid" role="radiogroup" aria-label="Pick a bot">{grid}</div>

      <div className="dex-pick__colors" role="radiogroup" aria-label="Colour">
        {DEX_COLORS.map((c) => (
          <button
            key={c ?? 'auto'}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={c ?? 'Its own colour'}
            title={c ?? 'Its own colour'}
            className={`dex-pick__swatch${color === c ? ' dex-pick__swatch--selected' : ''}${c ? '' : ' dex-pick__swatch--auto'}`}
            style={c ? { background: c } : undefined}
            onClick={() => setColor(c)}
          />
        ))}
      </div>

      <div className="dex-pick__actions">
        <button type="button" className="dex-pick__btn" onClick={shuffle}>⤮ Shuffle</button>
        <span className="dex-pick__spacer" />
        {onCancel && <button type="button" className="dex-pick__btn" onClick={onCancel}>Cancel</button>}
        <button
          type="button"
          className="dex-pick__btn dex-pick__btn--primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try { await onSave({ bot, color, name: name.trim() || null }); } finally { setSaving(false); }
          }}
        >
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
    </div>
  );
}
