---
name: codex-in-repo
description: The user also runs OpenAI Codex on this repo; its work shows up as uncommitted changes to review and commit
metadata:
  type: project
---

The user also works on DEX with OpenAI Codex. Its changes land **uncommitted** in the working tree; on 2026-10-06 that was the Reddit and Microsoft 365 accounts and MCP servers in `desktop/app`.

**Why:** The user asks me to "see the new stuff" and expects it integrated, but it isn't committed or reviewed yet.

**How to apply:** When resuming, run `git status` first.
- Review Codex's changes: look for secrets, run tsc and vitest.
- Commit them on their own, saying they were written with Codex.
- Never mix them into my own commits.

Related: [[release-process]], [[unify-workspace-plan]].
