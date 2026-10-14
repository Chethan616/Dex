---
name: llm-provider-limits
description: "Measured free-tier limits for DEX: Gemini key is capped at 20 requests/DAY; Groq works with tool calling; DEX needs ~30 model calls per GUI task"
metadata: 
  node_type: memory
  type: project
  originSessionId: 46b9c244-fb0f-4a55-af95-ba2f135b9cb6
  modified: 2026-08-25T18:37:42.589Z
---

DEX has no Anthropic key. Measured alternatives on 2026-08-26.

**Gemini — 20 requests per DAY.** The 429 body names the quota exactly:
`GenerateRequestsPerDayPerProjectPerModel-FreeTier | value: 20`. Not per minute.
The key in use starts `AQ.` rather than the usual AI Studio `AIza` prefix, which
may be why it is this severe — worth re-checking with a standard AI Studio key.

**Groq works.** `openai/gpt-oss-120b` returns valid `tool_calls`, which the Brain
requires. Two traps: it is a *reasoning* model, so a small `max_tokens` gets
eaten entirely by reasoning tokens and returns **empty content** (seen with
`max_tokens: 20`); and its plan quality is loose — it invented free-text actions
and tagged trivial reads as Tier 1.

**Why this matters:** DEX's per-task call counts are what disqualify the free
tiers, not token size.

| Workload | Model calls per task |
|---|---|
| Brain | 1 |
| Browser `run_task` | ~25 |
| Desktop GUI task | ~30 (Worker + Grounding, both vision) |

So a single Desktop task exceeds Gemini's entire daily quota. Local inference is
the only option for the Desktop Agent — see [[local-inference-gpu]].

**How to apply:** Brain → Groq. Browser → Groq with browser-use `flash_mode=True`
(drops its system prompt from 5,273 to 516 tokens/step). Desktop → local, once
the GPU driver is fixed. Treat Gemini as spot-checks only.

**Also measured:** `grounding.py`'s current prompt format is bad. Asking Gemini
for raw `{"x":..,"y":..}` pixels gave 1359px and 1531px errors on buttons that
Google's normalized `box_2d` 0-1000 format located to 1px and 3px. Same model,
same image — the prompt is the bug. Keys are in the DPAPI credential store
(`npm run cred -- list`), not `.env`.

Related: [[project-overview]] [[local-inference-gpu]]
