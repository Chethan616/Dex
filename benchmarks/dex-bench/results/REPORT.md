# DEX-Bench results

24 OSWorld-style tasks on this Windows PC, each checked by a script that reads the end state (files, the local test site's records). Same prompts and same model for every agent. See README.md for the method.

## Score

| Agent | Passed | Rate | Median time | Median steps |
|---|---|---|---|---|
| DEX (Claude Code engine, opus) | 24/24 | **100%** | 40 s | 4 |

## By category

| Category | Tasks | DEX (Claude Code engine, opus) |
|---|---|---|
| Web | 6 | 6/6 |
| Files & OS | 5 | 5/5 |
| Documents | 4 | 4/4 |
| Windows apps | 4 | 4/4 |
| Multi-app | 3 | 3/3 |
| Infeasible | 2 | 2/2 |

## Every task

| Task | DEX (Claude Code engine, opus) |
|---|---|
| `web-cart` | ✅ 98s |
| `web-form` | ✅ 40s |
| `web-table` | ✅ 31s |
| `web-login` | ✅ 40s |
| `web-pages` | ✅ 37s |
| `web-settings` | ✅ 55s |
| `os-organize` | ✅ 31s |
| `os-rename` | ✅ 31s |
| `os-find` | ✅ 49s |
| `os-zip` | ✅ 28s |
| `os-sysinfo` | ✅ 16s |
| `doc-create` | ✅ 22s |
| `xlsx-total` | ✅ 55s |
| `csv-clean` | ✅ 22s |
| `doc-edit` | ✅ 37s |
| `app-notepad` | ✅ 98s |
| `app-calc` | ✅ 258s |
| `app-display` | ✅ 48s |
| `app-explorer` | ✅ 97s |
| `multi-web-xlsx` | ✅ 59s |
| `multi-reply` | ✅ 22s |
| `multi-chart` | ✅ 38s |
| `infeasible-file` | ✅ 26s |
| `infeasible-web` | ✅ 50s |

## Why each failure failed

**DEX (Claude Code engine, opus):** none.


Raw results: `results/dex-2026-10-20T10-48-49.json`.
