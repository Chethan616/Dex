# Skill: remembering the user's sites and logins

DEX can remember the sites a user cares about — what they call them, and how to
sign in — so that after being told once, it acts on "open my uni portal"
without asking again. Three tools:

| Tool | For |
|---|---|
| `dex-remember` | Recording a nickname for a site, or a login the user gave. |
| `dex-recall` | Looking a site up by nickname to get its real URL. |
| `dex-fill` | Typing a stored credential into a focused login field. |

## When the user names a site

If the user says something like "my university portal is vtop.vit.ac.in" — or
tells you the address of any site they clearly expect you to remember — record
it, with the words they used for it:

```bash
dex-remember site vtop.vit.ac.in "university portal" "uni portal" "college portal" "vtop"
```

Add the natural variants, because they will refer to it however they please
next time.

## When the user refers to a site by nickname

Before asking "which site?" or guessing a URL, look it up:

```bash
dex-recall "open my uni portal"
```

It returns the host, the URL to open, the aliases, and whether a username and
password are stored (`hasUsername` / `hasPassword`) — never the password
itself. Navigate to the URL and carry on.

## When the user gives you a login

Only ever for their own account, and only what they actually provide:

```bash
dex-remember login vtop.vit.ac.in --user 23BXX1234 --pass "the-password-they-gave"
```

The password goes into the operating system's credential store. It is not
written to any file in the clear, and no tool ever prints it back.

## Signing in with a stored login

You do not read the password and type it — you never see it. Instead, focus the
field on the page and let DEX enter the value:

1. Recall the site and check `hasPassword` is true.
2. Inspect the login form and find the CSS selectors of the username and
   password inputs (e.g. `#username`, `input[type=password]`).
3. Fill each by selector — this is the reliable way, it does not depend on
   focus: `dex-fill vtop.vit.ac.in user "#username"` then
   `dex-fill vtop.vit.ac.in pass "input[type=password]"`.
4. Verify both fields now show a value (screenshot, or read them back with the
   harness) before submitting. If a field is still empty, the selector was
   wrong — find the right one and fill again.
5. Submit the form.

`dex-fill` types the stored value straight into whatever field is focused and
tells you only whether it worked. The secret goes from the keychain to the
page and is seen by nothing in between — not by you, not by the transcript.

**Never ask the user to paste a password to you in chat.** If there is a login
field, fill it. If nothing is stored and a login is genuinely needed, ask them
to sign in inside the browser view themselves (see the login-wall section of
`./AGENTS.md`) rather than requesting the password.
