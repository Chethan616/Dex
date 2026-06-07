# Phase G.1 — File Intelligence Research Report

**Status**: research-first deliverable. **NO G.2+ implementation may begin until this report is reviewed and the per-category recommendations are confirmed.**

**Generated**: 2026-06-07
**Author**: Chethan616 + Claude (Dex)
**Caveat**: Star counts, recent commit dates, and license confirmations in this report are best-effort from training knowledge through early 2026. Before any G.2 commit, the implementer MUST spot-check 3-5 candidates by visiting the live GitHub page. Treat this as the framework + first-pass shortlist, not the final word.

---

## 0. Why this report exists

The slash-plan's Phase G mandate is **reuse > extend > build**. Dex must not reinvent semantic search, OCR, document parsing, or vector storage when mature open-source projects already cover those surfaces well. This report audits the leading candidates per category, applies a per-repo evaluation matrix, and emits a per-category recommendation that G.2-G.10 implementation will follow.

---

## 1. Categories audited

| Category | Why Dex needs it | Candidates evaluated |
|---|---|---|
| **Desktop full-system search** | Find files by name/metadata across Desktop / Documents / Downloads / Pictures | Everything (voidtools), DocFetcher, Recoll, Catfish, Search Monkey |
| **Semantic search / RAG** | Natural-language file search ("find my Aadhaar card") | Semantra, AnythingLLM, Open WebUI, MemOS, txtai, LangChain |
| **OCR (image + scanned PDF)** | Extract text from PNG/JPG/scans | Tesseract, PaddleOCR, OCRmyPDF, EasyOCR |
| **Document parsing** | PDF / DOCX / TXT / MD extraction with structure preserved | Docling (IBM), Apache Tika, Unstructured, marker, PyMuPDF |
| **Vector databases** | Store embeddings + filterable metadata | Qdrant, Chroma, Weaviate, LanceDB |
| **Full-text search** | BM25-style keyword search (hybrid with vector) | Meilisearch, Typesense, Tantivy, MiniSearch, ZincSearch |

---

## 2. Evaluation matrix (applied per candidate)

| Criterion | What we check | Why it matters |
|---|---|---|
| **Stars** | GitHub repo star count | Crude maturity signal; tells us community reach |
| **Recent commits** | Last commit < 90 days | Maintenance signal; abandoned projects become tech debt fast |
| **License** | MIT / Apache 2.0 / BSD-3 → OK; AGPL / proprietary → blocked | Dex ships under MIT; can't ship AGPL inside the package |
| **Local-first** | No mandatory cloud endpoint | Phase G's hard rule (privacy + no cloud calls) |
| **Resource footprint** | RAM at idle + disk size | Dex runs on user laptops; can't ship a 16 GB-RAM dependency |
| **Embedding / extensibility** | CLI? Node bindings? Library import? Plugin SDK? | Dex needs to call it from Node 24 |
| **Cross-platform** | Win / Linux / macOS desktop | All three are Dex targets |
| **Active maintainer responsiveness** | Issue / PR turnaround in last 30 days | Predicts how fast bugs we file get fixed |

---

## 3. Category 1 — Desktop full-system search

### 3.1 Everything (voidtools)

| Criterion | Verdict |
|---|---|
| Stars | n/a (closed-source) |
| License | **Proprietary, freeware** — not OSS, but free for personal/commercial. SDK available. |
| Local-first | Yes |
| Resource | Famously light (~20 MB RAM, indexes 1M files in seconds) |
| Extensibility | C++ SDK + IPC | exposes `Everything_SetSearch`, `Everything_Query` |
| Cross-platform | **Windows-only** |
| Verdict | **Borrow the idea, not the binary.** Everything's NTFS-MFT-direct-read trick is the industry standard for "stupidly fast file name search on Windows." Dex G.2's scanner should consult MFT directly on Windows for the name index, mirror to a SQLite metadata table. Cannot bundle Everything itself due to proprietary license. |

### 3.2 DocFetcher

Java app + Lucene. Cross-platform but Java runtime requirement adds ~150 MB. Last commit looked stale (2-3 years ago in our snapshot). **Not recommended** — Lucene is fine but we'd reach for Tantivy (Rust) instead.

