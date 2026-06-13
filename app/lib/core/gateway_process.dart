// GatewayManager — Dex.exe owns its own brain.
//
// On launch the app probes the gateway port; when nothing is
// listening it locates the dexagent runtime and spawns
// `node <dist>/index.js gateway --port <port>` itself, DETACHED (no
// console window -- the user never sees a terminal). Resolution order:
//
//   1. Bundled runtime next to the exe (the WiX installer layout):
//        <exeDir>\runtime\node\node.exe
//        <exeDir>\runtime\dexagent\dist\index.js
//   2. Global npm install (dev machines):
//        %APPDATA%\npm\node_modules\dexagent\dist\index.js
//        + node.exe from %ProgramFiles%\nodejs or PATH
//
// The spawned gateway outlives the app on purpose (channels keep
// listening; the tray quit doesn't kill WhatsApp). Spawn failures are
// non-fatal -- the connection banner explains, exactly as before.

import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';

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

  static String? _findNode() {
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

  static String? _findGatewayEntry() {
    final exeDir = File(Platform.resolvedExecutable).parent.path;
    final appData = Platform.environment['APPDATA'] ?? '';
    final candidates = <String>[
      '$exeDir\\runtime\\dexagent\\dist\\index.js',
      '$appData\\npm\\node_modules\\dexagent\\dist\\index.js',
    ];
    for (final c in candidates) {
      if (File(c).existsSync()) return c;
    }
    return null;
  }

  /// Probe; spawn when down; wait until the port accepts (or give up).
  /// Returns true when a gateway is reachable afterwards.
  static Future<bool> ensureRunning({int port = 18789}) async {
    if (await _portOpen(port)) return true;

    final entry = _findGatewayEntry();
    if (entry == null) {
      debugPrint('[dex] gateway runtime not found (bundled or npm); '
          'install dexagent or run the installer.');
      return false;
    }
    final node = _findNode();
    try {
      // Detached: no console window, survives app exit. The gateway
      // writes its own log under %TEMP%.
      await Process.start(
        node!,
        <String>[entry, 'gateway', '--port', '$port'],
        mode: ProcessStartMode.detached,
        workingDirectory: File(entry).parent.parent.path,
      );
      spawnedByApp = true;
      debugPrint('[dex] gateway spawned: $node $entry');
    } catch (e) {
      debugPrint('[dex] gateway spawn failed: $e');
      return false;
    }

    // Gateway start takes ~8-15s on this stack (HTTP server + plugins).
    final deadline = DateTime.now().add(const Duration(seconds: 45));
    while (DateTime.now().isBefore(deadline)) {
      if (await _portOpen(port)) return true;
      await Future<void>.delayed(const Duration(seconds: 1));
    }
    debugPrint('[dex] gateway did not open port $port within 45s');
    return false;
  }
}
