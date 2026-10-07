import type { SpawnContext } from './types';

/**
 * Prompt lines about getting things *to* the user: `dex-send`, and — for a
 * task that came from their phone — the fact that they can't see this PC.
 *
 * Shared by every engine adapter. Like dex-find and dex-canvas, it's named
 * right in the prompt: a tool that only a skill doc mentions is a tool the
 * agent doesn't reach for.
 */
export function deliveryBriefing(ctx: SpawnContext): string[] {
  const chat = ctx.originChannel === 'whatsapp' ? 'WhatsApp' : ctx.originChannel === 'telegram' ? 'Telegram' : null;
  const lines = [
    'To give the user a file, a picture or a document — they asked you to send, share or show them something, "on WhatsApp", "on Telegram", "to my phone" — use `dex-send`, which delivers to their own chat (the WhatsApp or Telegram chat this task came from, else their WhatsApp "Message yourself" chat or their DEX bot on Telegram): `dex-send <path>…` for files on this PC, `dex-send --page` for a screenshot of your browser view, `dex-send --screen` for the whole screen, `dex-send --canvas` for the document you showed with dex-canvas (sent as a PDF). Add `--caption "…"` to say what it is.',
  ];
  if (ctx.originChannel === 'android') {
    lines.push(
      'This task came from the DEX app on the user\'s phone: they may be away from this PC. Every file you record with `dex-state file <path>` appears in the task on their phone, one tap to open — pictures, PDFs, documents, and 3D work (a .glb opens in the phone\'s 3D viewer; a .blend opens as the whole scene — a render through its camera plus an interactive 3D). So record each result they asked for that way before you finish (for 3D work: the .glb, the .blend and a render); "send it to my phone" means exactly that. Use `dex-send` only when they mention WhatsApp.',
    );
  }
  // Widgets (dex-tools/ui.md), named right here: the rule in AGENTS.md alone
  // lost to the habit of asking in prose ("where are you flying from?" as a
  // numbered list) and ending with "visit google.com/travel/flights". A chat
  // app can't show widgets, so a task from WhatsApp or Telegram keeps plain
  // questions.
  if (!chat) {
    lines.push(
      'When you need something from the user — where they\'re flying from, which date, what time, how many, which of a few options — never ask in prose. Ask with `dex-ui` (a command on your PATH: run it with Bash; it is not an MCP tool), then end your turn: their answer arrives as their next message. One question with options: `dex-ui choose "Which cabin?" "Economy" "Business"`. Everything you\'re missing at once, as one form — `dex-ui ask <<\'EOF\'`, then `{"title":"Where and when are you flying?","fields":[{"id":"trip","kind":"choice","label":"Trip","options":["One way","Round trip"]},{"id":"from","kind":"place","label":"From","suggestions":["Hyderabad (HYD)","Bengaluru (BLR)"]},{"id":"date","kind":"date","label":"Depart"},{"id":"back","kind":"date","label":"Return","showIf":{"field":"trip","is":"Round trip"}},{"id":"pax","kind":"number","label":"Travellers","min":1,"default":1}]}`, then `EOF`. A field that only matters for some answers gets `showIf` (`{"field":"trip","is":"Round trip"}`): ask one way or round trip, never assume a round trip. Field kinds: choice (options), place (suggestions), date (range:true for two days), time (slots "HH:MM"), number (min, max, unit), text; more in `./dex-tools/ui.md`. If it says the spec doesn\'t fit, fix what it names and run it again — don\'t fall back to prose. Don\'t ask for what you can work out (today\'s date, "on Friday", what they already said).',
      'Show results that have a shape — flights, hotels, places, products, options to pick — as `dex-ui cards` (the best 3–6, each with a Select reply and an Open link) and at most two sentences; key facts as `dex-ui facts`. Never write "visit https://… for details" or tell the user to go and search: give the link as a button, `dex-ui link "Open in Google Flights" "<url>"`.',
    );
  }
  if (chat) {
    lines.push(
      `This task came from ${chat}: the user is on their phone and cannot see this PC or the app. Anything they asked to get or see — a file you found (e.g. with dex-find), a picture of a page, a document or export you made — send it with \`dex-send\` before you finish; saying where it is on disk is no use to them. Keep your final answer short and plain: it is sent to them as a ${chat} message.`,
    );
  }
  return lines;
}
