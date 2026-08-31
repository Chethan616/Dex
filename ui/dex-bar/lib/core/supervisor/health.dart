import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'dex_paths.dart';

/// Is it actually up?
///
/// Every readiness check here asks the thing itself. None of them sleep.
/// Startup ordering used to be a chain of fixed delays, which is wrong twice
/// over: too short and the next step talks to something that is not listening,
/// too long and a cold start takes six seconds of theatre. A probe is right in
/// both directions and is also the honest answer for the splash screen — the
/// row goes green when the service replies, not when a timer expires.
class Probe {
  const Probe._();

  /// A FastAPI agent's `/health`.
  ///
  /// Any HTTP answer at all counts as alive. A 500 from `/health` still proves
  /// a server is listening on that port, which is the question being asked;
  /// whether it is *happy* is what the body says, and the caller decides.
  static Future<HealthReport> http(
    int port, {
    Duration timeout = const Duration(seconds: 2),
    String path = '/health',
  }) async {
    final client = HttpClient()..connectionTimeout = timeout;
    try {
      final request = await client
          .getUrl(Uri.parse('http://127.0.0.1:$port$path'))
          .timeout(timeout);
      final response = await request.close().timeout(timeout);
      final body = await response
          .transform(utf8.decoder)
          .join()
          .timeout(timeout)
          .catchError((_) => '');

      Map<String, dynamic>? detail;
      try {
        final decoded = jsonDecode(body);
        if (decoded is Map<String, dynamic>) detail = decoded;
      } catch (_) {
        // Not JSON. Still alive.
      }
      return HealthReport.up(detail: detail);
    } on SocketException {
      return HealthReport.down('nothing is listening on port $port');
    } on TimeoutException {
      return HealthReport.down('port $port did not answer in time');
    } catch (e) {
      return HealthReport.down('$e');
    } finally {
      client.close(force: true);
    }
  }

  /// The privileged daemon, by looking for its named pipe.
  ///
  /// Deliberately does not connect. The daemon serves a fixed number of pipe
  /// instances and connecting to check would consume one; worse, a health probe
  /// that opens a connection can block if the daemon is mid-handler. Windows
  /// exposes the pipe namespace as a directory, so the pipe's existence can be
  /// read without touching it.
  ///
  /// This is also the only supervision the daemon gets. It runs elevated under
  /// a scheduled task, in a different integrity level, so we never hold a
  /// handle to it and could not see its exit code if we tried.
  static Future<HealthReport> namedPipe(String pipeName) async {
    // Accepts either the bare name or the full \\.\pipe\name form.
    final leaf = pipeName.split(r'\').where((p) => p.isNotEmpty).last;
    try {
      final entries = Directory(r'\\.\pipe\').listSync();
      for (final entry in entries) {
        if (entry.path.split(r'\').last.toLowerCase() == leaf.toLowerCase()) {
          return HealthReport.up();
        }
      }
      return HealthReport.down('the daemon is not serving \\\\.\\pipe\\$leaf');
    } catch (e) {
      return HealthReport.down('could not read the pipe namespace: $e');
    }
  }

  /// The core: its handshake file, then its socket.
  ///
  /// Both halves matter. The file alone is not proof — it is left on disk when
  /// the core is killed, so a stale one from a previous session would report a
  /// core that is not there. The socket alone is not enough either, because the
  /// port and token come from the file. Reuses exactly the file the
  /// GatewayClient reads, so there is one definition of "the core is up".
  static Future<HealthReport> core({
    Duration timeout = const Duration(seconds: 2),
  }) async {
    final file = DexPaths.handshakeFile;
    if (!file.existsSync()) {
      return HealthReport.down('the core has not written its handshake file');
    }

    Map<String, dynamic> handshake;
    try {
      handshake = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    } catch (e) {
      return HealthReport.down('the handshake file is unreadable: $e');
    }

    final port = handshake['port'] as int? ?? 8770;
    try {
      final socket = await Socket.connect('127.0.0.1', port, timeout: timeout);
      socket.destroy();
      return HealthReport.up(detail: {'port': port});
    } on SocketException {
      return HealthReport.down('the core is not listening on port $port');
    } on TimeoutException {
      return HealthReport.down('the core did not accept a connection');
    }
  }

  /// Poll [check] until it reports up, or [timeout] passes.
  ///
  /// The interval is short and fixed rather than backing off: these are local
  /// processes starting, and the whole budget is a handful of seconds. Backoff
  /// would only make a fast start look slow.
  static Future<HealthReport> waitUntilUp(
    Future<HealthReport> Function() check, {
    required Duration timeout,
    Duration interval = const Duration(milliseconds: 200),
    bool Function()? abandonIf,
  }) async {
    final deadline = DateTime.now().add(timeout);
    HealthReport last = HealthReport.down('not checked yet');

    while (DateTime.now().isBefore(deadline)) {
      if (abandonIf != null && abandonIf()) return last;
      last = await check();
      if (last.up) return last;
      await Future<void>.delayed(interval);
    }
    return last;
  }
}

/// What a probe found.
class HealthReport {
  const HealthReport._(this.up, this.reason, this.detail);

  factory HealthReport.up({Map<String, dynamic>? detail}) =>
      HealthReport._(true, null, detail);

  factory HealthReport.down(String reason) =>
      HealthReport._(false, reason, null);

  final bool up;

  /// Why it is down, phrased so it can be shown to the owner as-is.
  final String? reason;

  /// Whatever the service said about itself — model names, ports, whether it
  /// has an API key. Surfaced in Settings on the Agents page.
  final Map<String, dynamic>? detail;

  @override
  String toString() => up ? 'up' : 'down: $reason';
}
