// One line from a Dex log, parsed.
//
// The core hands back the tail of a log file as text. Parsing it here rather
// than rendering the blob is what makes the screen useful: you can filter to
// errors, narrow to the last five minutes, and search — none of which is
// possible against a wall of monospace.
//
// Every Dex process writes the same shape, on purpose:
//
//   2026-09-01 23:10:47,035 [INFO] core - [brain] claude-code/haiku
//   └── timestamp ───────┘ └level┘ └src┘   └── message ───────────┘
//
// The Python side (daemon, agents) uses logging's default format and the
// TypeScript side reproduces it in core/logging/file_log.ts, so one parser
// covers all five.

enum LogLevel { debug, info, warn, error }

extension LogLevelX on LogLevel {
  String get label => switch (this) {
        LogLevel.debug => 'DEBUG',
        LogLevel.info => 'INFO',
        LogLevel.warn => 'WARN',
        LogLevel.error => 'ERROR',
      };

  /// Ordering for "this level and worse".
  int get severity => switch (this) {
        LogLevel.debug => 0,
        LogLevel.info => 1,
        LogLevel.warn => 2,
        LogLevel.error => 3,
      };
}

class LogEntry {
  const LogEntry({
    required this.at,
    required this.level,
    required this.source,
    required this.message,
    required this.raw,
  });

  /// Null when the line carried no parseable timestamp — a stack trace
  /// continuation, or a stray print. Those are kept rather than dropped:
  /// a traceback is usually the most useful thing in the file.
  final DateTime? at;

  final LogLevel level;

  /// Which process wrote it: `core`, `daemon`, `browser`, `app`, `desktop`.
  final String source;

  final String message;

  /// The original line, for copying out verbatim.
  final String raw;

  bool get isContinuation => at == null;

  static final _line = RegExp(
    r'^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})[,.](\d{1,3})\s+'
    r'\[(\w+)\]\s+'
    r'([\w.-]+)\s+-\s+'
    r'(.*)$',
  );

  /// Parse a log file's text into entries, oldest first.
  ///
  /// A line that does not match keeps the level and timestamp of the line
  /// above it. That is what holds a Python traceback together — its
  /// continuation lines carry no prefix at all, and treating each as its own
  /// unknown entry scatters the one thing you opened the log to read.
  static List<LogEntry> parse(String text, {required String fallbackSource}) {
    final entries = <LogEntry>[];

    for (final rawLine in text.split('\n')) {
      final line = rawLine.trimRight();
      if (line.isEmpty) continue;

      final match = _line.firstMatch(line);
      if (match == null) {
        final previous = entries.isEmpty ? null : entries.last;
        entries.add(LogEntry(
          at: null,
          level: previous?.level ?? LogLevel.info,
          source: previous?.source ?? fallbackSource,
          message: line,
          raw: rawLine,
        ));
        continue;
      }

      entries.add(LogEntry(
        at: DateTime.tryParse(
          '${match.group(1)!.replaceFirst(' ', 'T')}.${match.group(2)!.padLeft(3, '0')}',
        ),
        level: _levelFrom(match.group(3)!),
        source: match.group(4)!,
        message: match.group(5)!,
        raw: rawLine,
      ));
    }

    return entries;
  }

  static LogLevel _levelFrom(String word) => switch (word.toUpperCase()) {
        'ERROR' || 'CRITICAL' || 'FATAL' => LogLevel.error,
        'WARN' || 'WARNING' => LogLevel.warn,
        'DEBUG' || 'TRACE' => LogLevel.debug,
        _ => LogLevel.info,
      };
}

/// How far back to show.
enum LogWindow { fiveMinutes, hour, today, everything }

extension LogWindowX on LogWindow {
  String get label => switch (this) {
        LogWindow.fiveMinutes => 'Last 5 min',
        LogWindow.hour => 'Last hour',
        LogWindow.today => 'Today',
        LogWindow.everything => 'All',
      };

  /// The earliest timestamp still included, or null for everything.
  DateTime? since(DateTime now) => switch (this) {
        LogWindow.fiveMinutes => now.subtract(const Duration(minutes: 5)),
        LogWindow.hour => now.subtract(const Duration(hours: 1)),
        LogWindow.today => DateTime(now.year, now.month, now.day),
        LogWindow.everything => null,
      };
}

/// Apply the filters the screen offers.
///
/// A continuation line follows whatever its parent did. Filtering it
/// independently would show a traceback whose first line had been filtered
/// out, which is worse than showing neither.
List<LogEntry> filterLogs(
  List<LogEntry> entries, {
  required LogLevel minLevel,
  required LogWindow window,
  String query = '',
  DateTime? now,
}) {
  final cutoff = window.since(now ?? DateTime.now());
  final needle = query.trim().toLowerCase();

  final out = <LogEntry>[];
  var parentKept = false;

  for (final entry in entries) {
    if (entry.isContinuation) {
      if (parentKept) out.add(entry);
      continue;
    }

    final keep = entry.level.severity >= minLevel.severity &&
        (cutoff == null || entry.at == null || !entry.at!.isBefore(cutoff)) &&
        (needle.isEmpty || entry.raw.toLowerCase().contains(needle));

    parentKept = keep;
    if (keep) out.add(entry);
  }

  return out;
}
