// Tool registry -- maps raw MCP tool ids to friendly display names + icons
// for the Gemini-style tool chip in the conversation surface.
//
// One map, one source of truth. Unknown tool ids fall back to their raw id
// + a generic icon, so the chip still renders meaningfully when Claude
// picks a tool the registry hasn't been taught about yet.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

class ToolDescriptor {
  final String friendlyName;
  final IconData icon;
  const ToolDescriptor(this.friendlyName, this.icon);
}

/// Lookup keyed by MCP tool id (the `name` exposed by each MCP server).
const Map<String, ToolDescriptor> _toolRegistry = <String, ToolDescriptor>{
  // Dex-built MCP servers.
  'windows-desktop-control': ToolDescriptor('Windows app', LucideIcons.monitor),
  'browser-control':         ToolDescriptor('Browser',     LucideIcons.globe),

  // Dex brain's built-in tools that we want to surface explicitly.
  'bash':    ToolDescriptor('Shell',      LucideIcons.terminal),
  'process': ToolDescriptor('Process',    LucideIcons.cpu),
  'read':    ToolDescriptor('File read',  LucideIcons.file_text),
  'write':   ToolDescriptor('File write', LucideIcons.file_pen),
  'edit':    ToolDescriptor('File edit',  LucideIcons.pencil_line),
  'browser': ToolDescriptor('Browser',    LucideIcons.globe),

  // Common bare tool names that show up from agent runtimes.
  'run_desktop_task': ToolDescriptor('Windows app', LucideIcons.monitor),
  'run_browser_task': ToolDescriptor('Browser',     LucideIcons.globe),
};

ToolDescriptor descriptorFor(String toolId) {
  // Try the raw id, then strip a leading `mcp__servername__` prefix some
  // gateways add, then the bare last segment.
  final variants = <String>[
    toolId,
    toolId.split('__').last,
    toolId.split('.').last,
  ];
  for (final v in variants) {
    final hit = _toolRegistry[v];
    if (hit != null) return hit;
  }
  return ToolDescriptor(toolId, LucideIcons.puzzle);
}
