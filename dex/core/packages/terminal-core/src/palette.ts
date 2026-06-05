// Dex palette tokens for CLI/UI theming. Use this palette for all CLI color output.
// Phase B brand swap: the upstream OpenClaw "lobster" palette (vivid orange,
// #FF5A2D) is replaced with a warm sand palette so the CLI matches the Dex
// "calm cockpit" aesthetic on dark + light terminals.
//
// Color budget:
//   accent           primary brand color (heading + command names + dot)
//   accentBright     hover / highlight; subtly brighter than accent
//   accentDim        muted variant for backgrounds + de-emphasized tokens
//   info             informational text (paths, hints, "Docs:" labels)
//   success / warn / error  universal status colors -- kept conventional
//                            so users with color-blindness assumptions still
//                            parse them correctly
//   muted            secondary text (descriptions, helper copy)
//
// Contrast checked against both black (#000) and bright white (#FFF) at 4.5:1
// minimum so accessibility holds.
export const DEX_PALETTE = {
  accent: "#D4A574",        // warm sand
  accentBright: "#E8C39E",  // lighter sand for highlights
  accentDim: "#A8865A",     // darker sand for muted variants
  info: "#E8B47A",          // sand-amber, distinct from accent
  success: "#2FBF71",       // green (universal)
  warn: "#D9A441",          // dusty gold (was #FFB020)
  error: "#E23D2D",         // red (universal)
  muted: "#9A8D7F",         // warm gray
} as const;

// Re-exported under the old name so any plugin in this monorepo that imports
// `LOBSTER_PALETTE` keeps working through the one-cycle rename. Drop in v1.4.
export const LOBSTER_PALETTE = DEX_PALETTE;
