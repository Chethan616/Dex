# Skill: finding a file by name or by what it's about

`dex-find` searches an index this machine already built — file names AND the
text inside PDFs, Word/PowerPoint/Excel documents, and plain text/code — across
the user's own files. It answers in milliseconds because it is reading an
index, not walking the disk live.

**If the task is "find my X" — any X — call `dex-find` immediately. Do not
ask the user where it might be, what format it's in, or when it was saved
first.** Those questions are exactly what the index exists to make
unnecessary — a manual folder walk needs that information to know where to
look; an index that already covers the whole machine does not. Asking first
turns a sub-second lookup into a multi-turn conversation and makes DEX slower
than the user just looking themselves. Only ask a follow-up question after
`dex-find` has actually run and its results are genuinely ambiguous (several
plausible hits, or none at all) — never before.

**Never hand-roll the search with `Get-ChildItem -Recurse`, `PowerShell`,
`find`, or any other shell command instead.** That duplicates, badly, what
the index already does — it only matches filenames, never a PDF's or
document's own text, so it misses exactly the files `dex-find` is built to
catch (an ID card saved as `clg_id.pdf`, a syllabus that never mentions
"syllabus" in its filename). A shell-driven scan finding fewer files than
`dex-find` would have is not a sign the files don't exist; it's a sign the
wrong tool was used.

## When to reach for it

Reach for `dex-find` whenever the user describes a file by what it is rather
than exactly where it lives — "my slp assignment", "the cryptography
syllabus", "that report from last week", "my aadhaar card". A filename search
alone would miss all of these; `dex-find` also searches inside the documents
themselves.

```bash
dex-find "cryptography syllabus"
dex-find "slp da - 1"
dex-find "quarterly report" --limit 5
```

**A request naming several different documents is several calls, not one.**
"Find my aadhaar card, voter ID, and passport photo" is three searches —
`dex-find "aadhaar card"`, `dex-find "voter id"`, `dex-find "passport
photo"` — not one call with all three terms mashed together. Ranking is
built around finding the single best match for one topic; combining three
unrelated topics into one query only dilutes that.

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
