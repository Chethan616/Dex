# DEX-Bench

An OSWorld-style benchmark for DEX on Windows: 24 everyday computer tasks,
each set up from scratch and scored by a script that reads the end state.

## Why not OSWorld itself

[OSWorld](https://os-world.github.io/) runs Ubuntu virtual machines, and
[Windows Agent Arena](https://microsoft.github.io/WindowsAgentArena/) needs a
Windows VM image built in Docker. DEX is a Windows desktop app that works on
the user's own PC, its browser, apps and files, so DEX-Bench takes OSWorld's
method to a real Windows PC instead:

- **A real environment.** Tasks run on the PC, in DEX's own browser, against
  a local website (`server.mjs`) that's deterministic and offline, and in
  real Windows apps.
- **A natural request.** Each prompt is what a person would type.
- **An execution-based check.** `tasks.mjs` gives every task a setup and a
  checker that reads the outcome: files on disk (CSV, .docx, .xlsx, .zip,
  .png), the site's records (orders, form submissions, saved settings,
  sign-ins). It never trusts the agent's claim. Questions are checked against
  the true answer.
- **Any route counts**, as in OSWorld: clicking, a shell, or code.
- **Infeasible tasks.** Two tasks can't be done; the right answer is to say
  so without making something up.

## The tasks

| Category | Tasks |
|---|---|
| Web | buy the cheapest mouse that fits (JavaScript-rendered shop, cart, checkout); a contact form; a table to CSV; sign in and read a date; count across paginated results; settings behind a cookie banner |
| Files & OS | sort files into folders; rename photos by date; find a file by its content; zip a folder minus .tmp files; a system fact |
| Documents | a .docx with a real Heading 1 and bullets; totals and a grand total in .xlsx; clean a CSV; find-and-replace in a .docx keeping bold |
| Windows apps | Notepad (write and save), Calculator, the display's resolution, count files in File Explorer |
| Multi-app | web page → spreadsheet; read a note → write a reply; CSV → bar chart image |
| Infeasible | a file that doesn't exist; a currency the shop doesn't offer |

## Run it

```bash
node selftest.mjs                     # every checker: a reference solution passes, doing nothing fails
# DEX running with a CDP port for its hub: set AGB_CDP_PORT=9224 && npx electron-forge start
node run.mjs --agent dex              # DEX, Claude Code engine, model opus (Full access for the run)
node run.mjs --agent claude-code      # the same model through the plain Claude Code CLI
node report.mjs                       # results/REPORT.md
```

Each run writes `results/<agent>-<time>.json` with every task's prompt,
answer, time, steps and the checker's reason.

## Reading the numbers

- DEX-Bench is 24 tasks: one task is about 4 points. Treat differences of a
  task or two as noise; run it again before concluding much.
- Scores on OSWorld, OSWorld-Verified or Windows Agent Arena come from other
  tasks, other machines and other rules (step limits, best-of-N). They give
  context, not a head-to-head.
- Microsoft Copilot and OpenAI's ChatGPT agent can't be driven from a script
  on this PC, so they aren't run here; their published numbers are quoted
  with sources in the report instead.
