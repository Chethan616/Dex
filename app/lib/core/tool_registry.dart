// Tool registry -- maps raw MCP tool ids to friendly display names + icons
// for the Gemini-style tool chip in the conversation surface.
//
// One map, one source of truth. Unknown tool ids fall back to their raw id
// + a generic icon, so the chip still renders meaningfully when Claude
// picks a tool the registry hasn't been taught about yet.

import 'package:flutter/material.dart';

class ToolDescriptor {
  final String friendlyName;
  final IconData icon;
  const ToolDescriptor(this.friendlyName, this.icon);
}

/// Lookup keyed by MCP tool id (the `name` exposed by each MCP server).
const Map<String, ToolDescriptor> _toolRegistry = <String, ToolDescriptor>{
  // Dex-built MCP servers.
  'windows-desktop-control': ToolDescriptor('Windows app', Icons.desktop_windows),
  'browser-control':         ToolDescriptor('Browser',     Icons.public),

  // OpenClaw's built-in tools that we want to surface explicitly.
  'bash':    ToolDescriptor('Shell',      Icons.terminal),
  'process': ToolDescriptor('Process',    Icons.memory),
  'read':    ToolDescriptor('File read',  Icons.description),
  'write':   ToolDescriptor('File write', Icons.edit_document),
  'edit':    ToolDescriptor('File edit',  Icons.edit_note),
  'browser': ToolDescriptor('Browser',    Icons.public),

  // Common bare tool names that show up from agent runtimes.
  'run_desktop_task': ToolDescriptor('Windows app', Icons.desktop_windows),
  'run_browser_task': ToolDescriptor('Browser',     Icons.public),
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
  return ToolDescriptor(toolId, Icons.extension);
}
