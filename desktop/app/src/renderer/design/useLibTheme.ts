/*
 * useLibTheme — the resolved 'light' | 'dark' for Libraries.dev components.
 *
 * Pass it explicitly as `theme={...}` to BorderBeam, VoiceBeam, MetalFx,
 * MetalBadge, MetalText, ThinkingOrb, BotAvatar and ImageGeneration. Several of
 * them resolve `theme="auto"` from prefers-color-scheme only, which ignores
 * DEX's own Light/Dark/System setting — so never leave it to `auto`.
 */

import type { ResolvedThemeMode } from './themeMode';
import { useThemeMode } from './useThemeMode';

export function useLibTheme(): ResolvedThemeMode {
  return useThemeMode().resolved;
}
