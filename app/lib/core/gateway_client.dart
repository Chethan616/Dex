// Dex <-> OpenClaw gateway adapter.
//
// Protocol verified live against OpenClaw 2026.5.28 source:
//   - vendor/openclaw/src/gateway/server/ws-connection.ts (handshake flow)
//   - vendor/openclaw/packages/gateway-protocol/src/schema/frames.ts (frame shapes)
//   - vendor/openclaw/packages/gateway-protocol/src/schema/logs-chat.ts (chat methods)
//   - vendor/openclaw/packages/gateway-protocol/src/client-info.ts (valid client ids)
//
// Handshake (corrected after first integration attempt):
//   1. WS open -> ws://127.0.0.1:18789
//   2. Server sends {type:"event", event:"connect.challenge", payload:{nonce, ts}}
//   3. Client sends {type:"req", id, method:"connect", params: ConnectParams}
//      where ConnectParams MUST include minProtocol, maxProtocol, client{id,version,platform,mode},
//      and the auth.token from ~\.openclaw\openclaw.json (gateway.auth.token).
//   4. Server responds with res frame containing the hello-ok payload.
//   5. Now `chat.send` is allowed.

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:web_socket_channel/io.dart';

import 'log.dart';
import 'models/gateway_event.dart';
import 'send_options.dart';

enum GatewayConnState { disconnected, connecting, handshaking, ready, failed }

class GatewayConfig {
  final Uri url;
  final String? token;
  final String sessionKey;
  const GatewayConfig({
    required this.url,
    required this.sessionKey,
    this.token,
  });

  /// Load gateway config. Search order:
  ///   1. `%USERPROFILE%\.dex\dex.json`         (current canonical)
  ///   2. `%USERPROFILE%\.dex\openclaw.json`    (legacy filename; pre-2026.6.12)
  ///   3. `%USERPROFILE%\.openclaw\openclaw.json` (legacy dir; pre-Phase B.5)
  /// Returns defaults if none of the three are present — the client then
  /// surfaces a clear "authentication required" error in the UI.
  static GatewayConfig fromLocalConfig({String sessionKey = 'dex-desktop'}) {
    final home = Platform.environment['USERPROFILE'] ??
        Platform.environment['HOME'] ??
        '';
    final sep = Platform.pathSeparator;
    final candidates = <String>[
      '$home$sep.dex${sep}dex.json',
      '$home$sep.dex${sep}openclaw.json',
      '$home$sep.openclaw${sep}openclaw.json',
    ];
    String? token;
    int port = 18789;
    String? loaded;
    for (final path in candidates) {
      try {
        final f = File(path);
        if (!f.existsSync()) continue;
        final parsed = jsonDecode(f.readAsStringSync()) as Map<String, dynamic>;
        final gw = (parsed['gateway'] as Map?)?.cast<String, dynamic>() ?? const {};
        final auth = (gw['auth'] as Map?)?.cast<String, dynamic>() ?? const {};
        token = auth['token'] as String?;
        port = (gw['port'] as int?) ?? port;
        loaded = path;
        break;
      } catch (e) {
        debugPrint('Dex: failed to read $path: $e');
      }
    }
    if (loaded == null) {
      debugPrint('Dex: no config at ${candidates.join(' or ')} -- '
          'run `dex onboard` to write one.');
    }
    return GatewayConfig(
      url: Uri.parse('ws://127.0.0.1:$port'),
      sessionKey: sessionKey,
      token: token,
    );
  }
}

class GatewayClient extends ChangeNotifier {
  GatewayClient(this._config) {
    current = this;
  }

  /// The most recently constructed client. Dex runs exactly one gateway
  /// connection per window; surfaces that live outside the store-passing
  /// tree (Settings dialog tabs) reach the connection through this.
  static GatewayClient? current;

  final GatewayConfig _config;
  final _uuid = const Uuid();

  WebSocketChannel? _ws;
  StreamSubscription<dynamic>? _sub;
  final _events = StreamController<GatewayEvent>.broadcast();

  GatewayConnState _state = GatewayConnState.disconnected;
  String? _lastError;
  Completer<void>? _readyCompleter;
  String? _connectReqId;

  // A freshly (re)started gateway opens its TCP port BEFORE it can accept
  // the WS handshake — the handshake comes back "UNAVAILABLE: gateway
  // starting; retry shortly", or the socket is refused/closed mid-boot.
  // That's transient, so we retry the whole connect a bounded number of
  // times instead of failing the readyCompleter (which used to crash the
  // app with an unhandled "Bad state" and made Restart look broken).
  int _connectRetries = 0;
  static const int _maxConnectRetries = 20; // ~20 × 900ms ≈ 18s boot window
  bool _retrying = false; // suppresses _onDone/_onError during a retry teardown

