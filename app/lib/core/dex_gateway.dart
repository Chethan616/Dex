import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'log.dart';
import 'models/brain_settings.dart';
import 'models/capability_health.dart';

/// Talks to the Dex core.
///
/// This replaces the OpenClaw gateway client this app was written against.
/// The two speak different languages, and the difference is the reason for
/// the swap rather than an inconvenience of it:
///
///   OpenClaw streams a chat — delta, delta, delta, finalReply. You learn what
///   happened when it is over.
///
///   Dex streams a plan — thinking, planning, selecting, dispatching,
///   executing, done, per step, each carrying its tier and its verification.
///   You watch it happen.
///
/// The second is what the owner asked to see, and it is why the core did not
/// move: it already emits exactly this.
///
/// Connection details are never hardcoded. The core writes a handshake file at
/// `%LOCALAPPDATA%\DEX\ui.json` with the port and a per-run token, and this
/// reads it — the same file the Dex Bar reads, so both clients agree about
/// where the core is and neither can drift.
class DexGatewayClient extends ChangeNotifier {
  /// The client this app is running on.
  ///
  /// A single-instance holder so leaf widgets — the settings dialog, the
  /// diagnostics panel — can reach it without threading it through every
  /// constructor between here and there. There is exactly one core and one
  /// connection to it, so a second instance would be a bug rather than a
  /// configuration.
  static DexGatewayClient? current;

  DexGatewayClient() {
    current = this;
  }

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _sub;
  Timer? _reconnect;
  int _backoffMs = 500;

  final _frames = StreamController<DexFrame>.broadcast();

  /// Every frame from the core: step events, confirmations, results.
  Stream<DexFrame> get frames => _frames.stream;

  DexConnection connection = DexConnection.disconnected;
  String? connectionError;

  /// Whether privileged steps run without asking. Shown in the UI, never set
  /// from it — granting elevation is a separate, deliberate act.
  bool fullAccess = false;
  String daemonService = 'unknown';

  /// What the last grant or revoke said. Shown once, then dismissed.
  String? fullAccessNotice;

  /// The request currently running, learned from the first event that carries
  /// one. `submit` cannot return it: the core mints the id, and the reply that
  /// carries it arrives after the work has already started streaming.
  String? currentRequestId;

  // ---- settings -------------------------------------------------------------
  //
  // All of it round-trips through the core. The credential store is DPAPI-
  // encrypted against this Windows account and settings.json lives beside the
  // logs — one writer for both, and the app never holds a key.

  BrainSettings? settings;
  bool settingsBusy = false;
  String? testing;
  Map<String, dynamic>? lastTest;
  String? lastError;
  bool claudeSignInStarted = false;
  String? claudeSignInError;

  /// Raw text of each log, keyed by source name.
  final Map<String, String> logs = <String, String>{};

  /// Ask the core for the tail of one of the five log files.
  ///
  /// Read through the core rather than from disk here: it already tails
  /// safely — the last 256KB rather than a file that runs to megabytes — and
  /// it validates the name, so no path can be talked into reading something
  /// that is not a Dex log.
  void refreshLog(String name, {int lines = 600}) =>
      _send({'type': 'get_log', 'name': name, 'lines': lines});

  /// Which capabilities are alive, probed by the core.
  List<CapabilityHealth>? health;

  void refreshHealth() => _send({'type': 'get_health'});

  // ---- what Dex remembers --------------------------------------------------
  //
  // The real memory: every task, its outcome, and the workflows saved from
  // them, in %LOCALAPPDATA%\DEX\dex.db. The Memory tab used to read a
  // MEMORY.md under ~/.dex that nothing in this Dex has ever written to.

  List<Map<String, dynamic>> history = const [];
  Map<String, dynamic>? stats;
  List<Map<String, dynamic>> workflows = const [];

  void refreshHistory({String query = '', int limit = 50}) => _send({
        'type': 'get_history',
        if (query.isNotEmpty) 'query': query,
        'limit': limit,
      });

  void refreshStats({int days = 7}) =>
      _send({'type': 'get_stats', 'days': days});

  void refreshWorkflows() => _send({'type': 'get_workflows'});

