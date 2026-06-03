// Dex <-> OpenClaw gateway adapter.
//
// Protocol verified from vendor/openclaw/packages/gateway-protocol/src/schema/
//   - frames.ts                (ConnectParams + RequestFrame/ResponseFrame/EventFrame)
//   - logs-chat.ts             (chat.send params + chat delta/final event shapes)
// Transport: JSON-RPC 2.0 over WebSocket on ws://127.0.0.1:18789
//
// What this client does NOT do (yet):
//   - reconnect-with-backoff -- Phase 7
//   - resume an in-flight runId across restart -- Phase 7
//   - typed adapters for every method (we only surface chat.* in v1)

import 'dart:async';
import 'dart:convert';

import 'package:uuid/uuid.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'models/gateway_event.dart';

class GatewayConfig {
  final Uri url;
  final String? token;     // OpenClaw auth token (from `openclaw onboard` or its config)
  final String? password;  // optional alternate
  final String sessionKey; // identifies this Dex conversation across reconnects
  const GatewayConfig({
    required this.url,
    required this.sessionKey,
    this.token,
    this.password,
  });

  factory GatewayConfig.localDefault({String? token}) => GatewayConfig(
        url: Uri.parse('ws://127.0.0.1:18789'),
        sessionKey: 'dex-desktop',
        token: token,
      );
}

class GatewayClient {
  GatewayClient(this._config);

  final GatewayConfig _config;
  final _uuid = const Uuid();

  WebSocketChannel? _ws;
  StreamSubscription<dynamic>? _sub;
  final _events = StreamController<GatewayEvent>.broadcast();

  /// Stream of events parsed out of the gateway's frame stream. Subscribe
  /// once at app init; the controller is broadcast so multiple state stores
  /// can listen.
  Stream<GatewayEvent> get events => _events.stream;

  bool get isConnected => _ws != null;

  // --------------------------------------------------------------------
  // Connect / disconnect
  // --------------------------------------------------------------------
  Future<void> connect() async {
    if (_ws != null) return;
    final ws = WebSocketChannel.connect(_config.url);
    _ws = ws;

    // First frame after the socket opens is the `hello` connect-params
    // frame -- include auth so the gateway lets us in.
    final hello = <String, dynamic>{
      'type': 'hello',
      'protocolVersion': 1,
      if (_config.token != null) 'auth': {'token': _config.token},
      if (_config.password != null) 'auth': {'password': _config.password},
      'client': {
        'name': 'dex',
        'kind': 'desktop',
      },
    };
    ws.sink.add(jsonEncode(hello));

    _sub = ws.stream.listen(
      _onFrame,
      onDone: _onDone,
      onError: _onError,
      cancelOnError: false,
    );
  }

  Future<void> disconnect() async {
    await _sub?.cancel();
    _sub = null;
    await _ws?.sink.close();
    _ws = null;
  }

  // --------------------------------------------------------------------
  // chat.send -- returns a runId once the gateway acks
  // --------------------------------------------------------------------
  Future<String> sendMessage(String text) async {
    final ws = _ws;
    if (ws == null) {
      throw StateError('GatewayClient not connected. Call connect() first.');
    }

    final reqId = _uuid.v4();
    final idempotencyKey = _uuid.v4();

    final completer = Completer<String>();
    StreamSubscription<dynamic>? once;
    once = events.listen((evt) {
      // chat.send returns its runId inside the sync response, which we
      // catch in _onFrame as a 'res' frame. We expose only events
      // publicly; on the first event for this runId we resolve.
      if (evt.raw?['_correlationId'] == reqId && evt.raw?['_resOk'] == true) {
        final rid = evt.runId;
        if (!completer.isCompleted) completer.complete(rid);
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

    // Don't hang forever if the gateway is silent.
    return completer.future.timeout(
      const Duration(seconds: 30),
      onTimeout: () {
        once?.cancel();
        throw TimeoutException('gateway did not ack chat.send within 30s');
      },
    );
  }

  /// Inject an assistant note (no run). Used for surface-level UI events
  /// like "user approved the action".
  Future<void> inject(String text) async {
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
        _emitEvent(frame);
        break;
      case 'res':
        // Sync RPC response. We surface a synthetic GatewayEvent so the
        // pending sendMessage() future can resolve in events.listen().
        final ok = frame['ok'] == true;
        final data = (frame['data'] as Map?)?.cast<String, dynamic>() ?? const {};
        final runId = data['runId'] as String? ?? '';
        _events.add(GatewayEvent(
          kind: ok ? GatewayEventKind.other : GatewayEventKind.error,
          runId: runId,
          raw: <String, dynamic>{
            '_correlationId': frame['id'],
            '_resOk': ok,
            ...frame,
          },
        ));
        break;
      case 'hello-ok':
        // Gateway accepted us. Nothing to do; future events will arrive on
        // the stream.
        break;
    }
  }

  void _emitEvent(Map<String, dynamic> frame) {
    final state = frame['state'] as String? ?? '';
    final runId = frame['runId'] as String? ?? '';
    final sessionKey = frame['sessionKey'] as String?;
    GatewayEventKind kind;
    switch (state) {
      case 'delta':
        kind = GatewayEventKind.delta;
        break;
      case 'final':
        kind = GatewayEventKind.finalReply;
        break;
      case 'error':
        kind = GatewayEventKind.error;
        break;
      case 'aborted':
        kind = GatewayEventKind.aborted;
        break;
      default:
        // OpenClaw fans out tool-call / tool-result events under different
        // shapes -- detect by `event` field as a fallback.
        final evt = frame['event'] as String? ?? '';
        if (evt.contains('tool.call') || evt.contains('mcp.call')) {
          kind = GatewayEventKind.toolCall;
        } else if (evt.contains('tool.result') || evt.contains('mcp.result')) {
          kind = GatewayEventKind.toolResult;
        } else {
          kind = GatewayEventKind.other;
        }
    }
    _events.add(GatewayEvent(
      kind: kind,
      runId: runId,
      sessionKey: sessionKey,
      deltaText: frame['deltaText'] as String?,
      raw: frame,
    ));
  }

  void _onDone() {
    _events.add(GatewayEvent(
      kind: GatewayEventKind.aborted,
      runId: '',
      raw: const {'reason': 'socket-closed'},
    ));
    _ws = null;
  }

  void _onError(Object err, StackTrace st) {
    _events.add(GatewayEvent(
      kind: GatewayEventKind.error,
      runId: '',
      raw: {'error': err.toString()},
    ));
  }

  Future<void> dispose() async {
    await disconnect();
    await _events.close();
  }
}