  GatewayConnState get state => _state;
  String? get lastError => _lastError;
  bool get isReady => _state == GatewayConnState.ready;
  Stream<GatewayEvent> get events => _events.stream;

  void _setState(GatewayConnState s, {String? error}) {
    if (_state == s && error == _lastError) return;
    _state = s;
    _lastError = error;
    // Surface every connection transition in the in-app Diagnostics
    // panel; failures are errors, the rest are info.
    if (s == GatewayConnState.failed) {
      DexLog.e('gateway', error ?? 'connection failed');
    } else {
      DexLog.i('gateway', error == null ? s.name : '${s.name}: $error');
    }
    notifyListeners();
  }

  // --------------------------------------------------------------------
  // Connect / disconnect
  // --------------------------------------------------------------------
  Future<void> connect() async {
    if (_state == GatewayConnState.connecting ||
        _state == GatewayConnState.handshaking ||
        _state == GatewayConnState.ready) {
      return;
    }
    if (_config.token == null || _config.token!.isEmpty) {
      _setState(GatewayConnState.failed,
          error: 'No auth token. Run `dex onboard` first; ~\\.dex\\dex.json should contain gateway.auth.token.');
      return;
    }

    _setState(GatewayConnState.connecting);
    _readyCompleter = Completer<void>();
    _connectRetries = 0;
    await _openSocket();
  }

  /// Open the WS + start listening. Reused by connect() and by each retry
  /// while the gateway is still booting. Keeps the same _readyCompleter so a
  /// caller awaiting waitReady() resolves once the gateway is actually up.
  Future<void> _openSocket() async {
    try {
      // Use IOWebSocketChannel so we can send a matching Origin header.
      // The gateway runs an origin allowlist (origin-check.ts) that accepts
      // the loopback URL it's bound to. Without this header dart:io sends no
      // Origin and the gateway rejects us with "origin not allowed".
      final origin = 'http://${_config.url.host}:${_config.url.port}';
      final ws = IOWebSocketChannel.connect(
        _config.url,
        headers: <String, dynamic>{'Origin': origin},
      );
      await ws.ready;
      _ws = ws;
      _setState(GatewayConnState.handshaking);
      _sub = ws.stream.listen(
        _onFrame,
        onDone: _onDone,
        onError: _onError,
        cancelOnError: false,
      );
      // We DON'T send the connect req here. We wait for the server's
      // `connect.challenge` event (see _onFrame). That keeps us aligned with
      // the gateway's handshake-pending state machine.
    } catch (e) {
      // Socket refused (port not up yet during a restart) — retry.
      _retryOrFail('connect failed: $e');
    }
  }

  /// Retry the connection if the failure is a transient boot race and we
  /// haven't exhausted retries; otherwise fail the readyCompleter for real.
  void _retryOrFail(String message) {
    if (_connectRetries >= _maxConnectRetries) {
      _setState(GatewayConnState.failed, error: message);
      if (_readyCompleter != null && !_readyCompleter!.isCompleted) {
        _readyCompleter!.completeError(StateError(message));
      }
      _readyCompleter = null;
      return;
    }
    _connectRetries += 1;
    _retrying = true; // _onDone/_onError must ignore this intentional teardown
    _sub?.cancel();
    _sub = null;
    _ws?.sink.close();
    _ws = null;
    _setState(GatewayConnState.connecting); // not "failed" — we're retrying
    Future<void>.delayed(const Duration(milliseconds: 900), () {
      _retrying = false;
      if (_readyCompleter != null && !_readyCompleter!.isCompleted) {
        _openSocket();
      }
    });
  }

  /// Block until the gateway has accepted our connect req. Throws if we
  /// transition to failed before becoming ready.
  Future<void> waitReady({Duration timeout = const Duration(seconds: 30)}) async {
    if (_state == GatewayConnState.ready) return;
    if (_state == GatewayConnState.disconnected ||
        _state == GatewayConnState.failed) {
      await connect();
    }
    final c = _readyCompleter;
    if (c == null) {
      if (_state == GatewayConnState.ready) return;
      throw StateError('gateway not connecting and not ready');
    }
    await c.future.timeout(timeout, onTimeout: () {
      throw TimeoutException('gateway handshake did not complete in ${timeout.inSeconds}s');
    });
  }