  void forgetWorkflow(String name) =>
      _send({'type': 'delete_workflow', 'name': name});

  /// Give a learned workflow a name of your own.
  ///
  /// Workflows save themselves now, under a slug derived from the intent.
  /// Renaming one claims it: it stops being evictable, it outranks the learned
  /// ones, and the name is what `run <name>` accepts.
  void renameWorkflow(String from, String to) =>
      _send({'type': 'rename_workflow', 'from': from, 'to': to});

  void refreshSettings() => _send({'type': 'get_settings'});

  /// Grant or revoke Full Access.
  ///
  /// Granting raises one Windows elevation prompt and registers a logon task
  /// that runs the daemon elevated in this session. After that, privileged
  /// steps stop asking — which is the difference between answering twelve
  /// approval cards for one plan and answering none.
  ///
  /// What it does not do: unlock the RED registry band, or stop a hand-off
  /// reaching you. No privilege lets Dex read a CAPTCHA or type a password.
  void setFullAccess(bool enabled) {
    _send({'type': 'full_access', 'enabled': enabled});
  }

  /// Store a secret. It goes one way — nothing sends it back.
  void setCredential(String name, String value) {
    settingsBusy = true;
    notifyListeners();
    _send({'type': 'set_credential', 'name': name, 'value': value});
  }

  void deleteCredential(String name) {
    settingsBusy = true;
    notifyListeners();
    _send({'type': 'delete_credential', 'name': name});
  }

  /// Choose the brain. Takes effect immediately; no restart.
  void setBrain(String provider, {String model = ''}) {
    settingsBusy = true;
    lastError = null;
    notifyListeners();
    _send({'type': 'set_brain', 'provider': provider, 'model': model});
  }

  void setConfig(Map<String, dynamic> changes) {
    settingsBusy = true;
    notifyListeners();
    _send({'type': 'set_config', 'changes': changes});
  }

  /// Spend one real request and report what came back.
  void testProvider(String provider) {
    testing = provider;
    lastTest = null;
    notifyListeners();
    _send({'type': 'test_provider', 'provider': provider});
  }

  /// Start the Claude Code browser sign-in.
  void signInToClaude() {
    claudeSignInStarted = false;
    claudeSignInError = null;
    notifyListeners();
    _send({'type': 'claude_signin'});
  }

  static File get handshakeFile {
    final base = Platform.environment['LOCALAPPDATA'] ??
        Platform.environment['USERPROFILE'] ??
        Directory.systemTemp.path;
    return File('$base${Platform.pathSeparator}DEX${Platform.pathSeparator}ui.json');
  }

  Future<void> connect() async {
    _reconnect?.cancel();
    connectionError = null;
    connection = DexConnection.connecting;
    notifyListeners();

    final file = handshakeFile;
    if (!file.existsSync()) {
      _giveUpFor(
        'Dex core is not running.\n'
        'It starts with the app — if you are seeing this, check '
        r'%LOCALAPPDATA%\DEX\core.log',
      );
      return;
    }

    Map<String, dynamic> handshake;
    try {
      handshake = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    } catch (e) {
      _giveUpFor('The handshake file is unreadable: $e');
      return;
    }

    final port = handshake['port'] as int? ?? 8770;
    final token = handshake['token'] as String? ?? '';

    try {
      final channel = WebSocketChannel.connect(Uri.parse('ws://127.0.0.1:$port'));
      await channel.ready;
      _channel = channel;
      _sub = channel.stream.listen(
        _onMessage,
        onDone: _onDisconnected,
        onError: (Object e) {
          connectionError = e.toString();
          _onDisconnected();
        },
        cancelOnError: true,
      );
      _send({'type': 'auth', 'token': token});
    } catch (_) {
      _giveUpFor('Could not reach the core on port $port.');
    }
  }

  void _giveUpFor(String reason) {
    connection = DexConnection.noCore;
    connectionError = reason;
    notifyListeners();
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    _reconnect?.cancel();
    _reconnect = Timer(Duration(milliseconds: _backoffMs), connect);
    _backoffMs = (_backoffMs * 2).clamp(500, 8000);
  }

