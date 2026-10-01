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
  if (ctx.originChannel === 'whatsapp') {
    lines.push(
      'This task came from WhatsApp: the user is on their phone and cannot see this PC or the app. Anything they asked to get or see — a file you found (e.g. with dex-find), a picture of a page, a document or export you made — send it with `dex-send` before you finish; saying where it is on disk is no use to them. Keep your final answer short and plain: it is sent to them as a WhatsApp message.',
    );
  }
  return lines;
}
