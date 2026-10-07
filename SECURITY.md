# Security

DEX is an AI agent with real reach: it drives a browser, your apps, files and
connected accounts on your PC. We take reports seriously and fix them fast.

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately through GitHub:
[Security › Report a vulnerability](https://github.com/Chethan616/Dex/security/advisories/new).

Include what an attacker can do, the steps or a proof of concept, and the
versions you tested (desktop and/or phone, from Settings › Updates). You'll get
a reply within a few days. Once it's fixed and released, we'll credit you in
the advisory unless you'd rather not be named.

**In scope:** the desktop app (`desktop/app`), the phone app (`android`), DEX's
MCP servers (`desktop/app/mcp-servers`), the Firestore rules (`firebase/`),
and anything that lets a web page, a document, a message or a prompt make the
agent do something the user didn't approve.

**Out of scope:** the agent engines themselves (Claude Code, Codex, OpenCode),
third-party services DEX connects to, and attacks that need someone already
in control of your Windows account.

## Supported versions

Fixes go into the latest release. The desktop app updates itself, and the
phone app offers new versions in Settings › Updates.

## How DEX keeps you in control

- **Approvals.** Settings › Agent approval sets how much DEX may do on its
  own: *Ask for approval*, *Approve for me* (routine steps run, risky ones
  ask), or *Full access*. Admin changes to Windows always go through an
  allowlist of typed actions, never a free command, and are journaled so they
  can be undone.
- **Secrets stay out of the agent's view.** Password fields are masked from
  what the agent reads, and it fills saved logins without seeing them.
  Account tokens live in the Windows credential store, not in files.
- **The browser is brokered.** Agents reach their browser through a
  per-session token, not an open debugging port.
- **Windows control respects you.** It works on background windows without
  taking your mouse or focus, refuses password managers, Windows Security,
  terminals and other AI agents, and lets go the moment you move when it has
  to borrow the mouse.
- **Phone pairing is yours.** The phone and PC talk through your own Firebase
  project, and its rules let only your account read or write your data.
- **Local only.** DEX's control server listens on this PC only, behind a
  token.

These defences narrow what a hostile page or prompt can do; they don't make an
agent with your permissions harmless. Full access means exactly that, so keep
it for tasks you trust.
