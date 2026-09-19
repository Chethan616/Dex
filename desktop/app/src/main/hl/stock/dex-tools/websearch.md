# Skill: a plain factual web lookup

`dex-websearch` answers a question from the open web directly — no browser
tab, no page to load, no DOM to read. It calls a search API and hands back
titles, URLs, and snippets.

## When to reach for it

Use it for a question with a factual answer that isn't tied to a specific
site's own UI or anything behind a login — "what's the current Node.js LTS
version", "capital of Australia", "who won the 2024 election in country X".

```bash
dex-websearch "current node.js lts version"
dex-websearch "capital of australia" --limit 5
```

**Do not use it** for anything that needs a specific site's own interface —
checking an inbox, reading a Drive file, filling a form, or anything behind
a login wall. Those still go through their MCP tool or `browser-harness-js`
per the routing table in `AGENTS.md`. `dex-websearch` is for the "just tell
me the fact" case that would otherwise mean opening Google in a browser tab
just to read the first result — heavier than the question deserves.

## Reading the result

JSON on stdout, the same shape `dex-find` uses:

```json
{
  "items": [
    { "label": "Node.js", "detail": "https://nodejs.org", "reasons": ["web search"],
      "excerpt": "Node.js is a JavaScript runtime... Active LTS: 22.x" }
  ]
}
```

- `detail` is the source URL.
- `excerpt` is the search snippet — often enough to answer directly; only
  open the URL yourself if the snippet doesn't actually settle the question.

An `error` field (and an empty `items` array) means the search itself
failed — most commonly no API key configured in this install. Say so
plainly rather than presenting silence as "no results found."