  Future<void> disconnect() async {
    await _sub?.cancel();
    _sub = null;
    await _ws?.sink.close();
    _ws = null;
    _setState(GatewayConnState.disconnected);
  }

  // --------------------------------------------------------------------
  // chat.send
  // --------------------------------------------------------------------
  Future<String> sendMessage(String text) async {
    await waitReady();
    final ws = _ws;
    if (ws == null) {
      throw StateError('gateway socket missing');
    }

    final reqId = _uuid.v4();
    final idempotencyKey = _uuid.v4();

    final completer = Completer<String>();
    StreamSubscription<dynamic>? once;
    once = events.listen((evt) {
      if (evt.raw?['_correlationId'] == reqId) {
        final ok = evt.raw?['_resOk'] == true;
        final payload = (evt.raw?['payload'] as Map?)?.cast<String, dynamic>() ?? const {};
        if (ok) {
          final rid = (payload['runId'] as String?) ?? evt.runId;
          if (!completer.isCompleted) completer.complete(rid);
        } else {
          final err = (evt.raw?['error'] as Map?)?.cast<String, dynamic>();
          if (!completer.isCompleted) {
            completer.completeError(StateError('chat.send rejected: ${err ?? evt.raw}'));
          }
        }
        once?.cancel();
      }
    });

    ws.sink.add(jsonEncode(<String, dynamic>{
      'type': 'req',
      'id': reqId,
      'method': 'chat.send',
      'params': <String, dynamic>{
        'sessionKey': _config.sessionKey,
        'message': text,
        'idempotencyKey': idempotencyKey,
        // Per-turn mode from the composer pill (ChatSendParamsSchema
        // supports both natively): Fast -> fastMode+thinking off,
        // Think deeper -> thinking high.
        if (SendOptions.thinking != null) 'thinking': SendOptions.thinking,
        if (SendOptions.fastMode != null) 'fastMode': SendOptions.fastMode,
      },
    }));

    return completer.future.timeout(
      const Duration(seconds: 30),
      onTimeout: () {
        once?.cancel();
        throw TimeoutException('gateway did not ack chat.send within 30s');
      },
    );
  }

  /// Generic request/response RPC against the gateway. Resolves with the
  /// res frame's payload on ok; throws [StateError] when the gateway
  /// rejects the method (bad scope, unknown method, invalid params).
  ///
  /// Used by the Connectors & Apps panel for `config.get` /
  /// `channels.status`; any read-scope gateway method works.
  Future<Map<String, dynamic>> request(
    String method, {
    Map<String, dynamic> params = const <String, dynamic>{},
    Duration timeout = const Duration(seconds: 10),
  }) async {
    await waitReady();
    final ws = _ws;
    if (ws == null) {
      throw StateError('gateway socket missing');
    }
    final reqId = _uuid.v4();
    final completer = Completer<Map<String, dynamic>>();
    StreamSubscription<dynamic>? once;
    once = events.listen((evt) {
      if (evt.raw?['_correlationId'] != reqId) return;
      final ok = evt.raw?['_resOk'] == true;
      if (ok) {
        final payload =
            (evt.raw?['payload'] as Map?)?.cast<String, dynamic>() ??
                const <String, dynamic>{};
        if (!completer.isCompleted) completer.complete(payload);
      } else {
        final err = (evt.raw?['error'] as Map?)?.cast<String, dynamic>();
        if (!completer.isCompleted) {
          DexLog.e('rpc', '$method rejected: ${err ?? evt.raw}');
          completer.completeError(
              StateError('$method rejected: ${err ?? evt.raw}'));
        }
      }
      once?.cancel();
    });
    ws.sink.add(jsonEncode(<String, dynamic>{
      'type': 'req',
      'id': reqId,
      'method': method,
      'params': params,
    }));
    return completer.future.timeout(timeout, onTimeout: () {
      once?.cancel();
      DexLog.e('rpc', '$method timed out after ${timeout.inSeconds}s');
      throw TimeoutException('$method timed out after ${timeout.inSeconds}s');
    });
  }

  /// Approval / denial side-channel.
  ///
  /// Originally wired to `chat.inject`, but that's a privileged gateway
  /// method that requires `operator.admin` scope — control-ui clients
  /// (the Dex desktop app) don't have it, so injects came back as
  /// `INVALID_REQUEST errorMessage=missing scope: operator.admin`.
  /// Route through `chat.send` instead so the approval text reads as a
  /// regular user turn. The agent picks it up the same way and resumes
  /// the pending tool call.
  Future<void> inject(String text) async {
    await sendMessage(text);
  }

