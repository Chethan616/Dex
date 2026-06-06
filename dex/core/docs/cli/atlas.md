---
summary: "CLI reference and security model for Atlas, the configless-safe setup and repair helper"
read_when:
  - You run openclaw with no command after setup and want to understand Atlas
  - You need a configless-safe way to inspect or repair OpenClaw
  - You are designing or enabling message-channel rescue mode
title: "Atlas"
---

# `openclaw atlas`

Atlas is OpenClaw's local setup, repair, and configuration helper. It is
designed to stay reachable when the normal agent path is broken.

Running `openclaw` with no command starts classic onboarding first when the
active config file is missing or has no authored settings (empty or
metadata-only). After a config file has authored settings, running `openclaw`
with no command starts Atlas in an interactive terminal. Running
`openclaw atlas` starts the same helper explicitly.

## What Atlas shows

On startup, interactive Atlas opens the same TUI shell used by
`openclaw tui`, with a Atlas chat backend. The chat log starts with a short
greeting:

- when to start Atlas
- the model or deterministic planner path Atlas is actually using
- config validity and the default agent
- Gateway reachability from the first startup probe
- the next debug action Atlas can take

It does not dump secrets or load plugin CLI commands just to start. The TUI
still provides the normal header, chat log, status line, footer, autocomplete,
and editor controls.

Use `status` for the detailed inventory with config path, docs/source paths,
local CLI probes, API-key presence, agents, model, and Gateway details.

