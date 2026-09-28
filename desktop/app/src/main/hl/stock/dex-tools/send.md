# `dex-send` — deliver things to the user's phone

`dex-send` puts a file, a screenshot or your canvas document into the user's
own WhatsApp chat ("Message yourself"). It can't send to anyone else, and
there is no option to — the recipient is always the user.

```bash
dex-send "C:/Users/me/Documents/Aadhaar.pdf" --caption "Your Aadhaar card"
dex-send --page --caption "Your timetable for this week"
dex-send --screen
dex-send --canvas --caption "The comparison you asked for"
dex-send --page ./outputs/<session>/export.csv   # modes combine
```

| What | Arrives as |
|---|---|
| `.png .jpg .jpeg .webp .gif` | a photo (with the caption) |
| `.mp4` | a video |
| anything else | a document, with its filename |
| `--page` | a PNG of your browser view as it is right now |
| `--screen` | a PNG of the whole primary screen |
| `--canvas` | the last `dex-canvas show` document, rendered to PDF |

Up to 10 files per call, 64 MB each.

## When to use it

- **The task came from WhatsApp.** The prompt says so. The user is on their
  phone and can't see this PC: whatever they asked to *get* or *see* has to be
  sent. "Fetch my Aadhaar card" → `dex-find`, then `dex-send` the file.
  "Send me a picture of my timetable on the uni portal" → log in, open it,
  make sure it's fully loaded and in view, then `dex-send --page`.
- **The user said "send me…", "on WhatsApp", "to my phone"** — from anywhere.

## Getting a good picture

`--page` captures exactly what the browser view shows. Before sending:
wait for the page to finish loading, close cookie banners and popups, and
scroll or zoom so the thing they asked for is what's on screen. For a long
page, send two or three `--page` shots rather than one unreadable one — or
put the content in a `dex-canvas` document and send `--canvas`.

## Sensitive files

Identity documents, statements and the like go only to the user's own chat,
which is exactly who asked. Send the one file they asked for — never a whole
folder, and never anything they didn't ask for.

If WhatsApp isn't connected, `dex-send` says so: tell the user where the file
is instead and suggest connecting WhatsApp in DEX's Settings.
