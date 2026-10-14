---
name: site-memory-and-commands
description: "DEX's site-memory store and the /scrape and /bugbounty slash commands — where notes live, how commands work"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5ae4348a-e526-4633-ad61-df8cdcdb9aa9
  modified: 2026-09-13T10:13:35.614Z
---

DEX remembers sites it has mapped or reviewed, and exposes two slash commands
for building that memory. Added on 2026-09-11, on branch `feat/mcp-connections`.

**Site memory** lives at `%APPDATA%\DEX\site-memory\`, one Markdown file per
host (`vit.ac.in.md`, and `vit.ac.in.security.md` for a review). It survives
every harness rewrite because it sits in userData, not the harness tree. The
agent is told the path through `DEX_SITE_MEMORY_DIR`, injected in
`desktop/app/src/main/hl/engines/browserHarnessEnv.ts`. `AGENTS.md` tells the
agent to read a site's note before browsing it, so a mapped university portal
is navigated straight to the right page instead of re-explored.

**Slash commands** are prompt expansion, not a new dispatcher. Typing
`/scrape <url>` or `/bugbounty <url>` is rewritten into a full instruction in
the renderer before it reaches the engine —
`desktop/app/src/renderer/hub/slashCommands.ts`, wired into `TaskInput.tsx`'s
submit. Unknown slashes pass through untouched. To add a command, add an entry
to `SLASH_COMMANDS` and a skill file under `stock/dex-tools/`.

- `/scrape` → `stock/dex-tools/scrape.md`: map a site's pages, navigation and
  controls into site memory. Structure reconnaissance only, nothing behind a
  login the user has not already entered.
- `/bugbounty` → `stock/dex-tools/bugbounty.md`: **observation-only** security
  review (headers, TLS, exposed conventional paths, library versions, form and
  cookie hygiene, info disclosure). Opens with a hard authorization gate — the
  target must be owned, in a public bug-bounty scope, or explicitly permitted —
  and does no exploitation, injection, auth bypass, brute force, or DoS. That
  boundary is deliberate; keep it if extending the skill. See
  [[llm-provider-limits]] for why runs are token-sensitive.