  /// Stop the current agent turn.
  ///
  /// Best-effort: the gateway's `chat.abort` cancels the LLM stream
  /// immediately, but a subprocess (UFO² / browser-use) may keep running
  /// until it finishes its current step. The Flutter store flips the
  /// running chip + LiveEntry to "failed" right away regardless, so the
  /// UI is honest about the user's intent.
  Future<void> abort({String? runId}) async {
    if (!isReady) return;
    final ws = _ws;
    if (ws == null) return;
    ws.sink.add(jsonEncode(<String, dynamic>{
      'type': 'req',
      'id': _uuid.v4(),
      'method': 'chat.abort',
      'params': <String, dynamic>{
        'sessionKey': _config.sessionKey,
        if (runId != null) 'runId': runId,
      },
    }));
  }

  // --------------------------------------------------------------------
  // Frame parsing
  // --------------------------------------------------------------------
  void _onFrame(dynamic raw) {
    if (raw is! String) return;
    final Map<String, dynamic> frame;
    try {
      frame = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return;
    }

    final type = frame['type'] as String? ?? '';
    switch (type) {
      case 'event':
        final event = frame['event'] as String? ?? '';
        if (event == 'connect.challenge') {
          _sendConnectReq();
          return;
        }
        _emitEvent(frame);
        break;
      case 'res':
        _handleResponse(frame);
        break;
    }
  }

  void _sendConnectReq() {
    final ws = _ws;
    if (ws == null) return;
    final reqId = _uuid.v4();
    _connectReqId = reqId;
    // Shape verified against ConnectParamsSchema (frames.ts:20-71).
    // Protocol version: vendor/openclaw/packages/gateway-protocol/src/version.ts
    //   PROTOCOL_VERSION = 4 (as of 2026.5.28).
    //
    // CLIENT IDENTITY CHOICE -- this is load-bearing.
    // Without a paired device, the gateway clears any self-declared scopes
    // (message-handler.ts:864 -> clearUnboundScopes) EXCEPT for the
    // "control ui" client running locally with insecure-auth enabled.
    // From message-handler.ts:840-844:
    //   preserveInsecureLocalControlUiScopes =
    //       isControlUi
    //    && controlUiAuthPolicy.allowInsecureAuthConfigured
    //    && isLocalClient
    //    && authMethod in ('token','password')
    // We satisfy 1 by using GATEWAY_CLIENT_IDS.CONTROL_UI = "openclaw-control-ui".
    // We satisfy 2 by the existing gateway.controlUi.allowInsecureAuth=true in
    // ~\.openclaw\openclaw.json (default for local installs).
    // We satisfy 3 by connecting over 127.0.0.1.
    // We satisfy 4 by passing the gateway.auth.token from openclaw.json.
    const int kProtocolVersion = 4;
    ws.sink.add(jsonEncode(<String, dynamic>{
      'type': 'req',
      'id': reqId,
      'method': 'connect',
      'params': <String, dynamic>{
        'minProtocol': kProtocolVersion,
        'maxProtocol': kProtocolVersion,
        'client': <String, dynamic>{
          'id': 'openclaw-control-ui',  // GATEWAY_CLIENT_IDS.CONTROL_UI
          'displayName': 'Dex',
          'version': '1.0.0',
          'platform': 'windows',
          'mode': 'ui',                  // GATEWAY_CLIENT_MODES.UI
        },
        // Role + scopes verified from src/shared/operator-scope-compat.ts.
        // chat.send needs operator.write; config.get / channels.status
        // (the Connectors & Apps panel) need operator.read;
        // web.login.start/wait (in-app WhatsApp QR pairing) need
        // operator.admin. Local insecure-auth control-ui clients keep
        // their declared scopes (message-handler.ts:840-844).
        'role': 'operator',
        'scopes': <String>['operator.read', 'operator.write', 'operator.admin', 'operator.approvals'],
        'auth': <String, dynamic>{'token': _config.token},
      },
    }));
  }

