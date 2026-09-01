// Diagnostics: what the five Dex processes are actually saying.
//
// This used to render `DexLog.entries` — the *app's own* in-memory log, which
// holds a handful of lines about the WebSocket and nothing else. Everything
// that matters when something goes wrong is written by the other four
// processes to %LOCALAPPDATA%\DEX\*.log, and none of it was reachable from
// here. The screen was not broken so much as pointed at the wrong thing.
//
// It now reads the real logs through the core, which already tails them safely
// and validates the name. And because they are parsed rather than dumped, they
// can be filtered: by process, by level, by time, and by text. A wall of
// monospace is not a diagnostic tool; a wall of monospace you can narrow to
// "errors, last five minutes, from the daemon" is.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/dex_gateway.dart';
import '../../../core/log.dart';
import '../../../core/models/log_entry.dart';
import '../../../theme/tokens.dart';

/// The processes Dex runs, and what each one is responsible for.
const _sources = <(String, String, String)>[
  ('core', 'Core', 'Planning, verification, memory'),
  ('daemon', 'Daemon', 'Everything privileged'),
  ('browser', 'Browser', 'The web'),
  ('app', 'App agent', 'UI Automation'),
  ('desktop', 'Vision', 'Screen reading'),
];

class DiagnosticsTab extends StatefulWidget {
  const DiagnosticsTab({super.key});

  @override
  State<DiagnosticsTab> createState() => _DiagnosticsTabState();
}

class _DiagnosticsTabState extends State<DiagnosticsTab> {
  String _source = 'core';
  LogLevel _minLevel = LogLevel.info;
  LogWindow _window = LogWindow.hour;
  String _query = '';

  final _search = TextEditingController();
  final _scroll = ScrollController();
  Timer? _poll;

  DexGatewayClient? get _client => DexGatewayClient.current;

  @override
  void initState() {
    super.initState();
    _client?.addListener(_onChange);
    _refresh();
    // Polled rather than pushed: a file tail does not justify a second channel,
    // and two seconds is well inside the time it takes to read a screen.
    _poll = Timer.periodic(const Duration(seconds: 2), (_) => _refresh());
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  void _refresh() => _client?.refreshLog(_source);

  @override
  void dispose() {
    _poll?.cancel();
    _client?.removeListener(_onChange);
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _select(String source) {
    setState(() => _source = source);
    _refresh();
  }

  List<LogEntry> get _entries {
    final text = _client?.logs[_source];
    if (text == null) return const [];
    return filterLogs(
      LogEntry.parse(text, fallbackSource: _source),
      minLevel: _minLevel,
      window: _window,
      query: _query,
    );
  }

  @override
  Widget build(BuildContext context) {
    final client = _client;
    final loaded = client?.logs.containsKey(_source) ?? false;
    final entries = _entries;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Logs',
                style: TextStyle(
                  color: DexColors.text,
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                r'Live from %LOCALAPPDATA%\DEX. With no console anywhere, these '
                'files are the only output Dex produces — so this is where a '
                'failure explains itself.',
                style: TextStyle(color: DexColors.textDim, fontSize: 12, height: 1.5),
              ),
              const SizedBox(height: 14),
              _SourceTabs(current: _source, onSelect: _select),
              const SizedBox(height: 12),
              _Filters(
                minLevel: _minLevel,
                window: _window,
                search: _search,
                onLevel: (l) => setState(() => _minLevel = l),
                onWindow: (w) => setState(() => _window = w),
                onQuery: (q) => setState(() => _query = q),
              ),
              const SizedBox(height: 10),
              _Toolbar(
                shown: entries.length,
                source: _source,
                onCopy: () => Clipboard.setData(
                  ClipboardData(text: entries.map((e) => e.raw).join('\n')),
                ),
                onRefresh: _refresh,
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 0, 24, 20),
            child: Container(
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.25),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: DexColors.border),
              ),
              clipBehavior: Clip.antiAlias,
              child: client == null
                  ? const _Empty('The Dex core is not connected.')
                  : !loaded
                      ? const _Empty('Reading…')
                      : entries.isEmpty
                          ? _Empty(_emptyReason())
                          : Scrollbar(
                              controller: _scroll,
                              child: ListView.builder(
                                controller: _scroll,
                                padding: const EdgeInsets.symmetric(vertical: 8),
                                itemCount: entries.length,
                                itemBuilder: (context, i) => _Line(entry: entries[i]),
                              ),
                            ),
            ),
          ),
        ),
      ],
    );
  }

  /// Why there is nothing to show, specifically.
  ///
  /// "No entries" is unhelpful when the cause is a filter the owner set thirty
  /// seconds ago and has forgotten. Naming the filter is the difference
  /// between a dead end and an obvious next click.
  String _emptyReason() {
    final raw = _client?.logs[_source] ?? '';
    if (raw.trim().isEmpty) {
      return 'Nothing in this log yet — that process may not have started.';
    }
    if (_query.isNotEmpty) return 'Nothing matches “$_query”.';
    if (_minLevel != LogLevel.debug) {
      return 'Nothing at ${_minLevel.label} or worse in this window. '
          'Try a wider time range or a lower level.';
    }
    return 'Nothing in the selected time window.';
  }
}

