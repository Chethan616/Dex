---
name: channels
description: Settings › Channels order the owner chose (phone, WhatsApp, Telegram, Advanced) and how the Telegram bot channel works
metadata:
  type: project
---

**Order (owner, 2026-10-07):** Settings › Channels lists, top to bottom:
1. DEX on your phone (`PhoneCard.tsx`);
2. WhatsApp;
3. Telegram (`TelegramCard.tsx`);
4. "Advanced — connect with a token" (the old McpSection, folded in a `<details>`).

Keep that order. The phone card moved here from the deleted Accounts section.

**Telegram** (`main/channels/TelegramAdapter.ts`, shipped in v3.3.0):
- It's the user's own @BotFather bot, reached by long-polling the Bot API from the PC. There's no server.
- The token and owner are in keytar `DEX/telegram`; the token is never logged or sent to the renderer.
- A `t.me/<bot>?start=<code>` link (or its QR) pairs the first person who opens it; strangers are told the bot is private.
- Any message starts a task and a reply continues one, via the shared `ChannelRouter` (`ChatAdapter`).
- **Not yet live-tested** with a real bot. Telegram inline-keyboard widgets are an open idea (TO_BE_DONE §3.9).

**Why:** the owner wanted every way to reach DEX in one place, phone first.

**How to apply:** a new channel goes between Telegram and Advanced, implements `ChatAdapter`, and keeps its secret in keytar.

Related: [[phone-and-accounts]], [[connectors-marketplace]].
