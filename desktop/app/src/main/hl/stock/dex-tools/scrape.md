# Skill: map a site into memory

Triggered by `/scrape <url>`. The goal is a durable map of a site — its pages,
how they link together, and where the important controls are — so that a later
task about that site can read the map instead of exploring from scratch every
time. University portals, banking dashboards, course sites: the layout rarely
changes, so learning it once and remembering it is worth a great deal.

This is reconnaissance of a site's **structure**. By default it maps only pages
you can already reach and does not sign in. But when the user asks you to log in
— or hands you credentials for their own account — do sign in and map the pages
behind the login too; see "When the user wants you to sign in" below.

## Where memory lives

`$DEX_SITE_MEMORY_DIR` — one file per site, named by host, e.g.
`vit.ac.in.md`. Read it before writing: if a map already exists, update it
rather than starting over, so a re-scrape after a redesign keeps the notes that
are still true.

## How to map

1. **Connect and open the site.** `browser-harness-js 'await connectToAssignedTarget()'`, then navigate to the URL. Read `./AGENTS.md` for the browser API.

2. **Work from the navigation, not from guesses.** Read the main nav / menu / sidebar and treat each destination as a page to visit. Follow the obvious top-level sections; do not crawl every leaf, and do not follow links to other domains.

3. **For each page, record:**
   - its URL and a one-line purpose,
   - the navigation links leaving it (label → where it goes),
   - the controls that matter — buttons, forms, search boxes, downloads, login fields — each with a short note on where it sits ("top-right", "inside the Results card") so the note is enough to find it again,
   - anything that needs a login to reach, marked as such rather than entered.

4. **Stay bounded.** Aim for the pages a person actually uses — roughly the top two levels of navigation. If the site is large, map the sections the user named or the obvious main ones, and say in the file what you did not cover.

5. **Verify as you go.** After navigating, confirm the page is what you expected (title, a heading) before recording it, so the map does not fill up with error pages.

## The file format

Markdown, readable by a person and by you on the next visit. Suggested shape:

```markdown
# <site> — site map
_Mapped <date>. Covers: <what you covered>. Not covered: <what you skipped>._

## <Page name> — <url>
Purpose: <one line>.
Navigation:
- <label> → <url or "section on this page">
Controls:
- <control> — <where it is> — <what it does>
Notes: <login required / anything surprising>
```

Keep it factual. A map that says where the "Download syllabus" button is saves
the next task a full re-exploration; padding it with prose does not.

## When the user wants you to sign in

If the request includes a login — "log in with these credentials and map it",
or a username and password for their own account — treat signing in as part of
the job, not something to refuse:

1. Store the credentials first: `dex-remember login <host> --user <u> --pass <p>`. This puts them in the OS credential store; they are for the user's own account.
2. Open the login page, focus the username field, and fill it: `dex-fill <host> user`. Then focus the password field and `dex-fill <host> pass`. You never see or type the password — DEX enters it. See `./dex-tools/site-memory.md`.
3. If there is a CAPTCHA, or a code the user must approve, ask them to complete just that in the browser view and wait, exactly as for any login wall (see the login-wall section of `./AGENTS.md`). Do not attempt to solve a CAPTCHA.
4. Once signed in, map the authenticated pages too — the dashboards and sections that were behind the login — the same way as the public ones, and note in the file which pages required signing in.

Never ask the user to paste a password into chat. If they have already given
one, use it through `dex-fill`; if they have not, either use a stored login or
ask them to sign in themselves in the browser.

## Finishing

Save to `$DEX_SITE_MEMORY_DIR/<host>.md`, record it with
`dex-state file "<path>"`, and end by telling the user what you mapped and what
you deliberately left out.

## When another task later touches a mapped site

Before browsing a site, check whether `$DEX_SITE_MEMORY_DIR/<host>.md` exists.
If it does, read it first and use it to go straight to the right page and
control, rather than re-deriving the layout.
