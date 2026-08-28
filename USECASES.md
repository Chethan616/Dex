# What Dex Can Do

A plain list of what Dex actually does today, and — just as important — what is
built but unproven.

Every capability below is marked:

| | meaning |
|---|---|
| **✅ Verified** | run against this real machine and observed working, with the output quoted |
| **🧪 Tested** | covered by automated tests, but never run against the live service |
| **🚧 Blocked** | built, but something is missing before it can run |

Nothing here is marked working because the code looks right.

> Setup: [SETUP.md](./SETUP.md) · Safety model: [SAFETY.md](./SAFETY.md) ·
> Design: [architecture.md](./architecture.md)

---

## The idea in one paragraph

You say what you want in ordinary language, from a terminal, a desktop bar, or
your phone. Dex works out the steps, picks the cheapest way to do each one, does
it, and then **checks that it actually happened** rather than assuming. Risky
things ask first. Anything it cannot do itself — a CAPTCHA, a password — it
hands back to you and carries on afterwards.

---

## 1. Controlling Windows directly — no GUI involved

The fastest and most reliable tier. No window opens, nothing is clicked, and
every change is confirmed by reading the setting back.

**Sound**
```
you> set my volume to 35
     ✓ verified — Endpoint reports 35%
```
✅ Verified. Also: `get_volume`, `set_mute`.

**Network**
```
you> set my dns to 1.1.1.1
     set_dns({"primary":"1.1.1.1"})
     ✗ netsh failed (1): The requested operation requires elevation
       — this needs an elevated daemon. Run scripts/install-daemon-service.ps1
```
🚧 `set_dns` needs an elevated daemon and says so. `get_dns`, `get_wifi_status`
✅ Verified.

That message is the feature. Until recently this step reported **success** and
changed nothing: netsh writes its errors to stdout, exits 1, and leaves stderr
empty, and the handler only raised when stderr was non-empty. The verification
layer then read DNS back, disagreed, and reported a bare `FAILED` with no cause.
Reading the telemetry afterwards showed `set_dns` had never once executed in the
project's history — the only DNS rows were written by a test against a mocked
agent.

DNS is now read back **per adapter**. The old check asked whether the address
appeared anywhere in the netsh output, which on a machine with a statically
configured Ethernet port passes without the action having happened at all.

**Applications**
```
you> open calculator
     launch_app({"name":"Calculator"})
     ✓ verified — Window open: "Calculator"
```
✅ Verified. `close_app` asks the window to close rather than killing it, so
unsaved work stays your decision. A launch is proven by a **window existing**,
which matters because packaged apps exit their launcher immediately.

**Power, processes, registry** — ✅ Verified by `npm run conformance`.
`set_power_plan`, `get_power_plan`, `list_processes`, `kill_process` (refuses
system-critical processes and ambiguous names), `registry_read`,
`registry_write`, `registry_classify`, `run_shell`.

### How that "verified" is earned

Every claim in this section is produced by a harness, not by reading the code:

```
npm run conformance                  read-only + round-trip
npm run conformance -- --destructive adds wifi and process-kill
```

It walks `OS_ACTION_NAMES` from `core/brain/capabilities.ts` — **the same list
the Brain is shown** — and drives each action against the real daemon over the
real pipe, confirming through the same `verifyStep` the Orchestrator uses. Each
probe reads the current value first and puts it back afterwards, including
putting DNS back on DHCP if that is where it started.

An advertised action with no probe **fails the run**. That rule exists because
of what the telemetry showed: of seventeen advertised actions, three had ever
executed. The rest were written, catalogued, documented here as working, and
never run once. Fixing them one at a time would have left the next one to be
added in exactly the same state.

---

## 2. Driving applications — by name, not by pixels

Dex asks Windows what a window contains and invokes the control **by name**. No
screenshot, no coordinates, nothing that can land 30 pixels off target.

✅ Verified against a real WinForms app — 12 checks, zero screenshots:

