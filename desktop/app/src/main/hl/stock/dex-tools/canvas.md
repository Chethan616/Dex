# Skill: showing a document instead of telling one

`dex-canvas` renders a markdown document in the pane itself — tables,
headings, lists, formatting — in place of the deck's usual card stack. Use it
when the *result* of a task is something a person would want to read as a
formatted document, not scroll past as terminal output: a report, a
comparison table, a structured summary, a written plan, an explanation with
real headings and sections.

```bash
dex-canvas show "Q3 Expense Summary" <<'EOF'
# Q3 Expense Summary

| Category | Amount |
|---|---|
| Travel | $1,240 |
| Software | $860 |

Travel is up 18% over Q2, driven mostly by the September conference trip.
EOF
```

Markdown comes from **stdin**, not an argument — write it as a heredoc, the
same way `browser-harness-js` takes its JS snippets. Trying to hand-escape a
multi-line document with quotes and backticks into a single shell argument
is exactly the kind of thing that goes wrong.

## When this is the right call, and when it isn't

Reach for it when the output itself is the deliverable — the user asked for
a summary, a comparison, a write-up, a report, and the *shape* of the
answer (headings, a table, a list) is part of what makes it useful. Prose
that's genuinely just a short conversational reply ("done, I updated the
value to X") belongs in your normal reply, not a canvas — a one-line answer
wrapped in a document card is worse than the line itself.

One canvas per session: calling `show` again **replaces** whatever was
there, the same "last write wins" rule `dex-state`'s plan uses. Don't call it
repeatedly to "stream" a document as it's built — write the finished (or
current-best) version once, and call it again only when there's a genuinely
new version worth showing.

This is markdown text, not a webpage — no embedded HTML, no scripts, no
custom layout. Tables, headings, lists, code blocks, bold/italic, and links
all render properly through the app's normal markdown renderer.
