# @dexagent/file-intel — Phase G

**Status**: SCAFFOLD ONLY. Type definitions + façade interface land here so callers (the gateway, the Flutter UI, the Phone client) can begin importing the contract. **No implementation files are committed yet** — they are gated on the G.1 verification spot-checks documented in `docs/g-research/file-intelligence-comparison.md` (§11).

When implementation begins (G.3+):
- The four spot-checks from G.1 §11 MUST be done first (live GitHub state, Docling install size, Qdrant local latency, tesseract cross-OS availability).
- The "Open questions for Chethan" in G.1 §12 must be answered (Docling install size, Ollama dep, MFT native module, OCR default).
- Each G.* sub-task lands one cohesive piece — scanner, extractor, OCR, classifier, embedder, store, search, delivery providers, mesh — per the locked sequence.

## Contract surface — what consumers see today

`src/types.ts` defines the shapes the consumer-facing facade in `src/index.ts` will expose. Both files are typed and tested but unimplemented; calling any method throws `not_yet_implemented` so accidental usage in production fails loudly.

The facade is intentionally async-only and never throws synchronous errors — every entry point returns a `Promise<Result<T, FileIntelError>>` so the Flutter UI can render error states cleanly.

## v1 deliverable scope (from the slash-plan)

| Surface | Owner | Status |
|---|---|---|
| Indexing pipeline (chokidar + Docling + OCR + classifier) | G.3-G.5 | ⏳ awaits gate |
| SQLite + Qdrant store | G.4 | ⏳ awaits gate |
| Single-device search (hybrid vector + full-text RRF) | G.6 | ⏳ awaits gate |
| Multi-device mesh (search fanout + result merge) | G.7 | ⏳ awaits gate |
| DeliveryProvider interface + v1 providers | G.8 | ⏳ awaits gate |
| WhatsApp / Email providers | G.9 | ⏳ awaits gate |
| `dex file-intel setup` CLI | G.10 | ⏳ awaits gate |

## Why scaffold now if the implementation is gated?

So consumers (the gateway dispatch, the Flutter Live panel chip, the mobile native clients) can refer to `FileIntel` interfaces and `FileMetadata` / `SearchHit` / `DeliveryProvider` types in their own code without us blocking on the verification gate. The types ARE the contract; implementing them is a separate question. This separation lets the rest of Dex move while G's verification work happens in parallel.