### 3.3 Recoll

Mature C++ desktop search engine, Xapian-backed. Linux-first. Decent on macOS via Homebrew. Windows port is alpha-quality. License: GPL-2.0 — **incompatible with MIT shipping**. **Not recommended** for embedding.

### 3.4 Catfish

GTK-based Linux desktop search. Linux-only. **Out of scope** for Windows-first MVP.

### 3.5 Search Monkey

Older. Inactive. **Not recommended.**

### Category 1 — Recommendation

**Build a thin Node-native scanner that:**
- On Windows: reads NTFS MFT directly via a small native module (or shells out to `Everything.exe` if the user already has it installed) for instant filename indexing.
- On macOS: queries Spotlight (`mdfind`) for filename + metadata.
- On Linux: walks the filesystem with chokidar; uses `locate` if available.

Don't bundle a separate full-system-search daemon. Dex's index is for **content** (semantic + OCR). Filename search delegates to OS-native APIs.

---

## 4. Category 2 — Semantic search / RAG

### 4.1 Semantra

Python CLI for semantic search over PDFs. Solid single-purpose tool. License: MIT. **Strong reference architecture** for our pipeline; not a library we'd embed wholesale. Worth reading the source.

### 4.2 AnythingLLM

Full-stack RAG desktop app (Electron + Node + SQLite + LanceDB). Very actively maintained. License: MIT. **Closest analog to Dex's file-intel goal,** but it's an *application* not a library — we can't import its pipeline cleanly. Worth borrowing patterns (LanceDB integration, doc-loader registry).

### 4.3 Open WebUI

Web-UI front-end for Ollama with RAG. Local-first. License: BSD-3. Out of scope as a whole; relevant only for embedding/Ollama integration patterns.

### 4.4 MemOS

OS-level memory for LLMs. Less mature; smaller community. **Defer** — not enough adoption signal.

### 4.5 txtai

Python library: embeddings + vector store + LLM workflows. License: Apache 2.0. **Mature, well-documented, but Python-side.** Dex's brain is Node — we'd run txtai as a separate process via subprocess if we picked it.

### 4.6 LangChain (JS / TS)

Vast ecosystem; covers loaders, splitters, vectors, retrievers. License: MIT. **Pros**: every backend we'd want is already adapted. **Cons**: heavy, opinionated, version churn. Pulls in a ton of transitive deps.

### Category 2 — Recommendation

**Compose a thin pipeline from focused libraries; don't adopt a framework.**

- **Loaders** — implement directly (Docling for PDF/DOCX, raw read for TXT/MD, OCR for images).
- **Chunker** — write our own (~50 LOC), token-aware.
- **Embedder** — call Ollama's REST endpoint directly (~30 LOC).
- **Vector store** — see §7.
- **Retriever** — write our own (vector + fulltext + RRF), ~100 LOC.

Borrow the *shape* of AnythingLLM (file watcher → loader → chunker → embedder → store) but write the orchestration in Node-native TypeScript for tight integration with the rest of `dex-core`.

---

## 5. Category 3 — OCR (image + scanned PDF)

### 5.1 Tesseract

LSTM-based OCR. License: Apache 2.0. **Industry standard.** Trade-offs: solid accuracy on clean documents, struggles with handwriting / rotated text / colored backgrounds. Available as a native binary on all three platforms via `winget install tesseract-ocr`, `brew install tesseract`, `apt install tesseract-ocr`. Node bindings: `tesseract.js` (pure JS, works but slow) or shell out to native binary (faster, requires user install).

### 5.2 PaddleOCR

Baidu's OCR. Apache 2.0. **More accurate than Tesseract on Asian languages**, comparable on English. Bigger model (~100 MB). Python-only realistically.

### 5.3 OCRmyPDF

Wrapper that runs Tesseract over a PDF, embeds the OCR layer back into the file. License: MPL-2.0. Useful as a *user tool* (the user can run it manually); not a library Dex embeds.

### 5.4 EasyOCR

