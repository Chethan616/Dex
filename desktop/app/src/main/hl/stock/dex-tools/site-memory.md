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
3. Fill each by selector: `dex-fill vtop.vit.ac.in user "#username"` then
   `dex-fill vtop.vit.ac.in pass "input[type=password]"`. Verify both fields
   show a value; if one is empty the selector was wrong — find the right one
   and fill again.
4. Handle the CAPTCHA **only if one is actually on the page** (see below).
5. Click the submit / login button.
6. Confirm you are signed in — the URL changed, or a dashboard is showing. If
   the page reports a bad CAPTCHA or wrong credentials, read the message and
   retry from the relevant step.

`dex-fill` types the stored value straight into the field and tells you only
whether it worked. The secret goes from the keychain to the page and is seen by
nothing in between — not by you, not by the transcript.

**Never ask the user to paste a password to you in chat.** Fill the field. If
nothing is stored and a login is genuinely needed, ask them to sign in inside
the browser view themselves.

## CAPTCHAs — look before you wait

**This tool is meant to run without the user. Do not stop and wait for a human
unless there is genuinely no other way.**

First, look at the actual page. Do not assume a CAPTCHA exists — many logins
have none. Only act on a CAPTCHA you can actually see in the DOM or a
screenshot.

- **No CAPTCHA on the page** → just submit. Never wait for a CAPTCHA that is
  not there. Inventing one and waiting is the failure this section exists to
  stop.
- **A text / image CAPTCHA** (a distorted-letters image with a text box next to
  it — this is what VTOP uses) → solve it yourself. Screenshot the CAPTCHA
  image, read the characters, type them into the CAPTCHA input, and submit.
  This is the user's own login on their own account; reading their portal's
  text CAPTCHA for them is part of doing the task. If it is rejected, click the
  refresh icon to get a new image, read it again, and retry — a few times
  before giving up.
- **An interactive widget you cannot read** (a reCAPTCHA / hCaptcha checkbox or
  an image-grid challenge) → these genuinely cannot be solved from the DOM.
  Only here do you involve the user: tell them exactly what to click in the
  browser view and wait, then continue automatically once it clears. Confirm
  such a widget is really present before claiming it — do not mistake a plain
  submit button for one.
