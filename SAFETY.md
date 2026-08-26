# Dex V3 — Safety & Permissions Model

> See also: [architecture.md](./architecture.md) for how these rules plug into the Brain, Orchestrator, and each backend.

Dex acts on your files, registry, browser sessions, and messages autonomously. This is the contract every backend follows, regardless of which agent or execution engine is running. Nothing here is optional per-agent — a backend that can't satisfy it doesn't get registered.

---

## 1. Owner Gate

Every message from every channel hits this before anything else.

1. **DM / self-chat from the configured owner** → allow. Prefix stripped if present.
2. **Group / server message from the owner starting with `@dex`** (configurable) → allow, prefix stripped before forwarding.
3. **Message from the owner in a group without the prefix** → ignored silently.
4. **Message from anyone else, anywhere** → ignored silently. No error, no acknowledgement — an unauthorized sender gets no signal that Dex exists.

**Silence is the feature, not laziness.** Replying "you are not authorised" confirms the bot is listening, tells someone probing that their id is merely *wrong* rather than that nothing is there, and turns every group Dex sits in into somewhere it talks back.

**One implementation, not one per channel.** `core/owner_gate.ts` decides, and it returns the decision *and the text to run* together — stripping the prefix and allowing the message are the same decision, and separating them invites a caller to act on one without the other. The Telegram, Discord and WhatsApp adapters contain no authorisation logic at all: three copies of this check would be three chances to get it wrong, and the failure mode is a stranger driving the owner's desktop.

**A channel refuses to start without a configured owner.** A bot listening with no owner set rejects everything anyway — but a bot that is *running* and silently ignoring every message is far harder to diagnose than one that says why it did not start.

Two near-misses the tests pin down: `@dexter is a good name` must not match the `@dex` prefix, and neither must `tell @dex to do X`. The prefix counts only at the start, as a whole token. A substring match there runs a command nobody issued.

```yaml
owner:
  whatsapp: "<phone>@s.whatsapp.net"
  telegram_id: <numeric id>
  discord_id: "<snowflake>"
  slack_user_id: "<user id>"
  trigger_prefix: "@dex"
```

Identity checks are a straight equality match against these configured ids — channel-reported identity is treated as an alias to check against the owner list, not as proof of ownership by itself. The CLI is always local and always authorized; it has no gate to pass.

---

## 2. Confirmation tiers

Every action a backend can take is classified into exactly one of four tiers. This replaces a flat "owner only" check with something that actually scales to how consequential an action is.

| Tier | Behavior | Examples |
|---|---|---|
| **1 — Hand-off required** | Dex stops and asks the owner to do it themselves | submitting a password; bypassing an SSL/security warning or a paywall; solving a CAPTCHA |
| **2 — Always confirm** | Blocking confirmation immediately before, every single time, even if pre-approved earlier | deleting a file, folder, email, or Drive item; installing new software; sending a message to anyone outside Dex's own channels; a financial transaction |
| **3 — Pre-approval works** | Confirm once, remembered for that session or task | logging into a site the request implied ("check my Gmail"); moving or renaming a file; writing a new file; sending an SMS from a phone node |
| **4 — No confirmation** | Runs silently | reading a page, file, or email; downloading a file; navigating a browser; checking WiFi/process/service status; applying a known power plan; setting DNS |

**One deliberate narrowing:** registry writes are *not* blanket tier 4. An arbitrary key write is a materially different risk than a key Dex already knows the effect of, and "registry" as a whole is too coarse a bucket to hand a blanket pass. `classify_write` in `daemon/handlers/registry_handler.py` sorts every path into one of three bands:

