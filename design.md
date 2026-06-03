# design.md — UI / UX System

**Product:** a chat-first control surface for an AI agent that has *hands* on your machine.
**One-line north star:** *A calm cockpit for commanding agents you can trust.*

The memorable thing — the soul of this app — is the **Action Preview**: before the agent clicks anything, you see exactly what it's about to do and approve or deny it. Everything else is quiet around that moment.

---

## 1. Principles

1. **Trust over flash.** The user is letting software touch their real files and apps. The UI's #1 job is making the agent's intentions legible and stoppable.
2. **Lightweight is the aesthetic.** Restraint *is* the design. Minimal palette, one type family pair, sparse motion, no decorative weight. Fast cold-start, instant input.
3. **One surface, two shapes.** Desktop = wide, keyboard-first, three zones. Phone = stacked, thumb-first, one zone at a time. Same components, reflowed — never two designs.
4. **The agent has visible state.** Idle, thinking, acting, awaiting-you, error. The user should never wonder "is it doing something?"
5. **Quiet until it matters.** Notifications and color are rationed; an approval request is allowed to be loud because it's rare.

---

## 2. Typography

A technical, characterful pairing that stays light: **Geist** (UI) + **Geist Mono** (commands, logs, agent actions). Both are free (OFL), variable (one file each → small footprint), and read as "instrument panel," not "generic SaaS." Mono is used deliberately for anything the agent *does*, so machine-actions look machine.

> Fallback for an ultra-light build: a native system stack (`-apple-system`, `Segoe UI`, `Roboto`). Use it only if shaving the two font files matters; you lose some character.

**Type scale** (1.250 major-third, 16px base):

| Token | Size / Line | Weight | Use |
|---|---|---|---|
| `display` | 31 / 38 | 600 | rare hero / empty states |
| `title` | 25 / 32 | 600 | screen titles |
| `heading` | 20 / 28 | 550 | section headers |
| `body` | 16 / 24 | 400 | chat text, default |
| `label` | 14 / 20 | 500 | buttons, chips, metadata |
| `mono` | 14 / 22 | 420 | commands, code, action steps |
| `caption` | 12 / 16 | 450 | timestamps, hints |

Rules: body never below 16 on mobile. Letter-spacing slightly negative on `title`/`display` (-0.01em), neutral elsewhere. Mono gets the agent's words; sans gets the human's and the assistant's prose.

---

## 3. Color

