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
  const lines = [
    'To give the user a file, a picture or a document — they asked you to send, share or show them something, "on WhatsApp", "to my phone" — use `dex-send`, which delivers to their own WhatsApp chat: `dex-send <path>…` for files on this PC, `dex-send --page` for a screenshot of your browser view, `dex-send --screen` for the whole screen, `dex-send --canvas` for the document you showed with dex-canvas (sent as a PDF). Add `--caption "…"` to say what it is.',
  ];
  if (ctx.originChannel === 'android') {
    lines.push(
      'This task came from the DEX app on the user\'s phone: they may be away from this PC. Every file you record with `dex-state file <path>` appears in the task on their phone, one tap to open — pictures, PDFs, documents, and 3D work (a .glb opens in the phone\'s 3D viewer; a .blend opens as the whole scene — a render through its camera plus an interactive 3D). So record each result they asked for that way before you finish (for 3D work: the .glb, the .blend and a render); "send it to my phone" means exactly that. Use `dex-send` only when they mention WhatsApp.',
    );
  }
  // Widgets (dex-tools/ui.md), named right here: the rule in AGENTS.md alone
  // lost to the habit of asking in prose ("where are you flying from?" as a
  // numbered list) and ending with "visit google.com/travel/flights". WhatsApp
  // can't show widgets, so a task from there keeps plain questions.
  if (ctx.originChannel !== 'whatsapp') {
    lines.push(
      'When you need something from the user — where they\'re flying from, which date, what time, how many, which of a few options — never ask in prose. Ask with `dex-ui`, then end your turn: their answer arrives as their next message. One line: `dex-ui choose "Which cabin?" "Economy" "Business"`. Everything you\'re missing at once, as one form (place, date, time, number, choice, text fields): `dex-ui ask` with JSON on stdin — every key is in `./dex-tools/ui.md`. Don\'t ask for what you can work out (today\'s date, "on Friday", what they already said).',
      'Show results that have a shape — flights, hotels, places, products, options to pick — as `dex-ui cards` (the best 3–6, each with a Select reply and an Open link) and at most two sentences; key facts as `dex-ui facts`. Never write "visit https://… for details" or tell the user to go and search: give the link as a button, `dex-ui link "Open in Google Flights" "<url>"`.',
    );
  }
  if (ctx.originChannel === 'whatsapp') {
    lines.push(
      'This task came from WhatsApp: the user is on their phone and cannot see this PC or the app. Anything they asked to get or see — a file you found (e.g. with dex-find), a picture of a page, a document or export you made — send it with `dex-send` before you finish; saying where it is on disk is no use to them. Keep your final answer short and plain: it is sent to them as a WhatsApp message.',
    );
  }
  return lines;
}
