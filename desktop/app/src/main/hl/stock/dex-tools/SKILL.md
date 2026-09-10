# DEX Tools

Command-line tools for working outside the browser. They are on your PATH; call
them with Bash like any other command.

| Tool | Use it for |
|---|---|
| `dex-state` | Recording the plan and its progress. Always available. |

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
