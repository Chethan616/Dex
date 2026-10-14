---
name: reactions-selective
description: "Only DEX reacts, selectively (👍 to a go-ahead after it asked, ❤️ to thanks); users can't react; small corner badge like Grok"
metadata:
  node_type: memory
  type: feedback
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-10-07T07:45:38.473Z
---

**Only DEX reacts.** The user can't react at all (no long-press bar, no emoji picker, no hover smiley). Their reason: "I shouldn't have access to it… it looks bit off".

**When DEX reacts:** only when a reaction says it better than words. It follows `autoReaction` in shared/reactions.ts, applied in SessionManager.resumeSession:
- 👍 to a plain go-ahead ("ok go on", "book it"), but only when DEX's last turn asked something;
- ❤️ to thanks;
- 😂 to a laugh;
- otherwise nothing.

`dex-react` is for rare other moments. A new agent reaction replaces DEX's previous one on that message.

**Why:** on 2026-10-07 the owner first said every-message reactions look cluttered ("u only think and do it to specific msgs"), then removed user reactions entirely.

**How to apply:**
- The badge follows UI/g1.png: a small emoji tucked onto the corner of the user's bubble, ringed in the page colour.
- Don't re-add user reaction UI or reactions on every message.

Related: [[widgets-genui]], [[connectors-marketplace]].
