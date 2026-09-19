# Skill: finding a file by name or by what it's about

`dex-find` searches an index this machine already built — file names AND the
text inside PDFs, Word/PowerPoint/Excel documents, and plain text/code — across
the user's own files. It answers in milliseconds because it is reading an
index, not walking the disk live.

## When to reach for it

Prefer `dex-find` over `Bash`'s own `find`/`grep`, or over guessing a path,
whenever the user describes a file by what it is rather than exactly where it
lives — "my slp assignment", "the cryptography syllabus", "that report from
last week". A filename search alone would miss all of these; `dex-find` also
searches inside the documents themselves.

```bash
dex-find "cryptography syllabus"
dex-find "slp da - 1"
dex-find "quarterly report" --limit 5
```

Use plain `find`/`Bash` instead when you already know the exact path, or need
something the index does not cover (a file created in the last few seconds
before the watcher catches up, or a directory listing rather than a search).

## Reading the result

JSON on stdout:

```json
{
  "items": [
    { "label": "BCSE_CNS_syllabus.pdf", "detail": "C:/Users/.../BCSE_CNS_syllabus.pdf",
      "reasons": ["\"cryptography\" in contents", "\"syllabus\" in filename"],
      "excerpt": "...Course: Cryptography and Network Security...", "bytes": 219044, "modified": 1732000000000 }
  ],
  "indexStatus": { "running": true, "scanning": false, "total": 84213, "indexed": 61042, "pending": 0 }
}
```

- `detail` is the real path — open it, attach it, or hand it back to the user.
- `reasons` says *why* each result matched; when the user's own wording (an
  acronym, a course name) doesn't literally appear anywhere, this is how you
  can tell the match is still a good one rather than a coincidence.
- `indexStatus.pending > 0` means the content backfill is still running in the
  background — filenames are always current, but a very recently added file's
  contents might not be searchable yet. If a result you expected is missing
  and `pending` is high, say so rather than concluding the file doesn't exist.

An empty `items` array with no error means nothing in the index matches — say
that plainly rather than guessing a path instead.

## `@drive` — searching Google Drive alongside this PC

Pass `--drive` **only when the user's request actually tags `@drive`** (or
otherwise explicitly asks to include Drive). Without the tag, search only this
machine — do not add `--drive` on your own initiative.

```bash
dex-find "quarterly report" --drive
```

With the flag, DEX searches the local index and Google Drive **in the same
call**, concurrently — one round trip, not two turns. If Drive is not
connected, the result still comes back with the local results and a
`driveError` field explaining why; report that rather than treating it as a
failure of the whole search.

**Drive's MCP connection only searches — it cannot open, read, or download a
file.** A `driveResults` hit tells you the file exists and its name; it does
not give you the file's content or a way to fetch it. To actually open,
read, or copy a Drive file after finding it, drive the Drive web app through
`browser-harness-js` (see `AGENTS.md`) for that step. This is the expected
two-step sequence, not a fallback from something broken: search via MCP
(fast, no browser needed), then use the browser only for the one thing MCP
genuinely cannot do. Say so plainly if asked why the browser was needed for
a "connected" service, rather than treating it as an MCP failure.
