// GatewayManager — when the app runs, the gateway runs.
//
// On launch the app probes the gateway port; when nothing is
// listening it locates the dexagent CLI launcher and spawns
// `node <dexagent>/dex.mjs gateway run --port <port>` DETACHED (no
// console window -- the user never sees a terminal).
//
// IMPORTANT: the launcher is dex.mjs (the package `bin`), NOT
// dist/index.js (that's the library `main` and does not start the
// CLI). The gateway needs the `run` subcommand to run in the
// foreground of the spawned process.
//
// Resolution order for the launcher:
//   1. Bundled runtime next to the exe (the WiX installer layout):
//        <exeDir>\runtime\dexagent\dex.mjs   (+ runtime\node\node.exe)
//   2. Global npm install (dev machines):
//        %APPDATA%\npm\node_modules\dexagent\dex.mjs
//        + node.exe from %ProgramFiles%\nodejs or PATH
//
// The spawned gateway outlives the app on purpose (channels keep
// listening; the tray quit doesn't kill WhatsApp). Failures route to
// DexLog so the in-app Diagnostics panel can show them.

import 'dart:async';
import 'dart:io';

import 'log.dart';

class GatewayManager {
  GatewayManager._();

  /// True when this app process spawned the gateway (vs found one).
  static bool spawnedByApp = false;

  static Future<bool> _portOpen(int port,
      {Duration timeout = const Duration(milliseconds: 800)}) async {
    try {
      final socket =
          await Socket.connect('127.0.0.1', port, timeout: timeout);
      socket.destroy();
      return true;
    } catch (_) {
      return false;
    }
  }

  static String _findNode() {
    final exeDir = File(Platform.resolvedExecutable).parent.path;
    final candidates = <String>[
      '$exeDir\\runtime\\node\\node.exe',
      '${Platform.environment['ProgramFiles'] ?? r'C:\Program Files'}\\nodejs\\node.exe',
    ];
    for (final c in candidates) {
      if (File(c).existsSync()) return c;
    }
    // PATH fallback -- Process.start resolves it.
    return 'node';
  }

  /// Locate the dexagent CLI launcher (dex.mjs), bundled or global.
  static String? _findGatewayEntry() {
    final exeDir = File(Platform.resolvedExecutable).parent.path;
    final appData = Platform.environment['APPDATA'] ?? '';
    final candidates = <String>[
      '$exeDir\\runtime\\dexagent\\dex.mjs',
      '$appData\\npm\\node_modules\\dexagent\\dex.mjs',
    ];
    for (final c in candidates) {
      if (File(c).existsSync()) return c;
    }
    return null;
  }

  /// Kill whatever is listening on [port] (Windows: netstat → taskkill).
  /// Used by restart() so a stale gateway (spawned by us, the Startup
  /// launcher, or a terminal) is replaced cleanly.
  static Future<void> _killPort(int port) async {
    try {
      final res = await Process.run('netstat', ['-ano']);
      final pids = <String>{};
      for (final line in (res.stdout as String).split('\n')) {
        if (!line.contains(':$port')) continue;
        if (!line.toUpperCase().contains('LISTENING')) continue;
        final pid = line.trim().split(RegExp(r'\s+')).last;
        if (pid != '0' && int.tryParse(pid) != null) pids.add(pid);
      }
      for (final pid in pids) {
        await Process.run('taskkill', <String>['/PID', pid, '/F', '/T']);
        DexLog.i('gateway', 'killed pid $pid on :$port');
      }
    } catch (e) {
      DexLog.w('gateway', 'killPort failed: $e');
    }
  }

  /// Stop the current gateway and start a fresh one. The in-app
  /// "Restart gateway" action so picking up a new build (or recovering a
  /// wedged gateway) never needs a terminal.
  static Future<bool> restart({int port = 18789}) async {
    DexLog.i('gateway', 'restart requested');
    await _killPort(port);
    final deadline = DateTime.now().add(const Duration(seconds: 10));
    while (DateTime.now().isBefore(deadline)) {
      if (!await _portOpen(port)) break;
      await Future<void>.delayed(const Duration(milliseconds: 400));
    }
    spawnedByApp = false;
    return ensureRunning(port: port);
  }

  /// Probe; spawn when down; wait until the port accepts (or give up).
  /// Returns true when a gateway is reachable afterwards.
  static Future<bool> ensureRunning({int port = 18789}) async {
    if (await _portOpen(port)) {
      DexLog.i('gateway', 'already running on :$port');
      return true;
    }

    final entry = _findGatewayEntry();
    if (entry == null) {
      DexLog.e('gateway',
          'dexagent launcher (dex.mjs) not found — install dexagent globally or run the MSI');
      return false;
    }
    final node = _findNode();
    try {
      // Detached: no console window, survives app exit. The gateway
      // writes its own log under %TEMP%\openclaw. `run` = foreground
      // gateway inside the spawned process.
      await Process.start(
        node,
        <String>[entry, 'gateway', 'run', '--port', '$port'],
        mode: ProcessStartMode.detached,
        workingDirectory: File(entry).parent.path,
      );
      spawnedByApp = true;
      DexLog.i('gateway', 'spawned: node $entry gateway run --port $port');
    } catch (e) {
      DexLog.e('gateway', 'spawn failed: $e');
      return false;
    }

    // Gateway start takes ~8-15s on this stack (HTTP server + plugins).
    final deadline = DateTime.now().add(const Duration(seconds: 45));
    while (DateTime.now().isBefore(deadline)) {
      if (await _portOpen(port)) {
        DexLog.i('gateway', 'ready on :$port');
        return true;
      }
      await Future<void>.delayed(const Duration(seconds: 1));
    }
    DexLog.e('gateway', 'did not open port $port within 45s');
    return false;
  }
}
