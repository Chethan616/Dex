# Tabs — `dex-tab`

Your task's browser has tabs, like a normal browser, and **the user sees them
and can use them while you work**. You start in one tab (`BU_TARGET_ID`). The
user may open more, a page may open a popup, and you can open your own.

```bash
dex-tab list
# {"tabs":[{"tab":"t1","targetId":"8F3A…","url":"https://…","title":"…","onScreen":true,"openedBy":"task","temporary":false}, …]}
```

`openedBy` is `task` (the first tab), `user`, `page` (a popup or a
`target=_blank` link) or `agent` (yours). `onScreen` is the one the user is
looking at.

## Driving another tab

Every tab of this task is reachable through your usual connection. Take its
`targetId` from `dex-tab list` (or `listPageTargets()`) and switch to it:

```bash
browser-harness-js 'await session.use("8F3A…")'
```

Switch back with `session.use(process.env.BU_TARGET_ID)`. A login popup a site
opened shows up here too — that's how you finish an OAuth flow.

## Opening your own

For a side lookup — checking a price elsewhere, reading docs — open a scratch
tab instead of navigating away from the page the user is watching:

```bash
dex-tab new "https://example.com/pricing"      # loads in the background
dex-tab new "python zip strict argument"       # search words work too
```

It prints the new tab with its `targetId`. Scratch tabs are **closed when the
run ends**. To leave one open for the user, `--keep` it (or `dex-tab keep <id>`
later); to put it on screen, `--show` it (or `dex-tab show <id>`) — a shown tab
is kept. A tab the user clicks on is theirs and is kept too.

Close what you're done with: `dex-tab close <id>`. Never close a tab the user
opened unless they asked.

## The user is here too

- DEX draws a small cursor labelled **DEX** where you move and click, so the
  user can follow along. Your screenshots never include it.
- If the user is clicking, scrolling or typing in the page, your input waits
  until they pause (about 1.5 s, at most 8 s). A slow click is that, not a hang.
- If the page changed under you — another URL, scrolled, a dialog closed —
  the user probably did it. Read the page again before your next action
  instead of repeating the old one.
