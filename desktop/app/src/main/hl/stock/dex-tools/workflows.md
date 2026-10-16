# Workflows and routines — `dex-workflow`

A workflow is a named list of steps DEX runs by itself: when the user asks
("run my morning routine"), or on a schedule ("every weekday at 7:30"). DEX
keeps them, shows them as cards with **View** (a graph of the steps) and
**Run now**, and starts the scheduled ones on time, each as a task of its
own. You make and change them from what the user says.

## When the user asks for one

"Create a daily routine for me", "make a workflow that…", "do this every
morning / every Friday", "save what you just did as a workflow".

1. Work out the **name** (short, theirs: "Morning routine"), the
   **trigger** and the **steps** from what they said. Missing something
   that matters — when it runs, or what a step should cover? Ask with one
   `dex-ui ask` (a `time` field, a `choice` of days), then end your turn.
   Don't ask what you can decide (a name, the order of obvious steps).
2. Save it. The plain way needs no JSON and works the same from bash,
   PowerShell or cmd — a name, when, and each step in words, with its kind
   in front when it isn't a plain `task`:
   ```
   dex-workflow create "Morning routine" --when "weekdays at 7:30" --about "Weather, my day and unread mail before work" --step "web: Check the weather in their city" --step "Read today's calendar" --step "Summarise unread mail from people, not newsletters" --step "notify: Send me the summary"
   ```
   `--when` takes words: "on demand", "every day at 8am", "weekdays at
   7:30", "mon and fri at 9 pm", "every morning". Leave it out for a
   routine the user starts by name.

   For details and per-step prompts, the full spec — on stdin in bash, or
   from a file anywhere (PowerShell: write it with `Set-Content x.json`,
   then `dex-workflow create --file x.json`; a BOM is fine):
   ```bash
   dex-workflow create <<'EOF'
   {"name": "Morning routine",
    "trigger": {"kind": "weekly", "days": ["mon","tue","wed","thu","fri"], "time": "07:30"},
    "steps": [
      {"kind": "web",    "title": "Check the weather", "detail": "their city, today and tonight"},
      {"kind": "task",   "title": "Summarise unread mail", "detail": "Gmail, last 24 hours",
       "prompt": "Only mail from people, not newsletters. One line each, most important first."},
      {"kind": "notify", "title": "Send me the summary"}
    ]}
   EOF
   ```
   It answers `{"ok":true,"workflow":{…}}`. If it answers with an error,
   the message says what to change: fix that and run it again. Don't
   debug the tool, and never hand the user a command to run instead.
3. Show it: `dex-workflow show "Morning routine"` (one card, with View and
   Run now), and say in one line when it runs next. Don't repeat the steps
   in prose: the card and its graph show them.

## The spec

| Key | What |
|---|---|
| `name` | Up to 60 characters. Unique. |
| `description` | Optional, one line: what it's for. |
| `trigger` | `{"kind":"manual"}` (only when asked: the default), `{"kind":"daily","time":"07:30"}`, `{"kind":"weekly","days":["mon","fri"],"time":"18:00"}`. Times are 24-hour `HH:MM`, the user's local time. Days: `mon tue wed thu fri sat sun`. |
| `steps` | 1–20, run in order. Each: `kind`, `title` (≤ 80, a short imperative: "Check the weather"), `detail` (optional, ≤ 200: where or what exactly), `prompt` (optional, ≤ 1000: the instruction for you when the title isn't enough). |
| `enabled` | `false` keeps it but stops the schedule. |

Step kinds — each draws with its own icon in the graph, and tells the run
how to do it:

| `kind` | For | How a run does it |
|---|---|---|
| `task` | Anything else: read, write, summarise, decide | However fits |
| `web` | Something on the web: news, weather, prices, a site | An MCP connector first, the browser if none fits |
| `app` | A Windows app: Spotify, Outlook, Excel | `mcp__windows__*` in the background (`desktop.md`) |
| `pc` | The PC itself: check disk, clean up, Wi-Fi | `system_info`, allowlisted `system_change` |
| `notify` | Tell the user something | In the run's final message, which reaches their phone |
| `ask` | A decision only the user can make | `dex-ui ask`, then wait for the answer |
| `wait` | A pause between steps | At most 10 minutes inside one run; for longer, make two workflows |

Good steps are concrete and checkable: "Summarise unread mail from people,
one line each", not "handle my email". Something that spends money, sends
mail to other people or deletes things gets an `ask` step before it, unless
the user said plainly to do it without asking.

## Changing, listing, running

- **Change**: `dex-workflow update "Morning routine" <<'EOF'` with only what
  changes: `{"trigger": {"kind":"daily","time":"08:00"}}`. `steps` replaces
  the whole list, so read it first (`dex-workflow get`), edit, send it all.
- **Pause / resume the schedule**: `dex-workflow disable <name>` / `enable`.
- **Delete**: `dex-workflow delete <name>` — only when the user said so; say
  which one you deleted.
- **List**: `dex-workflow show` puts every workflow in the chat as cards
  (the user can also type `/workflow`). `dex-workflow list` is for you: ids,
  names, triggers.
- **Run now**: `dex-workflow run <name>` starts it as a task of its own; you
  don't do its steps here.

Names work as references (exact, then the only one that starts with or
contains what you gave). If two match, the error names them: use the id.

## Errors

If `create` or `update` says the spec doesn't fit, fix exactly what it
names (it shows the shape) and run it again — never fall back to writing
the routine down in prose or a file, or to Windows Task Scheduler.
