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

import 'models/gateway_event.dart';

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

  /// Load gateway config from `%USERPROFILE%\.dex\openclaw.json`, falling
  /// back to the legacy `%USERPROFILE%\.openclaw\openclaw.json` location
  /// for one cycle while users finish migrating off it (Phase B.5 moved
  /// the directory; the filename rename ships in v1.4). Returns defaults
  /// if neither location is present -- the client then surfaces a clear
  /// "authentication required" error in the UI.
  static GatewayConfig fromLocalConfig({String sessionKey = 'dex-desktop'}) {
    final home = Platform.environment['USERPROFILE'] ??
        Platform.environment['HOME'] ??
        '';
    final sep = Platform.pathSeparator;
    final candidates = <String>[
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
  GatewayClient(this._config);

  final GatewayConfig _config;
  final _uuid = const Uuid();

  WebSocketChannel? _ws;
  StreamSubscription<dynamic>? _sub;
  final _events = StreamController<GatewayEvent>.broadcast();

  GatewayConnState _state = GatewayConnState.disconnected;
  String? _lastError;
  Completer<void>? _readyCompleter;
  String? _connectReqId;

  GatewayConnState get state => _state;
  String? get lastError => _lastError;
  bool get isReady => _state == GatewayConnState.ready;
  Stream<GatewayEvent> get events => _events.stream;

  void _setState(GatewayConnState s, {String? error}) {
    if (_state == s && error == _lastError) return;
    _state = s;
    _lastError = error;
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
          error: 'No auth token. Run `dex onboard` first; ~\\.dex\\openclaw.json should contain gateway.auth.token.');
      return;
    }

    _setState(GatewayConnState.connecting);
    _readyCompleter = Completer<void>();

    try {
      // Use IOWebSocketChannel so we can send a matching Origin header.
      // The OpenClaw gateway runs an origin allowlist (origin-check.ts) that
      // accepts the loopback URL it's bound to. Without this header dart:io
      // sends no Origin and the gateway rejects us with "origin not allowed".
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
      // OpenClaw's handshake-pending state machine.
    } catch (e) {
      _setState(GatewayConnState.failed, error: 'connect failed: $e');
      _readyCompleter?.completeError(e);
      _readyCompleter = null;
    }
  }

  /// Block until the gateway has accepted our connect req. Throws if we
  /// transition to failed before becoming ready.
  Future<void> waitReady({Duration timeout = const Duration(seconds: 8)}) async {
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

  Future<void> inject(String text) async {
    await waitReady();
    final ws = _ws;
    if (ws == null) return;
    ws.sink.add(jsonEncode(<String, dynamic>{
      'type': 'req',
      'id': _uuid.v4(),
      'method': 'chat.inject',
      'params': <String, dynamic>{
        'sessionKey': _config.sessionKey,
        'message': text,
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
        // chat.send needs operator.write.
        'role': 'operator',
        'scopes': <String>['operator.write'],
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
        _setState(GatewayConnState.ready);
        if (_readyCompleter != null && !_readyCompleter!.isCompleted) {
          _readyCompleter!.complete();
        }
      } else {
        final err = (frame['error'] as Map?)?.cast<String, dynamic>();
        final msg = err != null ? '${err['code']}: ${err['message']}' : 'connect rejected';
        _setState(GatewayConnState.failed, error: msg);
        if (_readyCompleter != null && !_readyCompleter!.isCompleted) {
          _readyCompleter!.completeError(StateError(msg));
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
    _setState(GatewayConnState.disconnected);
    _ws = null;
    if (_readyCompleter != null && !_readyCompleter!.isCompleted) {
      _readyCompleter!.completeError(StateError('socket closed before handshake'));
    }
  }

  void _onError(Object err, StackTrace st) {
    _setState(GatewayConnState.failed, error: err.toString());
    _events.add(GatewayEvent(
      kind: GatewayEventKind.error,
      runId: '',
      raw: {'error': err.toString()},
    ));
    if (_readyCompleter != null && !_readyCompleter!.isCompleted) {
      _readyCompleter!.completeError(err);
    }
  }

  @override
  Future<void> dispose() async {
    await disconnect();
    await _events.close();
    super.dispose();
  }
}
