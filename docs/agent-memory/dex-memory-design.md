---
name: dex-memory-design
description: "How DEX's own user memory must work — generic (no hard-coded uni/user), optional questionnaire + ChatGPT/Claude import, indexed recall instead of dumping every note into every prompt"
metadata:
  node_type: memory
  type: feedback
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-10-16T06:54:54.128Z
---

Owner, 2026-10-16: "dont hardcode other users may have different uni or they might not be a student at all" — DEX must learn the user, not assume them. They asked for an optional onboarding questionnaire (also in Settings, "let the agent know u better"), interactive and quick, plus "import from chatgpt or claude", and "dont waste tokens like parsing that memory every prompt, do something like graphify for the memory".

**Why:** DEX ships publicly; examples like VTOP/VIT in agent docs biased every user's agent, and a memory pasted whole into each turn grows forever.

**How to apply:**
- Built in 0972e13c. Notes live in `<userData>/memory/notes.json`, each under a topic (`shared/memoryTopics.ts`).
- `main/memory/recall.ts` indexes notes, sites and routines. Each task gets the core notes, the matches its words reach (a topic alone can match: "attendance" reaches study), and a one-line outline of the rest; `dex-recall` covers anything else.
- Questions are in `shared/aboutYou.ts` (branching via `when`); UI in `renderer/components/aboutYou`.
- Keep agent-doc examples neutral (`portal.example.edu`). Never put user-specific facts in shipped code.

Related: [[site-memory-and-commands]], [[workflows-and-routines]].
