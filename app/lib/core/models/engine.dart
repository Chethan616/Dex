// Phase C.7-flutter -- engine identity for the Live panel + tool chip.
//
// The TS orchestrator under `dex/core/src/orchestration/` picks one of four
// AutomationEngines per task (shell / ufo-uia / browser-use / omniparser).
// The gateway doesn't yet emit a structured "engineAttempt" event with the
// chosen engine id, so until C.7+ wires that through we infer the engine
// from the MCP tool id that fired -- a deterministic 1:1 map.
//
// Mapping rationale (mirrors the BASE_SCORE_TABLE in
// dex/core/src/orchestration/capability-scorer.ts):
//   windows-desktop-control / run_desktop_task -> ufo-uia
//   browser-control          / run_browser_task -> browser-use
//   omniparser               / parse_screen     -> omniparser
//   bash / read / write / process / edit       -> shell

import 'package:flutter/material.dart';

import '../../theme/tokens.dart';

enum EngineId { shell, ufoUia, browserUse, omniparser }

class EngineDescriptor {
  final EngineId id;
  final String label;
  final IconData icon;
  /// Used to tint the engine pill in the Live panel + chip. Pulled from the
  /// existing palette so the pill blends with everything else on screen.
  final Color color;
  const EngineDescriptor({
    required this.id,
    required this.label,
    required this.icon,
    required this.color,
  });
}

/// Stable per-engine display metadata. Same labels the TS scorer uses for
/// telemetry keys, so logs + UI stay legible together.
EngineDescriptor descriptorForEngine(EngineId id) {
  switch (id) {
    case EngineId.shell:
      return EngineDescriptor(
        id: id,
        label: 'shell',
        icon: Icons.terminal,
        color: DexColors.textDim,
      );
    case EngineId.ufoUia:
      return EngineDescriptor(
        id: id,
        label: 'ufo-uia',
        icon: Icons.desktop_windows,
        color: DexColors.accent,
      );
    case EngineId.browserUse:
      return EngineDescriptor(
        id: id,
        label: 'browser-use',
        icon: Icons.public,
        color: DexColors.stateActing,
      );
    case EngineId.omniparser:
      return EngineDescriptor(
        id: id,
        label: 'omniparser',
        icon: Icons.visibility,
        color: DexColors.stateAwaiting,
      );
  }
}

/// MCP tool id -> orchestrator engine. Returns `EngineId.shell` for any
/// tool we don't recognise (Dex's built-in shell-class tools plus
/// anything user-installed). The caller is free to treat the fallback as
/// "engine unknown" by checking against a known-set if needed.
EngineId engineForToolId(String toolId) {
  // Strip an `mcp__servername__toolname` prefix if present, then look at
  // both the full id and the bare last segment.
  final variants = <String>{
    toolId,
    toolId.split('__').last,
    toolId.split('.').last,
  };

  bool any(Set<String> hits) => variants.any(hits.contains);

  if (any(const {
    'windows-desktop-control',
    'run_desktop_task',
    'desktop-control',
    'ufo',
  })) {
    return EngineId.ufoUia;
  }
  if (any(const {
    'browser-control',
    'run_browser_task',
    'browser',
    'browser-use',
  })) {
    return EngineId.browserUse;
  }
  if (any(const {
    'omniparser',
    'parse_screen',
    'omni-parser',
  })) {
    return EngineId.omniparser;
  }
  // Default: anything Dex-built-in (bash, read, write, edit, process)
  // routes through the shell engine in the capability-scorer's table.
  return EngineId.shell;
}