Python; PyTorch-backed. Apache 2.0. Heavier than Tesseract, marginally more accurate, slower at runtime. **Don't recommend** unless user explicitly opts in.

### Category 3 — Recommendation

**Tesseract for OCR, called via the native binary.**

- **First choice**: shell out to the installed `tesseract` binary. Fast, well-tested, ~10 MB on disk, no Python dep.
- **Fallback**: `tesseract.js` for environments where native install isn't possible (5x slower but zero install).
- For Asian-language documents: detect the script and switch to PaddleOCR via a separate Python sidecar (deferred to G.6+).

---

## 6. Category 4 — Document parsing

### 6.1 Docling (IBM)

Recent (2024). License: MIT. **Specifically built for RAG pipelines.** Strong PDF layout understanding; converts PDF/DOCX/PPTX → markdown with preserved structure. Python-only realistically (~150 MB install with deps including PyTorch for the layout model).

### 6.2 Apache Tika

Mature Java library. Apache 2.0. **Universal parser** (handles ~1500 formats). JVM dependency is a heavy ask for a Node app, but it works headless via the `tika-server.jar` REST endpoint.

### 6.3 Unstructured

Python. Apache 2.0. RAG-focused like Docling. Cloud-first business model but the open-source library works fully local. Comparable to Docling; slightly more mature.

### 6.4 marker

Specialized PDF → markdown converter. License: GPL-3.0 — **blocked** for shipping inside Dex.

### 6.5 PyMuPDF

Fast, mature. License: AGPL-3.0 — **blocked** for embedding (commercial license available but $$).

### Category 4 — Recommendation

**Docling for PDF / DOCX / PPTX, with `pdf-parse` (Node) as fallback.**

- Spawn Docling as a Python sidecar (its own venv next to UFO² / browser-use). Node calls it via subprocess or local HTTP.
- For users who skip Docling install, fall back to `pdf-parse` (Node, MIT) — works but loses layout understanding.
- Plain TXT / MD: read directly in Node. No library needed.

---

## 7. Category 5 — Vector databases

### 7.1 Qdrant

Rust core, REST + gRPC API. License: Apache 2.0. **Strong local mode** (embedded mode in Rust binary, no Docker required). Good Node SDK. Filterable payload (we need this for `classification = "aadhaar"`-style queries). **Top pick.**

### 7.2 Chroma

Python-first; runs in-process. License: Apache 2.0. Lightweight, but the local mode persists to SQLite which is fine for v1. Node client OK but less polished than Qdrant's.

### 7.3 Weaviate

GraphQL API. License: BSD-3. Mature but heavier; typically runs as a service. **Not local-first enough** for Dex's privacy-first stance.

### 7.4 LanceDB

Embedded vector + columnar store. License: Apache 2.0. **Lightweight, no daemon.** Strong Node SDK. **Strong second pick** if Qdrant's binary footprint is too heavy.

### Category 5 — Recommendation

**Qdrant local mode for v1.** Reasons:
- Embedded mode (no Docker, no separate service) since v1.7.
- Best-in-class filter performance for our `classification`-keyed lookups.
- Node SDK has good TS types.
- If footprint becomes a concern later, LanceDB swap is a 1-file change behind the `vector-store` interface.

---

## 8. Category 6 — Full-text search

### 8.1 Meilisearch

Rust, REST API. License: MIT. **Strong devex, ~80 MB binary.** Requires a separate service. Maybe overkill for a personal local-first app, but excellent.

### 8.2 Typesense

C++. License: GPL-3.0 — **blocked** for embedding.

### 8.3 Tantivy

Lucene-in-Rust. License: MIT. **Library, not a service.** Used as the backend for many search products. Node bindings exist (`@tantivy/...`) but maturity varies.

### 8.4 MiniSearch

Pure JS / TS. License: MIT. **Tiny (~20 KB), in-process, no native binary.** Less feature-rich than Tantivy but fast enough for tens of thousands of documents.

### 8.5 ZincSearch

Drop-in Elasticsearch replacement. License: Apache 2.0. Heavier; aimed at log search at scale. Out of scope for a personal app.

