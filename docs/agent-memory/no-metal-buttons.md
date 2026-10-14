---
name: no-metal-buttons
description: The user dislikes the metal-fx MetalButton look; desktop CTAs use plain pill buttons instead
metadata:
  node_type: memory
  type: feedback
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-09-29T17:04:53.002Z
---

Don't use `MetalButton` (metal-fx chromatic ring, `components/lib/Metal.tsx`) for new desktop UI.

- Primary actions are plain pills: `background: var(--color-fg-primary)`, `color: var(--color-bg-base)`.
  - In onboarding: `.ob-btn .ob-btn--primary`.
  - In Settings: `conn-card__btn conn-card__btn--primary`.
- Secondary actions are tonal chips.

**Why:** On 2026-09-29 the user said "i dont like the metal buttons". All onboarding MetalButtons and the Settings → Updates one were replaced.

**How to apply:**
- Pick the plain styles for any new button.
- `MetalButton` and `NewBadge` still exist in the lib, but don't reach for them.
- If a design calls for "premium" flair, ask first.