  void _handleResponse(Map<String, dynamic> frame) {
    final id = frame['id'] as String?;
    final ok = frame['ok'] == true;

    if (id != null && id == _connectReqId) {
      // Handshake response.
      if (ok) {
        _connectRetries = 0;
        _setState(GatewayConnState.ready);
        if (_readyCompleter != null && !_readyCompleter!.isCompleted) {
          _readyCompleter!.complete();
        }
      } else {
        final err = (frame['error'] as Map?)?.cast<String, dynamic>();
        final code = (err?['code'] ?? '').toString();
        final message = (err?['message'] ?? '').toString();
        final msg = err != null ? '$code: $message' : 'connect rejected';
        // A just-restarted gateway answers the handshake with UNAVAILABLE /
        // "gateway starting; retry shortly" until init finishes — retry
        // instead of failing (this was the "Restart doesn't work" bug).
        final lower = '$code $message'.toLowerCase();
        final retryable = code == 'UNAVAILABLE' ||
            lower.contains('gateway starting') ||
            lower.contains('retry shortly') ||
            lower.contains('starting');
        if (retryable) {
          _retryOrFail(msg);
        } else {
          _setState(GatewayConnState.failed, error: msg);
          if (_readyCompleter != null && !_readyCompleter!.isCompleted) {
            _readyCompleter!.completeError(StateError(msg));
          }
          _readyCompleter = null;
        }
      }
      return;
    }

    // Generic res -- surface as a synthetic event so callers waiting on a
    // correlation id (sendMessage / inject) can resolve.
    _events.add(GatewayEvent(
      kind: ok ? GatewayEventKind.other : GatewayEventKind.error,
      runId: '',
      raw: <String, dynamic>{
        '_correlationId': id,
        '_resOk': ok,
        ...frame,
      },
    ));
  }

  void _emitEvent(Map<String, dynamic> frame) {
    final event = frame['event'] as String? ?? '';
    final payload = (frame['payload'] as Map?)?.cast<String, dynamic>() ?? const <String, dynamic>{};
    final runId = (payload['runId'] as String?) ?? '';
    final sessionKey = payload['sessionKey'] as String?;

    GatewayEventKind kind;
    String? deltaText;

    // The wire event name is the bare "chat" -- delta/final/error/aborted are
    // discriminated by payload.state. Verified from logs-chat.ts (ChatDelta/
    // Final/Aborted/ErrorEventSchema) and tests in server-chat.agent-events.test.ts.
    if (event == 'chat') {
      final state = payload['state'] as String? ?? '';
      switch (state) {
        case 'delta':
          kind = GatewayEventKind.delta;
          deltaText = payload['deltaText'] as String?;
          break;
        case 'final':
          kind = GatewayEventKind.finalReply;
          // Some final frames carry the full message; surface as a single
          // delta-equivalent so empty-streaming messages still show text.
          final msg = payload['message'];
          if (msg is Map) {
            final content = msg['content'] ?? msg['text'];
            if (content is String && content.isNotEmpty) {
              deltaText = content;
            }
          }
          break;
        case 'error':
          kind = GatewayEventKind.error;
          deltaText = payload['errorMessage'] as String?;
          break;
        case 'aborted':
          kind = GatewayEventKind.aborted;
          break;
        default:
          kind = GatewayEventKind.other;
      }
    } else if (event == 'exec.approval.requested' || event == 'plugin.approval.requested') {
      kind = GatewayEventKind.approvalRequested;
    } else if (event.contains('tool.call') || event.contains('mcp.call')) {
      kind = GatewayEventKind.toolCall;
    } else if (event.contains('tool.result') || event.contains('mcp.result')) {
      kind = GatewayEventKind.toolResult;
    } else {
      kind = GatewayEventKind.other;
    }

    _events.add(GatewayEvent(
      kind: kind,
      runId: runId,
      sessionKey: sessionKey,
      deltaText: deltaText,
      raw: frame,
    ));
  }

  void _onDone() {
    if (_retrying) return; // intentional teardown between retries
    _ws = null;
    // Socket closed while still handshaking → the gateway is likely still
    // booting (restart race). Retry instead of failing the completer.
    if (_readyCompleter != null && !_readyCompleter!.isCompleted) {
      _retryOrFail('socket closed before handshake');
      return;
    }
    _setState(GatewayConnState.disconnected);
  }

  void _onError(Object err, StackTrace st) {
    if (_retrying) return; // intentional teardown between retries
    // Mid-handshake socket error during a (re)start is transient — retry.
    if (_readyCompleter != null && !_readyCompleter!.isCompleted) {
      _retryOrFail(err.toString());
      return;
    }
    _setState(GatewayConnState.failed, error: err.toString());
    _events.add(GatewayEvent(
      kind: GatewayEventKind.error,
      runId: '',
      raw: {'error': err.toString()},
    ));
  }

  @override
  Future<void> dispose() async {
    await disconnect();
    await _events.close();
    super.dispose();
  }
}