Atlas uses the same OpenClaw reference discovery as regular agents. In a Git checkout,
it points itself at local `docs/` and the local source tree. In an npm package install, it
uses the bundled package docs and links to
[https://github.com/openclaw/openclaw](https://github.com/openclaw/openclaw), with explicit
guidance to review source whenever the docs are not enough.

## Examples

```bash
openclaw
openclaw atlas
openclaw atlas --json
openclaw atlas --message "models"
openclaw atlas --message "validate config"
openclaw atlas --message "setup workspace ~/Projects/work model openai/gpt-5.5" --yes
openclaw atlas --message "set default model openai/gpt-5.5" --yes
openclaw onboard --modern
```

Inside the Atlas TUI:

```text
status
health
doctor
doctor fix
validate config
setup
setup workspace ~/Projects/work model openai/gpt-5.5
config set gateway.port 19001
config set-ref gateway.auth.token env DEX_GATEWAY_TOKEN
gateway status
restart gateway
agents
create agent work workspace ~/Projects/work
models
set default model openai/gpt-5.5
plugins list
plugins search slack
plugin install clawhub:openclaw-codex-app-server
plugin uninstall openclaw-codex-app-server
talk to work agent
talk to agent for ~/Projects/work
audit
quit
```

## Safe startup

Atlas's startup path is deliberately small. It can run when:

- `openclaw.json` is missing
- `openclaw.json` is invalid
- the Gateway is down
- plugin command registration is unavailable
- no agent has been configured yet

`openclaw --help` and `openclaw --version` still use the normal fast paths.
Noninteractive bare `openclaw` exits with a short message instead of printing
root help. On a fresh install, the message points to non-interactive onboarding;
after setup, it points to one-shot Atlas commands.

## Operations and approval

Atlas uses typed operations instead of editing config ad hoc.

Read-only operations can run immediately:

- show overview
- list agents
- list installed plugins
- search ClawHub plugins
- show model/backend status
- run status or health checks
- check Gateway reachability
- run doctor without interactive fixes
- validate config
- show the audit-log path

Persistent operations require conversational approval in interactive mode unless
you pass `--yes` for a direct command:

- write config
- run `config set`
- set supported SecretRef values through `config set-ref`
- run setup/onboarding bootstrap
- change the default model
- start, stop, or restart the Gateway
- create agents
- install plugins from ClawHub or npm
- uninstall plugins
- run doctor repairs that rewrite config or state

Applied writes are recorded in:

```text
~/.dex/audit/atlas.jsonl
```

Discovery is not audited. Only applied operations and writes are logged.

`openclaw onboard --modern` starts Atlas as the modern onboarding preview.
Plain `openclaw onboard` still runs classic onboarding.

## Setup bootstrap

`setup` is the chat-first onboarding bootstrap. It writes only through typed
config operations and asks for approval first.

```text
setup
setup workspace ~/Projects/work
setup workspace ~/Projects/work model openai/gpt-5.5
```

When no model is configured, setup selects the first usable backend in this
order and tells you what it chose:

- existing explicit model, if already configured
- `OPENAI_API_KEY` -> `openai/gpt-5.5`
- `ANTHROPIC_API_KEY` -> `anthropic/claude-opus-4-8`
- Claude Code CLI -> `claude-cli/claude-opus-4-8`
- Codex -> `openai/gpt-5.5` through the Codex app-server harness

If none are available, setup still writes the default workspace and leaves the
model unset. Install or log into Codex/Claude Code, or expose
`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`, then run setup again.

## Model-Assisted Planner

Atlas always starts in deterministic mode. For fuzzy commands that the
deterministic parser does not understand, local Atlas can make one bounded
planner turn through OpenClaw's normal runtime paths. It first uses the
configured OpenClaw model. If no configured model is usable yet, it can fall
back to local runtimes already present on the machine:

- Claude Code CLI: `claude-cli/claude-opus-4-8`
- Codex app-server harness: `openai/gpt-5.5`

The model-assisted planner cannot mutate config directly. It must translate the
request into one of Atlas's typed commands, then the normal approval and
audit rules apply. Atlas prints the model it used and the interpreted
command before it runs anything. Configless fallback planner turns are
temporary, tool-disabled where the runtime supports it, and use a temporary
workspace/session.

Message-channel rescue mode does not use the model-assisted planner. Remote
rescue stays deterministic so a broken or compromised normal agent path cannot
be used as a config editor.

## Switching to an agent

Use a natural-language selector to leave Atlas and open the normal TUI:

```text
talk to agent
talk to work agent
switch to main agent
```

`openclaw tui`, `openclaw chat`, and `openclaw terminal` still open the normal
agent TUI directly. They do not start Atlas.

After switching into the normal TUI, use `/atlas` to return to Atlas.
You can include a follow-up request:

```text
/atlas
/atlas restart gateway
```

Agent switches inside the TUI leave a breadcrumb that `/atlas` is available.

## Message rescue mode

Message rescue mode is the message-channel entrypoint for Atlas. It is for
the case where your normal agent is dead, but a trusted channel such as WhatsApp
still receives commands.

Supported text command:

- `/atlas <request>`

Operator flow:

```text
You, in a trusted owner DM: /atlas status
OpenClaw: Atlas rescue mode. Gateway reachable: no. Config valid: no.
You: /atlas restart gateway
OpenClaw: Plan: restart the Gateway. Reply /atlas yes to apply.
You: /atlas yes
OpenClaw: Applied. Audit entry written.
```

Agent creation can also be queued from the local prompt or rescue mode:

```text
create agent work workspace ~/Projects/work model openai/gpt-5.5
/atlas create agent work workspace ~/Projects/work
```

Remote rescue mode is an admin surface. It must be treated like remote config
repair, not like normal chat.

Security contract for remote rescue:

- Disabled when sandboxing is active. If an agent/session is sandboxed,
  Atlas must refuse remote rescue and explain that local CLI repair is
  required.
- Default effective state is `auto`: allow remote rescue only in trusted YOLO
  operation, where the runtime already has unsandboxed local authority.
- Require an explicit owner identity. Rescue must not accept wildcard sender
  rules, open group policy, unauthenticated webhooks, or anonymous channels.
- Owner DMs only by default. Group/channel rescue requires explicit opt-in.
- Plugin search and list are read-only. Plugin install is local-only by default
  because it downloads executable code. Plugin uninstall can be allowed as an
  approved repair operation when rescue policy permits persistent writes.
- Remote rescue cannot open the local TUI or switch into an interactive agent
  session. Use local `openclaw` for agent handoff.
- Persistent writes still require approval, even in rescue mode.
- Audit every applied rescue operation. Message-channel rescue records channel,
  account, sender, and source-address metadata. Config-mutating operations also
  record config hashes before and after.
- Never echo secrets. SecretRef inspection should report availability, not
  values.
- If the Gateway is alive, prefer Gateway typed operations. If the Gateway is
  dead, use only the minimal local repair surface that does not depend on the
  normal agent loop.

Config shape:

```jsonc
{
  "atlas": {
    "rescue": {
      "enabled": "auto",
      "ownerDmOnly": true,
    },
  },
}
```

`enabled` should accept:

- `"auto"`: default. Allow only when the effective runtime is YOLO and
  sandboxing is off.
- `false`: never allow message-channel rescue.
- `true`: explicitly allow rescue when the owner/channel checks pass. This
  still must not bypass the sandboxing denial.

The default `"auto"` YOLO posture is:

- sandbox mode resolves to `off`
- `tools.exec.security` resolves to `full`
- `tools.exec.ask` resolves to `off`

Remote rescue is covered by the Docker lane:

```bash
pnpm test:docker:atlas-rescue
```

Configless local planner fallback is covered by:

```bash
pnpm test:docker:atlas-planner
```

An opt-in live channel command-surface smoke checks `/atlas status` plus a
persistent approval roundtrip through the rescue handler:

```bash
pnpm test:live:atlas-rescue-channel
```

Configless setup through explicit Atlas commands is covered by:

```bash
pnpm test:docker:atlas-first-run
```

That lane starts with an empty state dir, verifies the modern onboard Atlas
entrypoint, sets the default model, creates an additional agent, configures
Discord through a plugin enablement plus token SecretRef, validates config, and
checks the audit log. QA Lab also has a repo-backed scenario for the same Ring 0
flow:

```bash
pnpm openclaw qa suite --scenario atlas-ring-zero-setup
```

## Related

- [CLI reference](/cli)
- [Doctor](/cli/doctor)
- [TUI](/cli/tui)
- [Sandbox](/cli/sandbox)
- [Security](/cli/security)
