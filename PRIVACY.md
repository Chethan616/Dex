# DEX privacy policy

*Last updated: 15 October 2026*

DEX is a free, open-source AI agent that runs on your own Windows PC, with an Android app to reach it from your phone. Chethan Krishna (GitHub: Chethan616) makes it. This policy covers **DEX for Android** and the sync it shares with DEX on your PC. The source code for both is public at <https://github.com/Chethan616/Dex>, so anything said here can be checked there.

## The short version

- DEX does its work **on your PC**. The phone app is a remote for it.
- To link the phone and the PC, DEX keeps a copy of your tasks in **your DEX account**. That's Google Firebase, under your account only.
- There are **no ads, no analytics and no tracking** in the Android app. Your data isn't sold or shared.
- You can **delete your account and everything synced** from the app at any time: Settings › Delete account.

## What the Android app stores, and why

When you sign in, DEX creates or uses **your DEX account**. That's an email address and a password, handled by Firebase Authentication (Google). The password is never stored by DEX itself.

So you can see and steer your PC's tasks from your phone, DEX keeps these in Cloud Firestore (Google), under your account:

| What | Why | How long |
|---|---|---|
| **Your PCs and phones**: an ID for each device, their names (e.g. the PC's name, the phone's model), Android or Windows version, whether they're online, which AI engines the PC has, its approval setting, and the phone's notification token | To show your PCs, reach them, and tell you when a task needs you | Until you delete them or your account |
| **Your tasks**: their titles, what you asked, DEX's replies and steps, approval requests and your answers, and the cards and buttons DEX shows | To show and continue your tasks on the phone | Until you delete your account |
| **Commands** you send from the phone: new tasks, follow-ups, pause/stop, approvals | So DEX on your PC can carry them out | Until you delete your account |
| **Files on their way** between the phone and the PC: photos or files you attach, and files you open from a task | To move them between your devices | Deleted after they're delivered, and swept within about an hour |
| **Your DEX profile**: the bot avatar, colour and name you picked | To show the same DEX on both devices | Until you delete your account |

Firestore's security rules let **only your signed-in account** read or write this data. It's encrypted in transit (HTTPS) and at rest by Google. It isn't end-to-end encrypted. Google stores it for DEX as a service provider, under [Google's terms for Firebase](https://firebase.google.com/support/privacy).

## What DEX does not do

- **No ads, no analytics, no crash reporting** in the Android app.
- **No selling or sharing** of your data with anyone.
- **No microphone access.** When you speak a task, Android's own speech screen turns it into text. That's usually Google's, under its own policy, and DEX only receives the text.
- **No contacts, location, photos library or call logs.** A file or photo only reaches DEX when you pick it or share it to DEX.

## The AI that does the work

DEX on your PC runs the AI engine **you** choose and sign in to: Claude Code, Codex, or a provider you bring a key for. When you start a task from your phone, the PC sends it to that provider under **your own account and its privacy terms**. DEX doesn't run an AI service of its own and doesn't see those conversations, beyond the copy synced to your account as described above.

## Pictures in results

Result cards (e.g. hotels or flights) can show pictures that load from the websites they come from. Those sites see an ordinary image request from your phone.

## Deleting your data

- **In the app:** Settings › **Delete account**. Enter your password, and DEX deletes everything listed above, then the account itself. It can't be undone.
- **Without the app:** see [How to delete your DEX account](docs/delete-account.md).
- DEX on your PC keeps its own tasks and files **on your PC**. Remove them there by deleting tasks or uninstalling DEX.

## Children

DEX isn't directed at children under 13, and doesn't knowingly collect their data.

## Changes

If this policy changes, the new version is published here with a new date. The history of every change is public in the repository.

## Contact

Questions or requests: open an issue at <https://github.com/Chethan616/Dex/issues>, or write to the developer email shown on DEX's Google Play listing.
