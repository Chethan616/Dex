# DEX on Google Play

Everything needed to publish **DEX for Android** on Google Play: the build, the listing, and the answers to Play Console's forms. The listing text is final copy: paste it as it is.

## What gets uploaded

The bundle is built from the **play** flavor:

```
cd android
./gradlew :app:bundlePlayRelease
```

The output is `app/build/outputs/bundle/playRelease/app-play-release.aab`. The same command also writes `app/build/outputs/native-debug-symbols/playRelease/native-debug-symbols.zip`.

A copy of each release is kept in `android/release/` as `DEX-android-<version>-play.aab` and `DEX-android-<version>-play-native-debug-symbols.zip`. That folder is gitignored, and neither file goes into the repo.

**Native debug symbols.** Play warns: "This App Bundle contains native code, and you've not uploaded debug symbols."
- DEX's only native code is two AndroidX libraries: Compose's path helper and DataStore's shared counter.
- Google ships both already stripped, so there are no symbols for the build to put in the bundle.
- The zip holds them as they are, keeping their exported entry points, which is what Play can use. It isn't a full symbol file.
- Upload it with every bundle: Play Console › **Test and release › App bundle explorer** › pick the version › **Downloads** › *Native debug symbols* › **Upload**. The warning goes away, and native crashes show those function names.

### How the Play build differs from the GitHub APK (`assembleGithubRelease`)

| | GitHub APK | Play bundle |
|---|---|---|
| Updates | Itself, from GitHub Releases (`update/AppUpdater.kt`) | Google Play only. Play forbids any other updater, so this build has none. |
| `REQUEST_INSTALL_PACKAGES` | Yes | Removed (`src/play/AndroidManifest.xml`) |
| Settings › Updates | Check / download / install | "Version x · Google Play keeps DEX up to date" |
| Everything else | Same | Same |

Both are signed with the same release key (certificate SHA-256 `2f727fa5…`), from `~/.gradle/gradle.properties` (`DEX_RELEASE_*`).

**Before every upload:**
- Raise `versionCode` in `android/app/build.gradle.kts`. Play refuses a code it has seen.
- Keep `versionName` at or above the GitHub APK's.

**Checked for 2.0.1 (versionCode 38):**
- targets API 36;
- every native library supports 16 KB pages;
- the bundle and both APKs are signed with the release key;
- the Play build has no APK-install code (R8 strips it).

## 1. Create the app (Play Console)

1. Play Console › **Create app**.
   - Name: **DEX: AI agent for your PC**
   - Default language: English (United States)
   - App, Free
   - Accept the declarations.
2. **App signing** (shown at the first upload). This choice can't be changed later.
   - **Recommended:** *Use a different key › Export and upload a key from Java keystore.* Use DEX's existing release key, so the Play build and the GitHub APK are the same app to Android. People can then move between them without uninstalling or losing their sign-in.
   - Play Console gives you a `pepk.jar` and an encryption key file for this app. Run its command against the keystore in `DEX_RELEASE_STORE_FILE`, with the alias `dex`, and upload the `.zip` it makes.
   - If you choose Google's own key instead, the Play build and the GitHub APK can't update each other. Someone switching must uninstall first.
3. Upload **`DEX-android-2.0.1-play.aab`** to a testing track first (see §4).

## 2. Store listing (Grow › Store presence › Main store listing)

**App name** (max 30): `DEX: AI agent for your PC`

**Short description** (max 80):

> Start, watch and approve tasks for the AI agent on your PC, from your phone.

**Full description** (max 4000; plain text, since Play shows no Markdown):

> DEX is a free, open-source AI agent that works on your Windows PC: in a real browser, your files and your apps, while you keep using the computer. DEX for Android puts it in your pocket.
>
> Start a task from anywhere. Type or say what you want: "Find the cheapest flight to Goa this Friday for 2", "Reply to my landlord's mail and put the inspection in my calendar", "My Wi-Fi keeps dropping, find out why and fix it". Your PC gets to work.
>
> Watch it live. Every step shows up as it happens, with a live update in your status bar on Android 16. You're told when it's done.
>
> Approve from the notification. When DEX wants to do something risky, it asks first. Approve or deny right from the notification. Steps that are hard to undo or need admin rights open in the app.
>
> Answers you can tap. Results come back as cards and buttons: flights, hotels, places, options. They're not walls of text.
>
> Send anything to DEX. Share a link, a photo or a PDF from any app to DEX and say what to do with it. Files DEX makes on your PC open right on your phone.
>
> Routines. Ask DEX to do something every morning or every week, and see each routine as a simple step-by-step graph.
>
> Your PC, your accounts. DEX runs on your own computer with the AI you choose: Claude Code, Codex, or your own key. Your logins and files stay on your PC.
>
> How to start
> 1. Install DEX on your Windows 10 or 11 PC from github.com/Chethan616/Dex (free).
> 2. In DEX on the PC, open Settings › Accounts › DEX on your phone and create your DEX account.
> 3. Sign in here with the same email and password. That's the whole pairing.
>
> DEX is open source under Apache-2.0. No ads and no tracking.