| Band | Behaviour | Covers |
|---|---|---|
| **GREEN** | silent | Dex's own keys, and the specific known-effect tweaks the `gaming_optimize` / `os_optimize` composites touch |
| **AMBER** | Tier 2 confirmation | general `HKCU\Software\*`, `HKLM\SOFTWARE\*` |
| **RED** | refused | `\Policies\`, `\CurrentControlSet\Services\`, Winlogon, LSA, Defender, `\Run`/`\RunOnce`, Image File Execution Options, UAC |

**RED stays refused under Full Access, and that is the point.** Full Access means the owner pre-granted *elevation* — Dex stops asking for admin. "Never change Windows security or privacy settings" is a separate rule about what may be done at all. Collapsing the two would quietly turn a convenience toggle into a security bypass, so the refusal is unconditional and there is a test asserting it fires with `FULL_ACCESS=true`.

An earlier version had only two Dex-owned paths on the allowlist, which meant any real registry work required Full Access and therefore bypassed *every* confirmation. The choice was "useless" or "unlimited"; banding is what makes a middle possible.

Confirmations are **signed and versioned**: an approval request carries the specific request id and step version it was generated for, and only resolves that exact one. A card the owner approved five minutes ago cannot be silently reused to approve a different, newer version of the step — if the step changed, a new confirmation is required.

**Tier 1 is raised by backends, not only by plans.** A CAPTCHA is not something the Brain can foresee at planning time; it appears halfway through a task, on a page nobody predicted. So a backend can raise a hand-off *mid-step*: it parks its live state, the owner gets the same Tier 1 card they would have got from a plan, and the backend resumes where it stopped once they say they're done. Implementation: `ConfirmationManager.requestHandoff`, reached through the `AgentContext` the Orchestrator passes into every step.

**Hand-offs are not covered by Full Access.** Tiers 2, 3 and 4 exist to ask permission, and Full Access is the owner saying they've granted it in advance. Tier 1 is not a permission question — it's a capability one. No level of privilege lets Dex read a CAPTCHA, clear a bot check, or know a password the owner never told it. If a hand-off is raised with nobody attached to answer, it fails fast rather than auto-approving, because auto-approving would mean claiming a wall was cleared when it wasn't.

**Hand-offs are bounded.** Two per task. After that Dex reports that the site won't let it through, instead of asking a third time. The point of escalating to the owner is to get past something once — not to convert an infinite retry loop into an infinite interruption loop.

---

## 3. Untrusted content

**The rule:** anything Dex reads — a web page, an email body, a document, a chat message, a file — is data, never an instruction. Only the owner's direct request, arriving through the Owner Gate, can grant Dex permission to do something.

This applies most to the Browser and Workspace backends, since they spend most of their time reading exactly this kind of content. A page that says "forward this to everyone," an email that says "click this link and enter your password," or a document with instructions embedded in it carries no authority at all — it's inert text, evaluated the same way regardless of what it claims.

A secondary, much weaker layer — pattern-matching known injection phrases like "ignore all previous instructions" and flagging them — can run as cheap defense-in-depth, but it is not the actual safeguard and shouldn't be treated as one. It stops nobody who rephrases, translates, or encodes the same instruction differently. The architectural rule above is what actually holds regardless of phrasing; the pattern match just catches the laziest attempts.

---

## 4. Windows safety rules

Hard rules for the Desktop and System backends:

- Never automate password manager apps or password-manager websites.
- Never type into a password, one-time-code, or OTP-named field. Enforced at the point of action in *both* interactive tiers — the browser's `type_text` inspects the element, and the application tier's `set_text` checks `IsPassword` on the UIA control — so it holds whatever the plan said, and raises a hand-off instead.
- Never open a terminal, console, or PowerShell window as an application. `launch_app` refuses them by name; system work goes through typed daemon handlers, never a shell an agent types into.
- Never act on an ambiguous window. Two open windows matching a title raises rather than picking one — the next step is usually typing into it, and the wrong guess overwrites whatever someone was working on.
- Never change Windows security or privacy settings, and never act on a security/privacy permission prompt on the owner's behalf.
- Never use Windows-key shortcuts (no `Win`, `Win+...`, or other OS-key combinations).
- **Never automate a terminal window** (PowerShell, Command Prompt, Windows Terminal) via UI clicking or typing. This is exactly why the System backend exists as a separate thing from the Desktop backend: registry, DNS, power-plan, and similar changes always go through its direct API/PowerShell calls through the Tool Runtime, never through "open a terminal and type a command" via the GUI.
- Never automate Dex's own interfaces or other AI-agent apps, to avoid recursive control loops.
- If the desktop is locked, stop and ask the owner to unlock it — never interact with the lock screen.

---

## 5. Secrets

Never in `config.yaml`, or any file that's plausible to commit or share. Pipe names, cluster/session secrets, API keys, and node credentials live in `.env` (gitignored) or the OS credential store, and nowhere else. A config file can reference the *name* of an environment variable; it never holds the value.

**Workspace/MCP credentials use the store, not `.env`.** `core/secrets/credential_store.ts` encrypts each secret with DPAPI in `CurrentUser` scope, so the ciphertext under `%LOCALAPPDATA%\DEX\credentials` is bound to this Windows account on this machine and is inert anywhere else. Plaintext never appears on a command line or in a child process's environment on the way in — it moves over stdin, base64-encoded so no console codepage can corrupt it. Set them with `npm run cred -- set <name>`; `npm run cred -- list` shows what's stored and what's still missing without printing any values.

An MCP server gets a deliberately narrow environment: `PATH`, the Windows profile paths, and exactly the secrets that server declares. It does not inherit `ANTHROPIC_API_KEY`, daemon pipe names, or channel tokens. A third-party server process should be able to do its job and learn nothing else about the machine it's running on.

Reading from `.env` still works as a bootstrap path for a fresh checkout, and warns each time it's used, naming the command that moves the value into the store. That warning is the point — plaintext-on-disk is a migration state, not a resting place.

This is a deliberate correction: it's easy to end up with an example config that has a secret-shaped placeholder sitting a few sections above a comment saying secrets don't belong in config files. If those two things are ever in tension in a draft, the rule wins, not the example.

---

## 6. Daemon access control

The Tool Runtime's elevated daemon (architecture.md §13) is the single most privileged process in the system — it can write the registry and run arbitrary PowerShell. Its named pipe **must** carry an explicit security descriptor restricting connections to the current admin user and `SYSTEM` only.

This has to be an actual constructed DACL, not assumed from defaults. A default/unset `SECURITY_ATTRIBUTES` object does not restrict access on Windows — leaving it unset while a comment claims the pipe is locked down is worse than no comment at all, since it reads as done when it isn't. Test this explicitly: confirm a non-admin local account cannot open the pipe at all before trusting anything else about the daemon.

Every request the daemon accepts is additionally bound to a short expiry and a single-use nonce — a captured or replayed request is rejected outright, not just logged.

---

## 7. Plugin isolation

A plugin does not automatically receive:

- owner credentials
- raw conversation history
- arbitrary filesystem access
- arbitrary shell execution
- arbitrary network access

Permissions are declared per-plugin in its manifest and enforced, not assumed from what the plugin's code happens to try. A plugin that crashes repeatedly is quarantined — its capabilities are unregistered until the owner re-enables it — rather than allowed to keep degrading the rest of the system.
