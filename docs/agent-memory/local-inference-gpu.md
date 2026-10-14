---
name: local-inference-gpu
description: "Local LLM inference on this ASUS ROG G513QY: Ollama installed on D:, GPU blocked by a 2021 AMD driver — ROCm refuses, Vulkan computes garbage"
metadata: 
  node_type: memory
  type: project
  originSessionId: 46b9c244-fb0f-4a55-af95-ba2f135b9cb6
  modified: 2026-08-25T18:37:28.235Z
---

Machine: ASUS ROG Strix G513QY (AMD Advantage) — Ryzen 9 5980HX, **Radeon RX 6800M
12 GB** (Windows' WMI `AdapterRAM` reports 4 GB; that field is 32-bit and wrong —
read `HardwareInformation.qwMemorySize` from the driver registry key instead).

**Ollama lives entirely on D:** — the owner asked for this explicitly.
`D:\Ollama` (program), `OLLAMA_MODELS=D:\ollama\models` (user env var, set).
`OllamaSetup.exe` is NOT Inno/NSIS and silently ignores `/VERYSILENT` and `/DIR`
— it exits 0 having installed nothing. Use the release ZIPs instead:
`ollama-windows-amd64.zip` plus `ollama-windows-amd64-rocm.zip` extracted over
the top of it.

**Measured 2026-08-26, Ollama 0.32.15, driver 30.0.13002.13003 (dated 2021-12-15):**

| Backend | Result |
|---|---|
| ROCm | refuses — `AMD driver is too old`, `hipGetDeviceCount failed: 100` |
| Vulkan | binds, `100% GPU`, 269 tok/s — but emits garbage (`عمار@@@@@@`) |
| CPU | correct output, 28.5 tok/s on a 0.5B model |

**Why:** the driver is the single blocker, not the GPU and not Ollama. The
bundled ROCm runner ships `gfx1030` kernels and the RX 6800M is `gfx1031`, so
`HSA_OVERRIDE_GFX_VERSION=10.3.0` is set and correct — but the driver fails
before that ever matters. Vulkan's wrong-but-fast output is the more dangerous
failure: it looks like it works.

**How to apply:** local 7B vision inference (UI-TARS) is not viable until the
owner installs a current AMD Adrenalin driver and re-runs the check. Verify with
`ollama ps` (expect `100% GPU`) AND an actual generation whose text is correct —
`100% GPU` alone is not proof, as the Vulkan case shows. At 28.5 tok/s for 0.5B,
CPU fallback would put a 7B VLM at roughly 30-60s per call, which the Desktop
Agent's ~30-calls-per-task loop cannot absorb.

Related: [[project-overview]] [[llm-provider-limits]]