**Graphics:**
- App icon: `icon-512.png` (512×512, from the launcher icon; Play rounds the corners).
- Feature graphic: `feature-graphic-1024x500.png`.
- Phone screenshots: at least 2 and up to 8, taken on the phone (Power + Volume down). In order:
  1. Home with a few tasks;
  2. a task with result cards (flights or hotels);
  3. an approval (the banner, or the notification with Approve / Deny);
  4. the live update in the status bar;
  5. `/workflow` cards, or a routine's graph;
  6. Settings.

  Use **dark mode** for all of them, so they match the graphics.

**Category:** Productivity. **Tags:** AI assistant, Productivity, Remote control.
**Contact details:** your developer email. **Website:** `https://github.com/Chethan616/Dex`

## 3. App content (Policy › App content)

| Form | Answer |
|---|---|
| **Privacy policy** | `https://github.com/Chethan616/Dex/blob/main/PRIVACY.md` |
| **Ads** | No ads |
| **App access** | *All or some functionality is restricted.* Instructions: "Sign in needs a DEX account. Use the test account below, or tap Create account. DEX for Android is a remote for DEX on a Windows PC. Without a PC paired you can still see Home, Settings, and a 30-second demo task (Settings › Feel › Try a live update)." Add a test account's email and password. Make a separate account for this; don't use your own. |
| **Content rating** | Category: *All other app types*. No violence, sexual content, profanity, drugs or gambling. Users can't interact with or share content with other users. No location sharing and no purchases. DEX shows replies from the user's own AI. |
| **Target audience** | **18 and over.** DEX acts on the user's accounts and PC, and this keeps it out of the Families program. |
| **News app** | No |
| **Data safety** | See below |
| **Government / financial / health features** | None |
| **Foreground service permissions** | *Data sync.* "While a task the user started runs on their PC, DEX shows a quiet ongoing notification ('Working on your PC · <task>') that follows the task's latest step from the user's DEX account, so the user can watch it and approve steps from the notification. It stops as soon as nothing is running." Video: record the phone starting a task, then the ongoing notification, then the Done notification. |
| **Account deletion** | In the app: Settings › Delete account. Web: `https://github.com/Chethan616/Dex/blob/main/docs/delete-account.md` |

### Data safety

- **Collects or shares user data:** Yes.
- **Encrypted in transit:** Yes.
- **Users can ask for deletion:** Yes (in the app, and the web link above).
- **Shared with third parties:** None. Firebase (Google) is a service provider, which isn't "sharing".

| Data type | Collected | Required? | Purposes |
|---|---|---|---|
| Personal info › Email address | Yes | Required | Account management, App functionality |
| Messages › Other in-app messages (the tasks and DEX's replies) | Yes | Required | App functionality |
| Photos and videos › Photos | Yes | Optional (only ones the user attaches) | App functionality |
| Files and docs | Yes | Optional (only ones the user attaches or opens) | App functionality |
| Device or other IDs (device ID and notification token) | Yes | Required | App functionality |

Everything else (location, contacts, audio, health, financial info, app activity, web history, diagnostics) is **not collected**.

## 4. Testing, then production

- **Internal testing** is available at once, for up to 100 people you add by email. Upload the bundle there first and install it from the Play link.
- A **personal** developer account created after 13 Nov 2023 must run a **closed test with at least 12 testers for 14 days in a row** before it can apply for production. An organisation account doesn't.
- **Production:** after that, promote the same release. Google's review usually takes a few days.

**Release notes, 2.0.1** (max 500):

> DEX for Android is now on Google Play.
> - Routines: ask DEX to do something every morning or every week, and see each one as a step-by-step graph.
> - Approvals say what kind of step they are, and the riskiest ones open in the app.
> - Settings › Delete account removes your account and everything synced for it.

## Open points

- **AI-generated content policy.** Play asks apps that show generative-AI output to let users report offensive output from inside the app. DEX shows replies from the user's own AI, so it may be in scope. A **Report** action on DEX's replies would need a small `reports` collection in `firebase/firestore.rules`, and deploying the rules needs the owner's OK.
- **The account's own Firestore document** (`users/{uid}`, holding the DEX profile) is emptied rather than deleted on account deletion. The rules let the owner write it, not delete it. One line, `allow delete: if isOwner(uid);`, plus a rules deploy (owner's OK) makes the deletion complete. The app already tries a real delete first.
