---
name: licensing
description: DEX is Apache-2.0 since 2026-10-07 (MIT up to v3.2.0) with NOTICE credit to Chethan Krishna; libsignal GPL exception; run yarn licenses:scan
metadata:
  node_type: memory
  type: project
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-10-07T07:45:43.166Z
---

On 2026-10-07 the owner relicensed DEX from MIT to **Apache-2.0**. They asked for a license that isn't MIT, makes anyone who takes DEX credit them, and stays friendly to contributors, so they can attract stars, forks and issues.

- **NOTICE** credits "Chethan Krishna (@Chethan616)". Apache §4(d) makes redistributors carry it.
- **Both apps show the credit:** desktop Settings › Application, phone Settings › About.
- **Upstream MIT notice:** Browser Use's is kept in `desktop/LICENSE-browser-use`.

**The one license conflict:** `libsignal` (GPL-3.0), pulled in by Baileys for WhatsApp.
- The source stays Apache-2.0; the installer is a GPL-3.0 combined work.
- Plan: make WhatsApp an optional download.

**How to apply:**
- Before any release, run `yarn licenses:scan` in desktop/app. It fails on any new non-permissive package.
- Add new dependencies to LICENSES.md.
- Never add GPL, AGPL or non-commercial libraries to the app.
- The owner's display name on GitHub is "Chethan Krishna".

Related: [[release-process]].