  void _onDisconnected() {
    _sub?.cancel();
    _sub = null;
    _channel = null;
    connection = DexConnection.disconnected;
    notifyListeners();
    _scheduleReconnect();
  }

  void _send(Map<String, dynamic> payload) =>
      _channel?.sink.add(jsonEncode(payload));

  /// Whoever is waiting on `capture_screen`.
  ///
  /// The protocol is a stream of one-way frames, not a request/response — the
  /// step events are the reason it is shaped that way. This one call needs an
  /// answer, so it keeps a single Completer rather than growing a correlation
  /// layer for it. Menu items cannot overlap: the menu closes on the first tap.
  Completer<String?>? _capture;

  /// Photograph the desktop and return where the PNG landed.
  ///
  /// Null if the core is not connected, the daemon refused, or nothing answered
  /// in ten seconds — the caller attaches nothing rather than a broken path.
  Future<String?> captureScreen() {
    if (connection != DexConnection.connected) return Future<String?>.value(null);
    _capture?.complete(null);
    final pending = Completer<String?>();
    _capture = pending;
    _send({'type': 'capture_screen'});
    return pending.future.timeout(
      const Duration(seconds: 10),
      onTimeout: () {
        _capture = null;
        return null;
      },
    );
  }

  void _onMessage(dynamic raw) {
    Map<String, dynamic> msg;
    try {
      msg = jsonDecode(raw as String) as Map<String, dynamic>;
    } catch (_) {
      return;
    }

    final type = msg['type'] as String?;

    switch (type) {
      case 'ready':
        connection = DexConnection.connected;
        connectionError = null;
        _backoffMs = 500;
        fullAccess = msg['fullAccess'] as bool? ?? false;
        notifyListeners();
        _send({'type': 'get_status'});
        return;

      case 'status':
        fullAccess = msg['fullAccess'] as bool? ?? fullAccess;
        daemonService = msg['daemonService'] as String? ?? daemonService;
        notifyListeners();
        return;

      case 'capture_screen_result':
        final waiting = _capture;
        _capture = null;
        if (msg['ok'] == true) {
          waiting?.complete(msg['path'] as String?);
        } else {
          DexLog.w('capture', msg['message'] as String? ?? 'capture failed');
          waiting?.complete(null);
        }
        return;

      case 'full_access_result':
        fullAccessNotice = msg['message'] as String?;
        if (msg['ok'] == true) {
          fullAccess = msg['enabled'] as bool? ?? fullAccess;
        }
        notifyListeners();
        // Ask the core what is actually true rather than believing the reply.
        // Configured and elevated are different things, and the daemon is the
        // only one that knows which.
        _send({'type': 'get_status'});
        return;

      // The step stream. This is the whole point.
      case 'event':
        final event = Map<String, dynamic>.from(msg['event'] as Map);
        final requestId = event['requestId'] as String? ?? '';
        if (requestId.isNotEmpty) currentRequestId = requestId;
        _frames.add(DexFrame(
          kind: DexFrameKind.step,
          type: event['type'] as String? ?? 'unknown',
          message: event['message'] as String? ?? '',
          requestId: requestId,
          stepId: event['stepId'] as String?,
          data: event['data'],
        ));
        return;

      case 'confirmation':
        final request = Map<String, dynamic>.from(msg['request'] as Map);
        _frames.add(DexFrame(
          kind: DexFrameKind.confirmation,
          type: 'confirmation',
          message: request['summary'] as String? ?? 'Approval needed',
          requestId: request['requestId'] as String? ?? '',
          stepId: request['stepId'] as String?,
          data: request,
        ));
        return;

      case 'confirmation_closed':
        _frames.add(DexFrame(
          kind: DexFrameKind.confirmationClosed,
          type: 'confirmation_closed',
          message: '',
          requestId: msg['requestId'] as String? ?? '',
          stepId: msg['stepId'] as String?,
        ));
        return;

      case 'result':
        _frames.add(DexFrame(
          kind: DexFrameKind.result,
          type: 'result',
          // `answer` is what Dex has to say; `summary` is what it did. The
          // answer is preferred because a question that produced a value
          // should end with the value, not with a restatement of the task.
          message: (msg['answer'] as String?) ?? (msg['summary'] as String? ?? ''),
          requestId: msg['requestId'] as String? ?? '',
          data: msg,
        ));
        return;

      case 'settings':
        settings = BrainSettings.fromJson(
          Map<String, dynamic>.from(msg['settings'] as Map),
        );
        settingsBusy = false;
        notifyListeners();
        return;

      case 'provider_test':
        lastTest = Map<String, dynamic>.from(msg['result'] as Map);
        testing = null;
        notifyListeners();
        return;

      case 'history':
        history = ((msg['tasks'] as List?) ?? const [])
            .map((t) => Map<String, dynamic>.from(t as Map))
            .toList();
        notifyListeners();
        return;

      case 'stats':
        stats = Map<String, dynamic>.from(msg['stats'] as Map);
        notifyListeners();
        return;

      case 'workflows':
        workflows = ((msg['workflows'] as List?) ?? const [])
            .map((w) => Map<String, dynamic>.from(w as Map))
            .toList();
        notifyListeners();
        return;

      case 'workflow_deleted':
        refreshWorkflows();
        return;

      case 'health':
        health = ((msg['capabilities'] as List?) ?? const [])
            .map((c) => CapabilityHealth.fromJson(Map<String, dynamic>.from(c as Map)))
            .toList();
        notifyListeners();
        return;

      case 'log':
        logs[msg['name'] as String? ?? ''] = msg['text'] as String? ?? '';
        notifyListeners();
        return;

      case 'claude_signin_result':
        claudeSignInStarted =
            (msg['result'] as Map?)?['started'] as bool? ?? false;
        claudeSignInError = (msg['result'] as Map?)?['reason'] as String?;
        notifyListeners();
        return;

      case 'error':
        // A failed save must not leave a spinner running forever.
        settingsBusy = false;
        testing = null;
        lastError = msg['message'] as String?;
        notifyListeners();
        _frames.add(DexFrame(
          kind: DexFrameKind.error,
          type: 'error',
          message: msg['message'] as String? ?? 'Something went wrong',
          requestId: currentRequestId ?? '',
        ));
        return;

      default:
        return;
    }
  }

