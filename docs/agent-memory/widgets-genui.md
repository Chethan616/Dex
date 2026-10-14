---
name: widgets-genui
description: "Owner wants DEX to ask with widgets (generative UI from a fixed kit) and fetch via MCP, not prose questions or browser driving; dex-ui built 2026-10-07"
metadata:
  node_type: memory
  type: feedback
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-10-07T06:17:56.731Z
---

On 2026-10-07 the owner saw a phone-started flight task do three things wrong:
- ask "where are you flying from?" as prose;
- drive Google Flights for 61 browser steps;
- end with "visit google.com/travel/flights".

**Their rules:**
- Ask with a widget (place, date and time pickers), not text.
- Use a button ("Open in Google Flights"), never "visit this link".
- Generative UI must be cheap, so predefined components rather than generated pages.
- Fetch data through MCP, not the browser ("for everything").
- "I value UX more than anything."
- No emojis in the live update ("vibecoded"): keep the task's own bot and use clean white glyphs (Apple-HIG-like) for the kind of task.
- The live update is **one colour**: a blue track, and the bot's shape and face tinted a lighter blue. No phone or flag icons at the track's ends, no per-segment colours. Tasks with no glyph show the DEX mark (2026-10-07: "current one is too colourful, I need like the old one, single colour").

**Why:** they judge DEX by how it feels to use from the phone; prose questions and browser grinding read as unpolished and slow.

**How to apply:**
- Built (commit b893f9cc):
  - `dex-ui` (dex-tools/ui.md);
  - `shared/widgets.ts` (the schema and answer wording);
  - `hub/chat/Widgets.tsx` and the phone's `ui/components/Widgets.kt`.
- Answers go back as the user's next message.
- Extend this kit rather than adding prose prompts.
- The MCP-first plan (keyless connectors attached by topic, Kiwi before Google Flights) is in TO_BE_DONE §3.8, not built yet.

Related: [[connectors-marketplace]], [[reactions-selective]], [[fluidity-first]].
