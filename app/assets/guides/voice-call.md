# Connect Voice calls

Call Dex on a real phone number and talk to it — or have Dex call you to read something out.

## What you need

A voice provider account (e.g. Twilio) for a phone number and webhook. Dex uses it to place and receive calls.

## Link it (about 10 minutes)

1. Create a phone number with your voice provider (Twilio Console → Phone Numbers).
2. In Dex, open this app and tap **Enable voice calls**, then paste your provider credentials (Account SID, Auth Token) and the number.
3. Dex gives you a **webhook URL** — paste it into your provider's number config (Voice → "A call comes in").
4. Run a smoke test: in Dex, tap **Test call** (or run `dex voicecall smoke --to "+1..." --yes`). Your phone rings with a short spoken test.

## Use cases

- **Call your PC:** dial the number, ask "what's my next meeting?", hear the answer.
- **Dex calls you:** "Call me at 8am and read my calendar for the day."
- **Hands-free while driving:** issue commands by voice; Dex runs them on the desktop.

## Notes

- Conversation mode (back-and-forth) needs a speech provider configured under **Speech & voice**.
- Calls cost whatever your voice provider charges; Dex itself adds nothing.
- The webhook must be reachable from the internet (your provider calls it). Tailscale Funnel or a tunnel works for home setups.
