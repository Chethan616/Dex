// DexLog — one in-app log buffer so errors are visible inside the app,
// not just on a console nobody sees.
//
// Everything that can fail quietly (gateway connect, RPC calls, the
// gateway spawn, tool errors/aborts, uncaught Flutter/zone errors)
// routes here. The Diagnostics panel (Settings → Diagnostics) renders
// `entries` live and lets the user copy the whole buffer when something
// breaks. Cheap ring buffer, no persistence — it's a live window, not a
// log file (the gateway keeps its own under %TEMP%\openclaw).

import 'package:flutter/foundation.dart';

enum DexLogLevel { info, warn, error }

@immutable
class DexLogEntry {
  const DexLogEntry({
    required this.at,
    required this.level,
    required this.tag,
    required this.message,
  });

  final DateTime at;
  final DexLogLevel level;
  final String tag;
  final String message;

  String get levelLabel => switch (level) {
        DexLogLevel.info => 'INFO',
        DexLogLevel.warn => 'WARN',
        DexLogLevel.error => 'ERR ',
      };

  String get timeLabel {
    String two(int n) => n.toString().padLeft(2, '0');
    String three(int n) => n.toString().padLeft(3, '0');
    return '${two(at.hour)}:${two(at.minute)}:${two(at.second)}.${three(at.millisecond)}';
  }

  @override
  String toString() => '$timeLabel  $levelLabel  [$tag] $message';
}

class DexLog {
  DexLog._();

  static const int _cap = 500;

  /// The live buffer. Diagnostics panel listens; newest is last.
  static final ValueNotifier<List<DexLogEntry>> entries =
      ValueNotifier<List<DexLogEntry>>(<DexLogEntry>[]);

  /// Count of error-level entries since last clear — drives a red dot on
  /// the Diagnostics affordance so the user notices without opening it.
  static final ValueNotifier<int> errorCount = ValueNotifier<int>(0);

  /// True while `_add` is running, so a listener that logs cannot recurse.
  ///
  /// `entries.value = ...` notifies listeners synchronously, and a listener is
  /// a widget rebuild. If that rebuild throws, `FlutterError.onError` lands
  /// back here — inside the notification it caused — and the second entry
  /// notifies again from inside the first. One framework assertion became an
  /// unbounded loop that filled the buffer, flooded the console and ended in
  /// "Lost connection to device": the app did not crash from the bug, it
  /// crashed from reporting it.
  static bool _emitting = false;

  /// The last message, and how many times running it has arrived.
  ///
  /// Flutter's mouse-tracker assertion is the case that matters: once it trips,
  /// its guard flag is never reset, so it fires again on every single frame —
  /// sixty identical lines a second for as long as the app lives. Collapsing
  /// them keeps the one fact ("this is happening, constantly") and drops the
  /// ten thousand copies of it, which is what made Diagnostics unreadable and
  /// the console unusable at exactly the moment both were needed.
  static String _lastKey = '';
  static int _repeats = 0;

  static void _add(DexLogLevel level, String tag, String message) {
    if (_emitting) return;
    _emitting = true;
    try {
      final key = '$level|$tag|$message';
      final current = entries.value;

      if (key == _lastKey && current.isNotEmpty) {
        _repeats += 1;
        // Rewrite the last entry in place rather than appending. No new
        // notification storm, and the count is more useful than the copies.
        final collapsed = List<DexLogEntry>.of(current);
        collapsed[collapsed.length - 1] = DexLogEntry(
          at: DateTime.now(),
          level: level,
          tag: tag,
          message: '$message  (×${_repeats + 1})',
        );
        entries.value = collapsed;
        // Every 100th, so a wedged app still shows movement in the console
        // without printing sixty lines a second.
        if (_repeats % 100 == 0) {
          debugPrint('[dex] $tag: still repeating (×${_repeats + 1}) — $message');
        }
        return;
      }

      _lastKey = key;
      _repeats = 0;

      final entry = DexLogEntry(
        at: DateTime.now(),
        level: level,
        tag: tag,
        message: message,
      );
      // Mirror to the debug console too, so `flutter run` still shows it.
      debugPrint('[dex] ${entry.toString()}');
      final next = List<DexLogEntry>.of(current)..add(entry);
      if (next.length > _cap) {
        next.removeRange(0, next.length - _cap);
      }
      entries.value = next;
      if (level == DexLogLevel.error) {
        errorCount.value = errorCount.value + 1;
      }
    } finally {
      _emitting = false;
    }
  }

  static void i(String tag, String message) =>
      _add(DexLogLevel.info, tag, message);
  static void w(String tag, String message) =>
      _add(DexLogLevel.warn, tag, message);
  static void e(String tag, String message) =>
      _add(DexLogLevel.error, tag, message);

  static void clear() {
    entries.value = <DexLogEntry>[];
    errorCount.value = 0;
    _lastKey = '';
    _repeats = 0;
  }

  /// Whole buffer as plain text — the Diagnostics "Copy" action.
  static String dump() => entries.value.map((e) => e.toString()).join('\n');

  /// Capture uncaught framework + zone errors so crashes are visible
  /// in-app, not just in a console. Call once from main().
  static void installGlobalHandlers() {
    final prevOnError = FlutterError.onError;
    FlutterError.onError = (FlutterErrorDetails details) {
      e('flutter', details.exceptionAsString());
      prevOnError?.call(details);
    };
    PlatformDispatcher.instance.onError = (error, stack) {
      e('zone', '$error');
      return false; // let the platform keep its default handling too
    };
  }
}
