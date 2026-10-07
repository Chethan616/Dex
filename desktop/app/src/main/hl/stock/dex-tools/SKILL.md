# DEX Tools

Command-line tools for working outside the browser. They are on your PATH; call
them with Bash like any other command.

| Tool | Use it for |
|---|---|
| `dex-state` | Recording the plan and its progress. Always available. |
| `dex-remember` | Recording a site the user named, or a login they gave. See `site-memory.md`. |
| `dex-recall` | Resolving a nickname ("my uni portal") to a real URL. |
| `dex-fill` | Typing a stored credential into a focused login field without seeing it. |
| `dex-sh` | A different shell (cmd/PowerShell/WSL) with a structured, timed result, one-shot or as a persistent `session start`/`run`/`end` that keeps cwd/env between calls. See `registry.md`. |
| `dex-registry` | Reading the Windows registry freely; writing always waits for the user to approve in the app. See `registry.md`. |
| `dex-find` | Finding a file by name or by what's inside it (a PDF's own text, not just its filename). See `find.md`. Pass `--drive` only when the user tags `@drive`. |
| `dex-canvas` | Rendering a markdown document (report, table, summary) in the pane itself instead of as terminal text. See `canvas.md`. |
| `dex-websearch` | A plain factual lookup that doesn't need a browser tab. See `websearch.md`. |
| `dex-open` | Showing the user a file you made or found — a report, PDF, sheet, image or 3D model — rendered in a document tab that reloads as you edit it. See `open.md`. |
| `mcp__windows__*` | Windows apps, media and PC diagnostics, in the background. See `desktop.md`. |
| `dex-ui` | Asking the user with real controls (choices, a place, a date, a time, a number) instead of prose, and showing results as cards, link buttons or facts — on the PC and the phone. See `ui.md`. |
| `dex-react` | A rare emoji on the user's message, when it says something words wouldn't (🎉 to good news). DEX already reacts to go-aheads and thanks by itself — don't double up; most messages get none. |
| `dex-tab` | This task's browser tabs, which the user shares: listing them, opening a background tab for a side lookup, showing one to the user. See `tabs.md`. |
| `dex-send` | Sending the user a file, a screenshot (`--page`, `--screen`) or your canvas as a PDF (`--canvas`) on WhatsApp. See `send.md`. |
| `dex-3d` | An AI-generated, textured 3D model (GLB) of one object from a description or a picture — free on the user's Hugging Face account. See `blender.md`. |
| `dex-blender` | This task's background Blender (no window — the user keeps their desktop): its status and autosaved scene, headless scripts and renders, and showing the scene to the user when they ask. See `blender.md` for how to build scenes and models that look good. |

There are also skill files here for two user commands, read when the command is
used rather than run as tools:

| Skill | Command | What it does |
|---|---|---|
| `scrape.md` | `/scrape <url>` | Map a site into `$DEX_SITE_MEMORY_DIR` — pages, navigation, controls. |
| `bugbounty.md` | `/bugbounty <url>` | Authorized vulnerability assessment — exploitable bugs with evidence, not a header checklist. |

More tools appear here as they ship. Run any of them with `--help`.

---

## `dex-state` — the task ledger

You already keep the plan in your head, and you already recover from failures
without being told to. `dex-state` is not there to change how you work. It is
there so the person watching can **see** it, and so the record survives a crash
or a restart of the app.

Write to it at step boundaries. It costs one fast local call.

### Start of a multi-step task

```bash
dex-state plan "Download the CNS syllabus and send it on WhatsApp" \
  "Open the university portal" \
  "Log in" \
  "Find the syllabus" \
  "Download the PDF" \
  "Attach it in WhatsApp"
```

Steps are numbered `step_1`, `step_2`, … in the order given.

Skip this for a one-shot request ("what's on this page?"). Use it whenever the
task has stages a person would want to watch.

### While working

```bash
dex-state step-start step_3
# ... do the work ...
dex-state step-done            # defaults to the active step
```

### When something fails — the important part

The rule is: **a tool failure is not a task failure.** When an interface cannot
do something, you record what broke, name what you are trying instead, and
carry on from where you are. You do not restart the task.

Trying another interface — the step stays open:

```bash
dex-state step-fail --reason "attachment button not in the accessibility tree" \
                    --tool uia --fallback vision
# ... now do it with the annotated screenshot ...
dex-state step-done
```

Genuinely out of options — the step closes as failed:

```bash
dex-state step-fail --reason "the portal is down (503 after 3 attempts)"
```

Passing `--fallback` is what distinguishes the two. With it, the step stays
active and the failure is kept as history on a step that later succeeds — which
is exactly the record worth having.

### Files you produce

```bash
dex-state file "C:/Users/cheth/Downloads/syllabus.pdf"
```

Record anything the user would want to open afterwards.

### Re-planning

Calling `plan` again replaces the step list but **keeps the status and failure
history of any step whose id you reuse**. So a mid-task re-plan does not erase
what already succeeded. Reuse ids for steps that have not changed.

### Reading it back

```bash
dex-state get
```

Returns the full ledger as JSON. Useful after a resume, when you are picking up
a task that was already partly done — read the ledger first and continue from
`currentStep` rather than starting over.
