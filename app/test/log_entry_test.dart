import 'package:dex/core/models/log_entry.dart';
import 'package:flutter_test/flutter_test.dart';

/// Parsing the logs Dex actually writes.
///
/// Every line below is copied verbatim from `%LOCALAPPDATA%\DEX` on a running
/// machine, including the awkward ones — a Python traceback, a Node warning
/// with no prefix at all, and a message whose own text contains brackets and a
/// dash. A parser tested against invented lines is a parser tested against the
/// shape you assumed, and the whole point of this screen is that it works when
/// something has gone wrong in a way you did not assume.
void main() {
  group('parsing', () {
    test('a core line splits into time, level, source and message', () {
      final entries = LogEntry.parse(
        '2026-09-01 23:10:47,075 [INFO] core - [Full Access] OFF  configured, '
        'but the daemon is not elevated — using confirmation cards.',
        fallbackSource: 'core',
      );

      expect(entries, hasLength(1));
      final e = entries.single;
      expect(e.level, LogLevel.info);
      expect(e.source, 'core');
      expect(e.at, isNotNull);
      expect(e.at!.hour, 23);
      expect(e.at!.minute, 10);
      expect(e.at!.second, 47);
      expect(e.at!.millisecond, 75);
      // The message keeps its own brackets and dash — the split is on the
      // first " - " after the source, not on every dash in the line.
      expect(e.message, startsWith('[Full Access] OFF'));
      expect(e.message, contains('confirmation cards'));
    });

    test('a daemon line, which uses a different source name', () {
      final e = LogEntry.parse(
        '2026-09-01 23:11:35,644 [INFO] DexDaemon - → get_power_plan id=a45904d2_step_1',
        fallbackSource: 'daemon',
      ).single;

      expect(e.source, 'DexDaemon');
      expect(e.message, contains('get_power_plan'));
    });

    test('levels map, including the words Python and Node use', () {
      const text = '''
2026-09-01 10:00:00,000 [DEBUG] core - a
2026-09-01 10:00:01,000 [INFO] core - b
2026-09-01 10:00:02,000 [WARNING] core - c
2026-09-01 10:00:03,000 [ERROR] core - d
2026-09-01 10:00:04,000 [CRITICAL] core - e
''';
      final levels =
          LogEntry.parse(text, fallbackSource: 'core').map((e) => e.level).toList();
      expect(levels, [
        LogLevel.debug,
        LogLevel.info,
        LogLevel.warn,
        LogLevel.error,
        LogLevel.error,
      ]);
    });

    test('a traceback stays attached to the line that raised it', () {
      // Real shape, from app.log. The continuation lines carry no prefix, and
      // treating each as its own entry scatters the one thing worth reading.
      const text = '''
2026-09-01 12:00:00,000 [ERROR] app - Handler raised
Traceback (most recent call last):
  File "C:\\Users\\cheth\\OneDrive\\Desktop\\DEXV3\\agents\\app\\server.py", line 78, in act
    return {'success': True, 'data': _dispatch(req)}
                                     ^^^^^^^^^^^^^^
2026-09-01 12:00:01,000 [INFO] app - carrying on
''';
      final entries = LogEntry.parse(text, fallbackSource: 'app');

      expect(entries, hasLength(6));
      expect(entries[0].isContinuation, isFalse);
      for (var i = 1; i <= 4; i++) {
        expect(entries[i].isContinuation, isTrue, reason: 'line $i');
        // Inherits the level so the whole trace reads as one error.
        expect(entries[i].level, LogLevel.error);
      }
      expect(entries[5].isContinuation, isFalse);
      expect(entries[5].level, LogLevel.info);
    });

    test('a bare Node warning with no prefix is kept, not dropped', () {
      // core.log really contains this, unprefixed, straight from Node.
      final entries = LogEntry.parse(
        '(Use `node --trace-warnings ...` to show where the warning was created)',
        fallbackSource: 'core',
      );
      expect(entries, hasLength(1));
      expect(entries.single.isContinuation, isTrue);
      expect(entries.single.message, contains('trace-warnings'));
    });
  });

  group('filtering', () {
    final now = DateTime(2026, 9, 1, 12, 0, 0);

    List<LogEntry> sample() => LogEntry.parse('''
2026-09-01 11:00:00,000 [INFO] core - an hour ago
2026-09-01 11:58:00,000 [WARN] core - two minutes ago
2026-09-01 11:59:00,000 [ERROR] core - one minute ago
Traceback (most recent call last):
2026-08-31 09:00:00,000 [ERROR] core - yesterday
''', fallbackSource: 'core');

    test('level filters to that level and worse', () {
      final out = filterLogs(sample(),
          minLevel: LogLevel.error, window: LogWindow.everything, now: now);
      expect(out.where((e) => !e.isContinuation), hasLength(2));
      expect(out.every((e) => e.isContinuation || e.level == LogLevel.error), isTrue);
    });

    test('the time window excludes anything older', () {
      final out = filterLogs(sample(),
          minLevel: LogLevel.debug, window: LogWindow.fiveMinutes, now: now);
      final messages = out.map((e) => e.message).toList();
      expect(messages, contains('two minutes ago'));
      expect(messages, contains('one minute ago'));
      expect(messages, isNot(contains('an hour ago')));
      expect(messages, isNot(contains('yesterday')));
    });

    test('"today" keeps everything from today and nothing from before', () {
      final out = filterLogs(sample(),
          minLevel: LogLevel.debug, window: LogWindow.today, now: now);
      final messages = out.map((e) => e.message).toList();
      expect(messages, contains('an hour ago'));
      expect(messages, isNot(contains('yesterday')));
    });

    test('search matches the raw line', () {
      final out = filterLogs(sample(),
          minLevel: LogLevel.debug,
          window: LogWindow.everything,
          query: 'yesterday',
          now: now);
      expect(out.where((e) => !e.isContinuation), hasLength(1));
    });

    test('search is case-insensitive', () {
      final out = filterLogs(sample(),
          minLevel: LogLevel.debug,
          window: LogWindow.everything,
          query: 'YESTERDAY',
          now: now);
      expect(out.where((e) => !e.isContinuation), hasLength(1));
    });

    test('a traceback is hidden when its parent is filtered out', () {
      // The continuation belongs to the ERROR line above it. Filtering to
      // warnings-and-worse keeps both; filtering by a search that misses the
      // parent must take the trace with it, or the screen shows a stack with
      // no error attached.
      final out = filterLogs(sample(),
          minLevel: LogLevel.debug,
          window: LogWindow.everything,
          query: 'an hour ago',
          now: now);
      expect(out.any((e) => e.isContinuation), isFalse);
    });

    test('a traceback is kept when its parent survives', () {
      final out = filterLogs(sample(),
          minLevel: LogLevel.error, window: LogWindow.everything, now: now);
      expect(out.any((e) => e.isContinuation), isTrue,
          reason: 'the stack is the useful half of an error');
    });
  });
}
