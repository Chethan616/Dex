# prompt.md — Get DEX onto the ClawBench leaderboard

**For: Codex (this is your task, not Claude's).**

**Mission:** Wire DEX up to ClawBench (`TIGER-AI-Lab/ClawBench`, live site `clawbench.net`) and get a real result submitted and visible on their public leaderboard. Target: same day, realistically a few hours once the adapter works.

---

## 0. Ground rules — read this first

1. **Do not hallucinate anything about ClawBench's actual interface.** Everything below under "Verified facts" is confirmed by a web search done on 27 October 2026 (sources at the bottom). Everything *not* in that list — the exact CLI flags, the JSON schema `clawbench run` or the `/api/submit` endpoint expects, how a "model" plugs in, auth/token requirements — is **unknown to the person who wrote this prompt**. You must discover it yourself by installing the real package and reading its real `--help` output, README, and source, not by guessing a shape that looks plausible.
2. **If the tool's actual behavior disagrees with anything assumed here, the tool wins.** Stop and report what you found before building further on a wrong assumption.
3. **Work in phases, report after each one.** Don't chain phases blindly — this task involves hitting a real public leaderboard with DEX's name on it, so a bad run submitted carelessly is hard to quietly take back.
4. **Stop at human steps.** An account signup, an API key, a payment-site task that could actually place a real order — mark it `HUMAN STEP`, say exactly what's needed, and wait. Don't let DEX execute a task that could spend real money or create a real booking during benchmark runs unless that's explicitly how ClawBench's own sandbox/test tier works — confirm this from their docs before running anything live-sounding.
5. **Start small.** Run against a tiny subset of the corpus first (a handful of tasks) to confirm the adapter, the result format, and the submission path all actually work end to end, before running the full 130-task corpus.

---

## 1. Verified facts (web search, 27 Oct 2026 — cite, don't exceed)

- ClawBench is real: `github.com/TIGER-AI-Lab/ClawBench`, dataset mirror at `huggingface.co/datasets/TIGER-Lab/ClawBench`, live leaderboard at `clawbench.net`.
- It scores agents on 130 real-world tasks (booking, ordering, email, etc.) across 63 live websites.
- Install: `pip install clawbench-eval`
- Run: `clawbench run --corpus v2 --model your-model`
- Submit existing results: `claw-bench submit ./results/latest`
- Or submit directly via API: `POST https://clawbench.net/api/submit` with framework, model, test tier, custom name, fingerprint, and task results.
- Or open a PR with run artifacts: `github.com/TIGER-AI-Lab/ClawBench/pulls` (slower — needs a human to merge; prefer the API path for same-day visibility).

None of the above tells you the actual `--model` plugin interface, the results JSON schema, or the `/api/submit` payload/auth shape in enough detail to build against blind. Get that from the installed package.

---

## 2. What DEX gives you to work with

DEX's engine adapters live in `desktop/app/src/main/hl/engines/` (e.g. `claude-code/adapter.ts`, `codex/adapter.ts`, `browsercode/adapter.ts`). Read the existing adapter pattern there before building a ClawBench-facing wrapper — you likely want a small script that:

1. Takes one ClawBench task (its instruction text, and whatever target/site info the corpus gives you).
2. Spawns a DEX task against it, the same way DEX's own `benchmarks/dex-bench/run.mjs` and `benchmarks/waa` harnesses already spawn tasks against an engine — read those two for the existing pattern of "give DEX a task programmatically, capture its final answer/trace."
3. Captures DEX's final result in whatever shape ClawBench's `clawbench-eval` package actually expects for a results file (again: read the installed package, don't assume).

Reuse the existing benchmark-harness pattern in this repo rather than inventing a new one — `benchmarks/dex-bench/run.mjs` is the closest prior art for "run DEX against an external task corpus and capture structured results."

---

## 3. Steps

1. `pip install clawbench-eval` in a clean venv. Run `clawbench --help` and `clawbench run --help`. Read whatever README/docs ship with the package or point to on GitHub. Report back the actual `--model` interface before writing any adapter code.
2. Look at a handful of real ClawBench v2 corpus tasks (read, don't run yet) to understand what a task description looks like and what counts as a correct/complete result.
3. Build the smallest possible adapter: DEX takes one task, runs it for real, produces one result in ClawBench's expected format. Verify this against their schema/validator if one exists in the package.
4. Run that adapter against 3-5 tasks only. Sanity-check the results look right before scaling up.
5. Run the full `--corpus v2` pass.
6. Submit: prefer `POST https://clawbench.net/api/submit` for same-day visibility (confirm the real payload shape from the package/docs first) over the PR route, which needs a maintainer merge and isn't a same-day guarantee.
7. Confirm the entry is actually live on `clawbench.net` under DEX's name before calling this done.

---

## Sources (web search, 27 Oct 2026)
- https://github.com/TIGER-AI-Lab/ClawBench
- https://huggingface.co/datasets/TIGER-Lab/ClawBench/blob/main/README.md
- https://www.clawbench.com/ / https://clawbench.net/
- https://github.com/TIGER-AI-Lab/ClawBench/issues/192
