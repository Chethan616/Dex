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

  static void _add(DexLogLevel level, String tag, String message) {
    final entry = DexLogEntry(
      at: DateTime.now(),
      level: level,
      tag: tag,
      message: message,
    );
    // Mirror to the debug console too, so `flutter run` still shows it.
    debugPrint('[dex] ${entry.toString()}');
    final next = List<DexLogEntry>.of(entries.value)..add(entry);
    if (next.length > _cap) {
      next.removeRange(0, next.length - _cap);
    }
    entries.value = next;
    if (level == DexLogLevel.error) {
      errorCount.value = errorCount.value + 1;
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
