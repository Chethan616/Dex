# DEX ⇄ phone via Firebase

DEX on your PC and DEX for Android talk through Firebase — no server of our
own, no ports opened, no pairing codes.

```
 DEX desktop (Electron)                     Firestore                         DEX Android
 ─────────────────────                      ─────────                         ───────────
 signs in with email + password   ──►  users/{uid}/devices/{pc}    ◄──  signs in with the same
 (Settings → Accounts → phone)           users/{uid}/sessions/{id}         email + password → same uid
 mirrors every task + chat blocks ──►     └ blocks/{seq}            ──►  live chat view
 runs commands                     ◄──   users/{uid}/commands/{id}  ◄──  new task, follow-up,
                                                                          pause/stop, approve
                      Cloud Function: session row changed ──► FCM push ──► notification
```

* **Pairing is the account.** Both sides sign in to Firebase Auth with the
  same email and password (Email/Password provider); same account → same uid
  → same data. The desktop keeps the pair in Windows Credential Manager. Rules (`firestore.rules`)
  confine every read/write to `users/{uid}`.
* **Desktop writer:** `desktop/app/src/main/firebase/bridge.ts`. It reuses the
  logs window's transcript reducer, so the phone shows exactly the blocks the
  desktop shows. Writes are debounced (~700ms) and diffed per block.
* **Phone:** `android/` — Jetpack Compose, Material 3 Expressive.
* **Free plan only (Spark) — no billing account.** Firestore + Auth, nothing
  else:
  * Notifications are local: the Android app watches its sessions itself
    (`notify/TaskWatcher.kt`) — no Cloud Function, no server.
  * Pictures/files reach the phone through Firestore on request (`fetch_file`
    → `transfers/{id}/chunks`, ~700 KB each, deleted after download) with an
    inline JPEG preview on each picture — no Cloud Storage.
  * There is deliberately no `functions/`: Cloud Functions need the paid
    Blaze plan, and nothing here requires them.

## Set up (once)

```powershell
powershell -ExecutionPolicy Bypass -File firebase\setup.ps1
```

It uses the project `dexv3-chethan616`, registers the Android app
(`com.chethan616.dex`) and the desktop's web app, writes
`android/app/google-services.json` and `desktop/app/config/firebase.json`,
enables Email/Password sign-in, and deploys the rules. No billing account needed.
Then restart DEX → Settings → Accounts → **DEX on your phone** → sign in (or
create an account), and use the same email and password in the Android app.

## Slack relay

`hosting/oauth/slack.html` is only needed if your Slack app refuses the
`http://127.0.0.1` redirect: `firebase deploy --only hosting`, then register
`https://<project>.web.app/oauth/slack.html` as the Slack redirect URL.
