---
name: second-pc
description: The second Windows PC (user srira) works on DEX in a worktree at D:\Projects\Dex-unify; it has no Android signing keys, so no releases from it
metadata:
  type: project
---

Since 2026-10-14 DEX work also happens on a second Windows 11 PC (user `srira`, a collaborator's machine), not only the owner's.

- `D:\Projects\DEX` there is an older clone on branch `RUST` with **uncommitted work of its own**: never switch branches or clean it. `unify` is a separate git worktree at `D:\Projects\Dex-unify`.
- Yarn 1.22.22 was installed to the user npm prefix there (`npm i -g yarn@1.22.22`, no admin). A git dependency (libsignal-node) can time out on the first `yarn install`: just run it again.
- **No signing material** on that PC: no `~/.gradle/gradle.properties`, keystore, `google-services.json`, `config/firebase.json` or `config/oauth-clients.json`. A release (phone APK) can't be done there; stop and tell the owner.
- The owner's sign-ins (Google, GitHub, Telegram…) live in the other PC's credential store, so DEX live tests there start signed out.
- No `UI/` notes folder there.

**Why:** the owner asked to carry on from this machine; the hand-over said what doesn't travel through git.

**How to apply:** check `git worktree list` before assuming where `unify` is; never do item-6-style releases here. Related: [[release-process]], [[keep-resume-log]].
