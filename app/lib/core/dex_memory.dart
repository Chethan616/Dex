// DexMemory — the user-facing editor over Dex's long-term memory file.
//
// The agent's memory lives in ONE compact file the operator workspace
// already reads: ~/.dex/workspace/MEMORY.md (see the AGENTS.md seed and
// dex-core's workspace bootstrap loader — MEMORY.md is injected once as
// workspace context and prompt-cached, NOT re-derived from chat history
// every turn). That's the token-efficient, MNC-style memory model:
// a bounded curated set of facts, loaded once, updated on demand.
//
// This class is the Settings surface for that same file: list facts,
// add a fact, delete a fact, and toggle memory on/off. The agent writes
// to the same file via its memory flush, so the UI and the agent share
// one source of truth.

import 'dart:io';

import 'package:flutter/foundation.dart';

/// One remembered fact, paired with the raw line it came from so deletes
/// target the exact bullet even when two facts read alike after trimming.
@immutable
class MemoryFact {
  const MemoryFact({required this.text, required this.rawLine});
  final String text;
  final String rawLine;
}

class DexMemory {
  DexMemory._();

  static String get _home =>
      Platform.environment['USERPROFILE'] ?? Platform.environment['HOME'] ?? '';
  static String get _sep => Platform.pathSeparator;

  static Directory get _workspace =>
      Directory('$_home$_sep.dex${_sep}workspace');

  static File get _file => File('${_workspace.path}${_sep}MEMORY.md');

  /// When the user turns personalisation off we move the file aside rather
  /// than delete it, so toggling back restores everything. The workspace
  /// loader only picks up `MEMORY.md`, so the `.disabled` copy is inert.
  static File get _disabledFile =>
      File('${_workspace.path}${_sep}MEMORY.md.disabled');

  static const String _header =
      '# MEMORY.md — what Dex remembers about you\n\n'
      'Durable facts and preferences. One bullet per fact. Dex reads this\n'
      'as long-term memory and appends here when you ask it to remember.\n';

  /// True when personalisation/memory is active (the live file exists or
  /// can be created). False only when the user disabled it.
  static bool get isEnabled => !_disabledFile.existsSync() || _file.existsSync();

  /// Parse the live MEMORY.md into facts. Each bullet (`- ` / `* `) is one
  /// fact; headings, blank lines, and prose are skipped for the list view
  /// but preserved in the file.
  static List<MemoryFact> read() {
    try {
      if (!_file.existsSync()) return const <MemoryFact>[];
      final lines = _file.readAsLinesSync();
      final facts = <MemoryFact>[];
      for (final line in lines) {
        final t = line.trimLeft();
        if (t.startsWith('- ') || t.startsWith('* ')) {
          final text = t.substring(2).trim();
          if (text.isNotEmpty) facts.add(MemoryFact(text: text, rawLine: line));
        }
      }
      return facts;
    } catch (e) {
      debugPrint('[dex] read MEMORY.md failed: $e');
      return const <MemoryFact>[];
    }
  }

  /// Append one fact as a bullet, creating the file (with header) if needed.
  /// Accepts multi-line input by splitting on newlines into separate facts.
  static void addFact(String text) {
    final pieces = text
        .split('\n')
        .map((p) => p.trim())
        .where((p) => p.isNotEmpty)
        .toList(growable: false);
    if (pieces.isEmpty) return;
    _workspace.createSync(recursive: true);
    final exists = _file.existsSync();
    final sink = StringBuffer();
    if (!exists) {
      sink.write(_header);
    } else {
      // Ensure we start the new bullets on their own line.
      final current = _file.readAsStringSync();
      if (current.isNotEmpty && !current.endsWith('\n')) sink.write('\n');
    }
    for (final p in pieces) {
      sink.writeln('- $p');
    }
    _file.writeAsStringSync(sink.toString(),
        mode: exists ? FileMode.append : FileMode.write);
  }

  /// Remove the exact bullet line backing a fact.
  static void deleteFact(MemoryFact fact) {
    if (!_file.existsSync()) return;
    final lines = _file.readAsLinesSync();
    var removed = false;
    final kept = <String>[];
    for (final line in lines) {
      if (!removed && line == fact.rawLine) {
        removed = true;
        continue;
      }
      kept.add(line);
    }
    _file.writeAsStringSync('${kept.join('\n')}\n');
  }

  /// Turn personalisation/memory on or off by moving the file aside. No
  /// data loss — toggling back restores the same bullets.
  static void setEnabled(bool enabled) {
    if (enabled) {
      if (_disabledFile.existsSync() && !_file.existsSync()) {
        _disabledFile.renameSync(_file.path);
      }
    } else {
      if (_file.existsSync()) {
        if (_disabledFile.existsSync()) _disabledFile.deleteSync();
        _file.renameSync(_disabledFile.path);
      }
    }
  }
}
