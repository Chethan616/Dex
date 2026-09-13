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

## CAPTCHAs — submit first, wait almost never

**This tool runs without the user. The default after filling the fields is to
click Submit and see what happens — not to look for a reason to stop.**

The mistake to avoid above all: treating something that is *not* an interactive
challenge as one, and waiting for the user to do nothing. Work through these in
order.

- **A "protected by reCAPTCHA" badge** in a page corner (small logo, often with
  "privacy / terms" links) → this is **invisible reCAPTCHA v3/Enterprise. It is
  NOT a challenge and has NO checkbox.** It scores you silently in the
  background and the token is created when you submit. **Just click Submit.** Do
  not look for an "I'm not a robot" box, do not wait — there is nothing to
  click. This badge is the single most common thing that gets misread. VTOP's
  login is exactly this case: username, password, Submit, and the badge.

- **No CAPTCHA field at all** → just submit.

- **A text / image CAPTCHA** — a distorted-letters image with its own text box
  on the form → solve it yourself. Screenshot the image, read the characters,
  type them into the box, submit. It is the user's own login; reading their
  portal's text CAPTCHA is part of the task. If rejected, refresh the image,
  re-read, retry a few times.

- **A genuinely interactive challenge you can see rendered** — a visible
  "I'm not a robot" *checkbox* you could click, or an image-grid pop-up — and
  only after Submit has actually failed because of it → this is the one case
  that needs the user. Tell them exactly what to click and wait, then continue.

If you are unsure which case you are in, **submit and check the result.** If the
login succeeds, there was never anything to solve. Only if the submit is
rejected with a CAPTCHA error do you reconsider. Never announce "please click
the I'm not a robot checkbox" without having seen an actual checkbox on the
page — a badge is not a checkbox.