  // ---- commands -------------------------------------------------------------

  void submit(String text) {
    currentRequestId = null;
    _send({'type': 'submit', 'text': text});
  }

  void cancel() {
    final id = currentRequestId;
    if (id == null || id.isEmpty) return;
    _send({'type': 'cancel', 'requestId': id});
  }

  /// Answer a confirmation card.
  ///
  /// The step version travels with the verdict. It is a hash of the step as
  /// the owner was shown it, so an approval cannot authorise a step that has
  /// since been rewritten — the core re-checks it and refuses a stale one.
  void respond({
    required String requestId,
    required String stepId,
    required String stepVersion,
    required String verdict,
  }) {
    _send({
      'type': 'respond',
      'requestId': requestId,
      'stepId': stepId,
      'stepVersion': stepVersion,
      'verdict': verdict,
    });
  }

  @override
  void dispose() {
    _reconnect?.cancel();
    _sub?.cancel();
    _channel?.sink.close();
    _frames.close();
    super.dispose();
  }
}

enum DexConnection { disconnected, connecting, connected, noCore }

enum DexFrameKind { step, confirmation, confirmationClosed, result, error }

/// One thing the core said.
class DexFrame {
  DexFrame({
    required this.kind,
    required this.type,
    required this.message,
    required this.requestId,
    this.stepId,
    this.data,
  });

  final DexFrameKind kind;

  /// For a step frame: `thinking`, `planning`, `selecting`, `dispatching`,
  /// `executing`, `retrying`, `awaiting`, `done`, `failed`, `cancelled`.
  final String type;

  final String message;
  final String requestId;

  /// Present on per-step events; absent on the ones about the task as a whole.
  /// This is what tells "this step finished" apart from "the task finished".
  final String? stepId;

  final dynamic data;

  Map<String, dynamic>? get dataMap =>
      data is Map ? Map<String, dynamic>.from(data as Map) : null;
}