```
wait_for      waited for a real control instead of sleeping
set_text      field read back byte-for-byte
click_element invoked via InvokePattern, not a mouse coordinate
              → the app really processed it (value came back transformed)
toggle        on and off both verified against real state
```

Available: `list_elements` · `click_element` · `set_text` · `read_element` ·
`toggle` · `select_menu` · `wait_for` · `window_state`.

Works with Notepad, File Explorer, Settings, Office, and any standard
WinUI/WPF/WinForms application.

**What it refuses.** ✅ Verified: `set_text` inspects the control and refuses
password and one-time-code fields, offering to hand off to you instead. It also
refuses to act when two open windows match a title — guessing there is how an
agent overwrites the document you were working in.

---

## 3. The web

**Exact browsing** — ✅ Verified against real Chrome:
```
navigate    reads the live page
extract     pulls text by CSS selector
type_text   REFUSED on a password field, hand-off offered instead
```

**Autonomous browsing** — ✅ Verified, running on a Groq free tier:

```
you> (task) read the heading on this page and report it
     4 steps: wait, wait, click, done
     result: "Example Domains"
     verified: FALSE — page no longer shows "Example Domain"
```

That second line is the system working. The agent clicked when told not to,
navigated away, and *reported success*. The live-DOM check disagreed and Dex
sided with the page. A return value is a claim, not proof.

Also here: a CAPTCHA, bot check or password field stops the agent mid-run, parks
the live browser, asks you to clear it, then resumes on the same page — bounded
to two hand-offs before it admits the site will not let it through. 🧪 Tested.

---

## 4. Email, calendar and files

🧪 Tested against a real MCP handshake with a real child process, never against
a real Google account.

```
search_email · read_email · send_email
list_calendar_events · create_calendar_event
search_drive · read_drive_file
```

Two things worth knowing about how this is built:

- **Dex never names a vendor tool.** It plans against its own vocabulary and
  resolves that against whatever the live server advertises, so a plan written
  for Gmail keeps working if you move to Outlook.
- **Writes are read back.** `send_email` and `create_calendar_event` fetch the
  created thing through a *different* tool before the step counts as verified.
  No id came back means `UNVERIFIABLE`, never "worked".

Needs OAuth credentials in the credential store to run.

---

## 5. Seeing the screen

For interfaces with no accessible controls — games, canvases, image editors.
The last resort, and the most expensive.

✅ Verified: UI-TARS 1.5 7B running locally on the RX 6800M, benchmarked against
a fixture with known control centres:

| | UI-TARS (local) | Gemini 2.5 Flash |
|---|---|---|
| median error | **6 px** | 22 px |
| within 40 px | **6/8** | 5/8 |
| quota | none | project-dependent |
| screenshots | never leave the machine | uploaded |

🚧 The **full Worker loop** that decides *what* to click is blocked for the same
reason as the browser: `agents/desktop/agent_loop.py` requires an Anthropic key.
Grounding — turning "the Save button" into a coordinate — works today.

---

## 6. Saving things you do repeatedly

✅ Verified end to end.

After the same task succeeds three times, Dex offers to keep it:

```
you> set my volume to 35
     ✓ verified — Endpoint reports 35%
     You've done this 3 times. Save it: /save <name>

you> /save vol
     Saved "vol" — 1 step(s)
       run vol <level>
```

It works out which values you varied and makes those parameters. Then three ways
to run it, cheapest first:

```
you> run vol 55                  no LLM — explicit
you> set volume to 42            no LLM — matched by request shape
you> make it louder, like 70     one call — the Brain picks it
you> turn the sound down a bit   one call — same
```

All four ✅ verified. The last two share no words with how it was saved — that
is the LLM choosing the workflow, then Dex running the **saved steps**. The
model picks; it never rewrites what runs.

---

## 7. Remembering

✅ Verified live:

```
you> open calculator
     ✓ verified — Window open: "Calculator"

you> close the app
     "app" → Calculator (most recent app)
     ✓ verified — No window matching "calculator" remains
```

