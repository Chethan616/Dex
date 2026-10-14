---
name: keep-resume-log
description: "Keep the \"RESUME HERE\" block at the top of TO_BE_DONE.md current as you work, so a session after a context reset continues instead of guessing"
metadata:
  node_type: memory
  type: feedback
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-10-14T11:03:55.567Z
---

The owner (2026-10-14): "before u run out of context make sure to write everything so u can later read that so u understand and continue instead of blind hallucinating."

**Why:** long sessions get compacted; a week-long gap already made the owner lose track of where the work was.

**How to apply:**
- The live log is the "▶ RESUME HERE" block at the top of `TO_BE_DONE.md`: done/pushed commits, what's uncommitted and its state, the owner's open requests as a checklist, and the live-test recipe.
- Update it at each milestone (every commit, every new owner request), not only at the end.
- After a reset: read that block and `git log` before touching code.
- At a checkpoint the owner asked for (2026-10-14): also copy this memory folder into the repo at `docs/agent-memory/` (scan for secrets and the owner's email first; the repo is public), commit it with TO_BE_DONE.md and the plan files, and push `unify` and `unify:main`.

Related: [[project-overview]], [[unify-workspace-plan]].
