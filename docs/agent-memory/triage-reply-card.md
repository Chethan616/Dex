---
name: triage-reply-card
description: "The reviewer's urgency × importance reply card (built 2026-10-18, c01c677d) — widget `triage`, /triage commands, widget_update, phone sheet"
metadata:
  node_type: memory
  type: project
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-10-18T05:27:13.475Z
---

**Reviewer's ask, 2026-10-17.** Asked to reply to a batch of mail, WhatsApp, Telegram or Slack, DEX shows a gen-UI plot: urgency across, importance up, the axes through the middle (the sketch is `review/sir1.png`). Tapping a point opens the message, neatly, with a drafted reply and Yes / No / Specify. Replying to one named message or person happens automatically. A batch of more than 5 gets the plot; 5 or fewer get the same card as a list.

**Built in c01c677d:**
- `shared/triage.ts`:
  - schema, corners (Reply now / Quick reply / Plan a reply / Later), ordering;
  - the agent's shapes are read leniently: one score scale per card, so 0.5 on a 0–10 card stays low;
  - `/triage yes|no|change <card> <item> [text]` commands; `triagePrompt` turns them into the agent's instruction; `typedTriage` gives the display line.
- `main/index.ts`:
  - `answerTriage` catches the commands in `sessions:resume` and the phone's followUp. No → `widget_update` skipped, with no agent turn;
  - routes `/dex/ui-update` for `dex-ui mark` and `dex-ui redraft`.
- `widget_update` HlEvent: the transcript folds it into the widget. Turns fold each answer's work into the card's turn, so the card stays last.
- Hub: `hub/chat/Triage.tsx`.
- Phone: `ui/components/Triage.kt` (compact card plus a full-screen answer sheet). The bridge sends `wid` on widget blocks and `answer` on user blocks.
- Agent docs: ui.md's Triage section and an AGENTS.md row.

**Still to do:**
- Not yet run live on real mail.
- Phone needs a new APK (versionName above 2.0.1, Play versionCode 40).

Related: [[widgets-genui]], [[dex-memory-design]].