Dex records what tasks actually produced — files written, pages ended on, emails
whose id came back — and later requests can refer to them. A step that failed,
or a write that could not be verified, leaves nothing behind: "probably sent" is
not something to refer back to.

**When it cannot tell, it asks:**
```
Which "report" do you mean?
  1. Q3_Report.pdf — C:\docs\Q3_Report.pdf
  2. Q4_Report.pdf — C:\docs\Q4_Report.pdf
```
Nothing runs until you answer. A resolver that quietly picks the newer one is
right most of the time and silently wrong the rest — and you could not tell
which happened, because you asked for "the report" and got *a* report.

Sessions are keyed by time, not channel, so a task begun on your phone and
followed up at your desk is one conversation.

---

## 8. Talking to Dex

| Where | Status |
|---|---|
| **CLI** | ✅ Verified |
| **Dex Bar** (Flutter, `Alt+Space`) | ✅ Verified — live step stream, confirmation cards, workflows/history/usage panel |
| **Telegram / Discord** | 🧪 Tested — 27 checks, but never against a live bot (no tokens configured) |
| **WhatsApp** | 🚧 Opt-in. GPL-3.0 and an unofficial client that can get an account banned — deliberately not a declared dependency |

From a chat, progress arrives as **one message that edits itself** rather than a
stream of notifications, and approvals are answerable with `/yes ab12`.

A non-owner gets **silence** — not a refusal. Replying "unauthorised" confirms
the bot is listening and tells someone probing that their id is merely wrong.

---

## 9. Seeing what you use it for

✅ Verified.
```
you> /stats
Last 7 day(s)
  6 tasks — 5 completed, 1 failed, 0 cancelled
  3 planned by the Brain, 3 replayed from workflows  (3 planning calls avoided)

  Per day
    2026-08-26  ████████████████████████ 6
  Most used
    5× set_volume can_control_os
```

Also `/history [search]`, `/workflows`, `/forget <name>`. All local; nothing
leaves the machine.

---

## 10. How it protects you

Not features so much as rules that hold everywhere:

- **A return value is a claim, not proof.** Nothing is `VERIFIED` until state was
  read back. "Could not check" reports as `UNVERIFIABLE`, never as success.
- **Four confirmation tiers.** Silent → pre-approve once → always confirm →
  hand off to you. Approvals carry a content hash of the step, so a stale
  approval cannot authorise a rewritten one.
- **Full Access grants elevation, not permission.** Even with it on, registry
  security and policy keys stay refused, and hand-offs still happen — no
  privilege lets Dex read a CAPTCHA.
- **Dex never types a password.** Enforced at the point of action in both the
  browser and the app tier, whatever the plan said.
- **Untrusted content is data, never instruction.** A web page telling Dex to do
  something is just text.
- **Secrets are encrypted by Windows** (DPAPI), bound to your account and
  machine. Never in a config file.

---

## What it cannot do yet

Stated plainly, because the gaps matter more than the list above:

- **The desktop vision Worker still requires an Anthropic key.** Grounding
  ("where is the Save button") runs locally; deciding *what* to click does not.
  Everything else — Brain, browser, Tiers 1 and 2 — runs on a Groq free tier.
- **Nothing has run against live Google, Telegram or Discord credentials.**
- **No scheduling.** Dex acts when asked; it cannot run something every morning.
- **Your own scripts are not pluggable yet** — that is the Plugin SDK, where
  they get permission gating and crash isolation rather than running as
  LocalSystem unsandboxed.
- **One machine.** No device mesh, so "send this to my phone" has nowhere to go.
- **Windows only**, by design.

---

## Where the project is

```
v0.1.0  core loop + desktop agent          v0.5.0  workflows + usage history
v0.2.0  Flutter Dex Bar                    v0.6.0  Telegram/Discord/WhatsApp
v0.3.0  browser + workspace                v0.7.0  memory & cross-channel
v0.4.0  deterministic-first tiers          ← current
```

**199 automated tests** across nine suites. Remaining: Slice 7 (Slack,
scheduler, plugin SDK) and Slice 8 (device mesh).