class _SourceTabs extends StatelessWidget {
  const _SourceTabs({required this.current, required this.onSelect});

  final String current;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) => Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (final (id, label, blurb) in _sources)
            Tooltip(
              message: blurb,
              child: _Chip(
                label: label,
                selected: id == current,
                onTap: () => onSelect(id),
              ),
            ),
        ],
      );
}

class _Filters extends StatelessWidget {
  const _Filters({
    required this.minLevel,
    required this.window,
    required this.search,
    required this.onLevel,
    required this.onWindow,
    required this.onQuery,
  });

  final LogLevel minLevel;
  final LogWindow window;
  final TextEditingController search;
  final ValueChanged<LogLevel> onLevel;
  final ValueChanged<LogWindow> onWindow;
  final ValueChanged<String> onQuery;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const _FilterLabel('LEVEL'),
            const SizedBox(width: 8),
            for (final level in LogLevel.values) ...[
              _Chip(
                label: level.label,
                selected: level == minLevel,
                tone: _levelColor(level),
                onTap: () => onLevel(level),
              ),
              const SizedBox(width: 6),
            ],
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            const _FilterLabel('WHEN'),
            const SizedBox(width: 8),
            for (final w in LogWindow.values) ...[
              _Chip(
                label: w.label,
                selected: w == window,
                onTap: () => onWindow(w),
              ),
              const SizedBox(width: 6),
            ],
          ],
        ),
        const SizedBox(height: 10),
        SizedBox(
          height: 32,
          child: TextField(
            controller: search,
            onChanged: onQuery,
            style: const TextStyle(
              color: DexColors.text,
              fontSize: 12,
              fontFamily: 'monospace',
            ),
            decoration: InputDecoration(
              isDense: true,
              hintText: 'Search these lines…',
              hintStyle: const TextStyle(color: DexColors.textFaint, fontSize: 12),
              prefixIcon: const Icon(Icons.search_rounded,
                  size: 15, color: DexColors.textFaint),
              prefixIconConstraints:
                  const BoxConstraints(minWidth: 30, minHeight: 30),
              filled: true,
              fillColor: DexColors.surface2.withValues(alpha: 0.4),
              contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: const BorderSide(color: DexColors.border),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: const BorderSide(color: DexColors.border),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: const BorderSide(color: DexColors.accent),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _Toolbar extends StatelessWidget {
  const _Toolbar({
    required this.shown,
    required this.source,
    required this.onCopy,
    required this.onRefresh,
  });

  final int shown;
  final String source;
  final VoidCallback onCopy;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) => Row(
        children: [
          Text(
            '$shown line${shown == 1 ? '' : 's'}',
            style: const TextStyle(color: DexColors.textFaint, fontSize: 11),
          ),
          const SizedBox(width: 10),
          Text(
            '%LOCALAPPDATA%\\DEX\\$source.log',
            style: const TextStyle(
              color: DexColors.textFaint,
              fontSize: 10.5,
              fontFamily: 'monospace',
            ),
          ),
          const Spacer(),
          _Chip(label: 'Copy', onTap: onCopy),
          const SizedBox(width: 6),
          _Chip(label: 'Refresh', onTap: onRefresh),
          const SizedBox(width: 6),
          // The app's own log is small and separate. Kept reachable because it
          // is the one that explains a failure to connect at all, when the
          // core's log cannot be fetched by definition.
          _Chip(
            label: 'App log',
            onTap: () => Clipboard.setData(ClipboardData(text: DexLog.dump())),
          ),
        ],
      );
}

class _Line extends StatelessWidget {
  const _Line({required this.entry});

  final LogEntry entry;

  @override
  Widget build(BuildContext context) {
    final tone = _levelColor(entry.level);

    // A traceback continuation is indented under its parent rather than given
    // its own timestamp column, so the shape of the stack survives.
    if (entry.isContinuation) {
      return Padding(
        padding: const EdgeInsets.only(left: 96, right: 12, bottom: 1),
        child: SelectableText(
          entry.message,
          style: TextStyle(
            color: tone.withValues(alpha: 0.75),
            fontSize: 11,
            height: 1.45,
            fontFamily: 'monospace',
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 1.5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 74,
            child: Text(
              _clock(entry.at),
              style: const TextStyle(
                color: DexColors.textFaint,
                fontSize: 10.5,
                fontFamily: 'monospace',
              ),
            ),
          ),
          SizedBox(
            width: 48,
            child: Text(
              entry.level.label,
              style: TextStyle(
                color: tone,
                fontSize: 10,
                fontWeight: FontWeight.w700,
                fontFamily: 'monospace',
              ),
            ),
          ),
          Expanded(
            child: SelectableText(
              entry.message,
              style: TextStyle(
                color: entry.level == LogLevel.error
                    ? DexColors.stateError
                    : DexColors.text,
                fontSize: 11,
                height: 1.45,
                fontFamily: 'monospace',
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Time of day, with the date only when it is not today — a log you are
  /// watching live does not need "2026-09-01" on every line.
  static String _clock(DateTime? at) {
    if (at == null) return '';
    final now = DateTime.now();
    final sameDay =
        at.year == now.year && at.month == now.month && at.day == now.day;
    final hh = at.hour.toString().padLeft(2, '0');
    final mm = at.minute.toString().padLeft(2, '0');
    final ss = at.second.toString().padLeft(2, '0');
    if (sameDay) return '$hh:$mm:$ss';
    return '${at.month.toString().padLeft(2, '0')}-'
        '${at.day.toString().padLeft(2, '0')} $hh:$mm';
  }
}

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.onTap,
    this.selected = false,
    this.tone,
  });

  final String label;
  final VoidCallback onTap;
  final bool selected;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final colour = tone ?? DexColors.accent;
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 120),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: selected
              ? colour.withValues(alpha: 0.18)
              : DexColors.surface2.withValues(alpha: 0.4),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: selected ? colour.withValues(alpha: 0.6) : DexColors.border,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? colour : DexColors.textDim,
            fontSize: 11,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
          ),
        ),
      ),
    );
  }
}

class _FilterLabel extends StatelessWidget {
  const _FilterLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => SizedBox(
        width: 44,
        child: Text(
          text,
          style: const TextStyle(
            color: DexColors.textFaint,
            fontSize: 9.5,
            letterSpacing: 1.1,
            fontWeight: FontWeight.w600,
          ),
        ),
      );
}

class _Empty extends StatelessWidget {
  const _Empty(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            text,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: DexColors.textFaint,
              fontSize: 12,
              height: 1.5,
            ),
          ),
        ),
      );
}

Color _levelColor(LogLevel level) => switch (level) {
      LogLevel.debug => DexColors.textFaint,
      LogLevel.info => DexColors.textDim,
      LogLevel.warn => DexColors.stateAwaiting,
      LogLevel.error => DexColors.stateError,
    };