### Category 6 — Recommendation

**MiniSearch for v1, Tantivy for v2 if scale demands it.**

- MiniSearch indexes 100k documents in memory comfortably; persisted via JSON snapshot.
- For >500k documents (heavy power users), upgrade to Tantivy via a Rust sidecar. Tracked as G.2+ follow-up.
- Hybrid retrieval: vector (Qdrant) + full-text (MiniSearch) merged via Reciprocal Rank Fusion. Pure Node, ~50 LOC.

---

## 9. Final recommendations — per-category cheat sheet

| Surface | Pick | License | Rationale |
|---|---|---|---|
| **Filename / metadata search** | OS-native (MFT / Spotlight / locate) | n/a | Don't reinvent OS APIs |
| **RAG pipeline** | Custom Node-native composition | MIT | No framework lock-in; compose focused libraries |
| **OCR** | Tesseract native binary, `tesseract.js` fallback | Apache 2.0 / MIT | Industry standard; fast; light |
| **Document parsing** | Docling (Python sidecar) + `pdf-parse` (Node fallback) | MIT | Layout-aware for v1; degrades gracefully |
| **Vector DB** | Qdrant local mode | Apache 2.0 | Best filter performance, embedded mode, no Docker |
| **Full-text search** | MiniSearch (Node) → Tantivy (Rust sidecar) at scale | MIT | In-process is enough for v1; Rust path open |
| **Embeddings** | Ollama + `nomic-embed-text` | OSS chain | Local, free, good quality, no API key |
| **Hybrid retrieval** | Custom RRF in Node | n/a | ~50 LOC; clear ownership |

---

## 10. What G.2+ will build (NOT what we copy in)

Concretely, the file-intel scaffold under `dex/core/packages/file-intel/` will be **our code that orchestrates the picks above**:

- `src/indexer/scanner.ts` — chokidar + OS-native filename probe
- `src/indexer/extractor.ts` — invokes Docling sidecar (Python) or `pdf-parse` (Node) based on availability
- `src/indexer/ocr.ts` — shells out to `tesseract` binary; falls back to `tesseract.js`
- `src/indexer/classifier.ts` — regex on filename + Beta-prior over Ollama embeddings of label prototypes
- `src/store/qdrant.ts` — Qdrant local-mode client wrapper
- `src/store/fulltext.ts` — MiniSearch index, JSON-snapshot persistence
- `src/store/metadata.ts` — SQLite via Kysely (existing dex-core helper)
- `src/search/hybrid.ts` — vector + full-text RRF
- `src/delivery/*` — DeliveryProvider implementations (DexDirect, Email, WhatsApp, ...)

**~2500-3500 LOC total** for the v1 MVP. No frameworks imported; only focused libraries.

---

## 11. Verification gate before G.2

Before any G.2 commit lands, the following MUST be done (and the result either confirms this report or amends it):

- [ ] Visit each top-pick repo on GitHub, confirm stars, license, and last-commit recency match this report's claims (or update if stale).
- [ ] Spot-check one Docling install on a fresh Win11 venv to confirm install footprint is acceptable (< 500 MB).
- [ ] Spot-check Qdrant local-mode binary: download it, run a single insert + query, confirm latency < 50 ms on the user's laptop.
- [ ] Spot-check tesseract availability across all three target OSes.

Once those four spot-checks pass, sign this report and proceed to G.2.

---

## 12. Open questions for Chethan

1. **Docling install size** — is ~500 MB of Python deps acceptable on a fresh install? If not, we ship `pdf-parse` only by default and offer Docling as opt-in.
2. **Ollama dependency** — is requiring Ollama install acceptable? It's another ~5 GB download. Alternative: ship a tiny ONNX embedding model (lower quality, ~100 MB).
3. **OS-native search via MFT on Windows** — requires a small native module. Acceptable, or fall back to chokidar walk (slower first-run)?
4. **OCR opt-in vs default** — many users won't have OCR needs. Default-on adds Tesseract install friction; default-off means image files don't surface in semantic search. Default to: **off; surface a one-click "enable OCR" toggle in Dex Settings (v1.4)**.