**Dark-first** (it's a tool you stare at; dark is calmer and cheaper to render). A near-neutral base with a single cool accent and rationed semantic states. Light theme mirrors the same tokens.

```
/* base — dark */
--bg            #0B0C0E   /* app background          */
--surface       #141619   /* cards, panels           */
--surface-2     #1C1F24   /* raised: command bar, sheet */
--border        #272B31   /* hairlines, 1px           */
--text          #E8EAED   /* primary text             */
--text-dim      #9BA1A8   /* secondary / captions     */
--text-faint    #5C626B   /* disabled, placeholders   */

/* one accent — used sparingly */
--accent        #5BA8FF   /* focus, links, primary action */
--accent-quiet  #1B2A3D   /* accent fill at low energy    */

/* agent state — semantic, NOT decorative */
--idle          #5C626B   /* grey: resting            */
--thinking      #B58CFF   /* violet pulse: reasoning  */
--acting        #5BA8FF   /* blue: executing          */
--approve       #3DD68C   /* green: success / confirm */
--awaiting      #FFB454   /* amber: needs your call   */  ← the loud one
--error         #FF6B6B   /* red: failed / blocked    */
```

Discipline: a screen at rest shows essentially two greys + text. Color appears only to signal **agent state** or **a decision the user must make**. No gradients-as-decoration, no color for hierarchy that spacing can carry.

---

## 4. Space, shape, depth

- **8pt grid.** Spacing tokens: `4, 8, 12, 16, 24, 32, 48`. Default gutter 16; section rhythm 24.
- **Radii:** `sm 6` (chips/inputs), `md 10` (cards), `lg 16` (sheets/modals). Nothing fully round except status dots and avatars.
- **Elevation:** one real shadow, used twice (command bar, approval sheet). Everything else separates with a 1px `--border`. Cheap to render, calm to read.
- **"Glass" used once:** a subtle backdrop blur only on the floating command bar / approval sheet — not everywhere (blur is expensive; ration it).

---

## 5. Layout — Desktop

Three zones, resizable; the right panel is where trust lives.

```
┌──────────┬───────────────────────────────┬─────────────────────────┐
│ DEVICES  │   CONVERSATION                │  LIVE / ACTION          │
│          │                               │                         │
│ ◐ This PC│  you  open Excel and total B  │  ▣ Action Preview       │
│   online │                               │  ──────────────────     │
│ ○ Mac    │  ⠿ thinking…                  │  mono: focus → Excel    │
│   (later)│                               │  mono: select B2:B40    │
│          │  agent  Done — total is 4,210 │  mono: =SUM(B2:B40)     │
│ ── skills│                               │                         │
│ • desktop│                               │  [ Approve ]  [ Deny ]   │
│ • files  │                               │                         │
│ • email  │  ┌─────────────────────────┐  │  (PiP desktop preview   │
│          │  │ ⌘  type a command…   ▷ │  │   thumbnail, optional)  │
└──────────┴──┴─────────────────────────┴──┴─────────────────────────┘
```

- **Left rail (collapsible):** device presence (online/offline dots, capability), and installed skills. In v1 it's just "This PC"; built so adding devices later is free.
- **Center:** the conversation. Human messages plain; agent prose plain; **agent *actions* render as mono step-lines** so doing-things looks different from saying-things.
- **Right panel:** the Action Preview + (optional) a live thumbnail of UFO2's Picture-in-Picture desktop. Collapses when idle.
- **Command bar:** floating, pinned bottom-center of the conversation, blurred surface, mono input, `Enter` to send, `⌘/Ctrl+K` to focus from anywhere. Keyboard-first throughout.

---

## 6. Layout — Phone

One zone at a time; the approval is a bottom sheet that rises only when needed.

```
┌───────────────────────┐      ┌───────────────────────┐
│  ◐ This PC   ▾  ⋯     │      │  ░░░ dimmed chat ░░░  │
│───────────────────────│      │───────────────────────│
│ you  total column B   │      │  ⬆ APPROVE ACTION      │
│                       │      │                       │
│ ⠿ thinking…           │      │  mono: focus → Excel   │
│                       │      │  mono: =SUM(B2:B40)    │
│ agent  Done — 4,210   │      │                       │
│                       │      │  [   Approve   ]       │
│                       │      │  [    Deny     ]       │
│───────────────────────│      │───────────────────────│
│ ⌘ type a command…  ▷ │      │   swipe down to defer  │
└───────────────────────┘      └───────────────────────┘
      normal state                approval bottom-sheet
```

- Device switcher is a top dropdown (one tap), not a rail.
- Command bar pinned above the keyboard, thumb-reachable, mono input.
- **Approval = bottom sheet**, amber-accented, large tap targets (min 48dp), dims the chat behind it. This is the one moment the phone app is allowed to interrupt.
- Long-press a past action → "do this again."

---

## 7. Core components

- **Message — human:** sans, right-aligned-light or full-width plain; no bubbles-as-decoration, just clear speaker separation via space + a small `label` name.
- **Message — agent prose:** sans, full width.
- **Action step:** mono line with a leading state glyph (`›` queued, `⠿` running, `✓` done, `✕` failed), colored by agent-state token. Groups of steps collapse into one expandable "Action" card.
- **Action Preview card:** title (what + which app), the mono step list, and `Approve` / `Deny`. `Approve` uses `--accent`; the card border uses `--awaiting` (amber) while pending. This is the highest-contrast element in the app, by design.
- **Device chip:** dot (state color) + name + capability hint ("has Excel, Photoshop"). Drives later cross-device routing.
- **Command bar:** mono input, send affordance, `⌘K` focus, optional slash-commands (`/skill`, `/device`).
- **Agent status pill:** persistent, tiny — a dot + word (`idle / thinking / acting / awaiting / error`) so state is always answerable at a glance.
- **Skill list:** name + one-line description + on/off. Plain, scannable.

---

## 8. Motion

Sparse and meaningful — no library, use the platform's implicit animations.
- **Thinking:** a single 1.2s ease-in-out opacity pulse on the `⠿` glyph (the "breathing" agent). Nothing else moves.
- **New message / step:** 120ms fade + 4px rise. Stagger steps by 40ms.
- **Approval sheet (mobile):** 220ms spring up; dim behind. It should feel like the app *leaning in*.
- **State change:** 160ms color cross-fade on the status pill/dot.
Respect `prefers-reduced-motion`: drop to instant + opacity only.

---

## 9. Accessibility & lightweight budget

- Contrast ≥ 4.5:1 for text on every surface (the palette above clears this); never signal state by color alone — pair every state with its glyph + word.
- Full keyboard path on desktop; 48dp min targets on mobile.
- **Perf budget:** 2 variable font files (~few hundred KB total) or system fallback; no icon webfont (use a tiny SVG/Lucide subset or built-in glyphs); ≤ a handful of UI packages; first frame fast, input never blocked while the agent works. Glass-blur on exactly two surfaces.

---

### Design tokens → one source of truth
Define these tokens once (a Dart `theme.dart` for Flutter; CSS custom properties if any web view exists) and reference them everywhere — no hard-coded hex or px in widgets. Section 2–4 above is that source of truth.
