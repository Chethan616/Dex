import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'models.dart';

enum CoreConnection { disconnected, connecting, connected, noCore }

/// Talks to the DEX core over a loopback WebSocket. Connection details come from
/// the handshake file the core writes at startup — never hardcoded.
class GatewayClient extends ChangeNotifier {
  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _sub;
  Timer? _reconnectTimer;
  int _backoffMs = 500;

  CoreConnection connection = CoreConnection.disconnected;
  String? connectionError;

  bool fullAccess = false;
  String daemonService = 'unknown';

  /// Tier 3 `capability:action` pairs pre-approved for this session.
  List<String> preApprovals = [];

  TaskRun? current;
  final List<TaskRun> history = [];
  final Map<String, ConfirmationRequest> pending = {};

  List<EvidenceRecord> evidence = [];
  String? evidenceForRequest;

  String? lastNotice;

  static File get handshakeFile {
    final base = Platform.environment['LOCALAPPDATA'] ??
        Platform.environment['XDG_RUNTIME_DIR'] ??
        '${Platform.environment['USERPROFILE'] ?? Platform.environment['HOME']}';
    return File('$base${Platform.pathSeparator}DEX${Platform.pathSeparator}ui.json');
  }

  Future<void> connect() async {
    _reconnectTimer?.cancel();
    connectionError = null;
    connection = CoreConnection.connecting;
    notifyListeners();

    final file = handshakeFile;
    if (!file.existsSync()) {
      connection = CoreConnection.noCore;
      connectionError = 'DEX core is not running.\nStart it with: scripts\\run-dev.ps1';
      notifyListeners();
      _scheduleReconnect();
      return;
    }

    Map<String, dynamic> handshake;
    try {
      handshake = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    } catch (e) {
      connection = CoreConnection.noCore;
      connectionError = 'Handshake file is unreadable: $e';
      notifyListeners();
      _scheduleReconnect();
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
    } catch (e) {
      connection = CoreConnection.noCore;
      connectionError = 'Could not reach core on port $port.';
      notifyListeners();
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(Duration(milliseconds: _backoffMs), connect);
    _backoffMs = (_backoffMs * 2).clamp(500, 8000);
  }

  /// Saved workflows, newest-used first. Populated on connect.
  List<SavedWorkflow> workflows = [];

  /// Past tasks from the core's database, for the history panel. Distinct from
  /// `history`, which holds the runs this session has watched live.
  List<TaskRecord> pastTasks = [];

  /// Usage summary for the stats panel.
  UsageStats? stats;

  /// Set when the core notices this task is one you keep repeating.
  SaveSuggestion? saveSuggestion;

  void _onDisconnected() {
    _sub?.cancel();
    _sub = null;
    _channel = null;
    connection = CoreConnection.disconnected;
    notifyListeners();
    _scheduleReconnect();
  }

  void _send(Map<String, dynamic> payload) {
    _channel?.sink.add(jsonEncode(payload));
  }

  void _onMessage(dynamic raw) {
    Map<String, dynamic> msg;
    try {
      msg = jsonDecode(raw as String) as Map<String, dynamic>;
    } catch (_) {
      return;
    }

    switch (msg['type'] as String?) {
      case 'ready':
        connection = CoreConnection.connected;
        connectionError = null;
        _backoffMs = 500;
        fullAccess = msg['fullAccess'] as bool? ?? false;
        _loadPending(msg['pending']);
        _send({'type': 'get_status'});
        _send({'type': 'get_workflows'});
        break;

      // A status frame may be partial (e.g. broadcast after clearing
      // pre-approvals), so only overwrite the fields it actually carries.
      case 'status':
        fullAccess = msg['fullAccess'] as bool? ?? fullAccess;
        daemonService = msg['daemonService'] as String? ?? daemonService;
        if (msg['preApprovals'] != null) {
          preApprovals = List<String>.from(msg['preApprovals'] as List);
        }
        if (msg.containsKey('pending')) _loadPending(msg['pending']);
        break;

      case 'preapprovals_cleared':
        lastNotice = 'Cleared ${msg['cleared']} session pre-approval(s).';
        break;

      case 'event':
        _onEvent(DexEvent.fromJson(Map<String, dynamic>.from(msg['event'] as Map)));
        break;

      case 'confirmation':
        final req = ConfirmationRequest.fromJson(
          Map<String, dynamic>.from(msg['request'] as Map),
        );
        pending[req.key] = req;
        current?.phase = TaskPhase.awaiting;
        break;

      case 'confirmation_closed':
        pending.removeWhere((_, r) =>
            r.requestId == msg['requestId'] && r.stepId == msg['stepId']);
        if (pending.isEmpty && current?.phase == TaskPhase.awaiting) {
          current!.phase = TaskPhase.running;
        }
        break;

      case 'respond_ack':
        if (msg['accepted'] != true) {
          lastNotice = msg['reason'] as String? ?? 'Approval was not accepted';
        }
        break;

      case 'result':
        _onResult(msg);
        break;

      case 'full_access_result':
        lastNotice = msg['message'] as String?;
        if (msg['ok'] == true) fullAccess = msg['enabled'] as bool? ?? fullAccess;
        _send({'type': 'get_status'});
        break;

      case 'evidence':
        evidenceForRequest = msg['requestId'] as String?;
        evidence = (msg['records'] as List? ?? const [])
            .map((r) => EvidenceRecord.fromJson(Map<String, dynamic>.from(r as Map)))
            .toList();
        break;

      case 'workflows':
        workflows = (msg['workflows'] as List)
            .map((w) => SavedWorkflow.fromJson(Map<String, dynamic>.from(w as Map)))
            .toList();
        break;

      case 'workflow_saved':
        lastNotice = 'Saved "${msg['name']}" — ${msg['steps']} step(s).';
        saveSuggestion = null;
        _send({'type': 'get_workflows'});
        break;

      case 'workflow_deleted':
        lastNotice = msg['removed'] == true
            ? 'Forgot "${msg['name']}".'
            : 'No workflow named "${msg['name']}".';
        break;

      case 'history':
        pastTasks = (msg['tasks'] as List)
            .map((t) => TaskRecord.fromJson(Map<String, dynamic>.from(t as Map)))
            .toList();
        break;

      case 'stats':
        stats = UsageStats.fromJson(Map<String, dynamic>.from(msg['stats'] as Map));
        break;

      case 'error':
        lastNotice = msg['message'] as String?;
        break;
    }
    notifyListeners();
  }

  void _loadPending(dynamic list) {
    pending.clear();
    for (final item in (list as List? ?? const [])) {
      final req = ConfirmationRequest.fromJson(Map<String, dynamic>.from(item as Map));
      pending[req.key] = req;
    }
  }

  /// Every run this UI knows about, keyed by request id.
  final Map<String, TaskRun> _runs = {};

  /// Resolve the run an event belongs to, adopting tasks this UI did not start
  /// — one submitted from the CLI, or one already in flight when the UI
  /// reconnected. The interface is a window onto the core, so it shows the
  /// core's work whether or not it was the one that asked for it.
  TaskRun _runFor(DexEvent event) {
    final existing = _runs[event.requestId];
    if (existing != null) return existing;

    // A submit that has not yet learned its request id — bind it now.
    final unbound = current;
    if (unbound != null && unbound.requestId.isEmpty) {
      unbound.requestId = event.requestId;
      _runs[event.requestId] = unbound;
      return unbound;
    }

    final adopted = TaskRun(
      requestId: event.requestId,
      prompt: event.type == 'thinking' ? event.message : 'task from another channel',
      startedAt: event.timestamp,
    );
    _runs[event.requestId] = adopted;
    history.insert(0, adopted);
    _trimHistory();

    // Only take over the foreground if nothing is actively running here.
    final live = current;
    if (live == null || live.finishedAt != null) current = adopted;
    return adopted;
  }

  void _onEvent(DexEvent event) {
    if (event.requestId.isEmpty) return;
    final run = _runFor(event);

    // A late-arriving prompt for a run adopted before its `thinking` event.
    if (event.type == 'thinking' && run.prompt == 'task from another channel') {
      run.prompt = event.message;
    }

    run.events.add(event);

    if (event.type == 'planning' && event.data is Map) {
      run.plan = ExecutionPlanModel.fromJson(Map<String, dynamic>.from(event.data as Map));
    }
    if (run.phase == TaskPhase.thinking &&
        (event.type == 'planning' || event.type == 'executing')) {
      run.phase = TaskPhase.running;
    }
    if (event.type == 'awaiting') run.phase = TaskPhase.awaiting;
  }

  void _onResult(Map<String, dynamic> msg) {
    final requestId = msg['requestId'] as String? ?? '';
    final run = _runs[requestId] ?? (current?.requestId.isEmpty ?? false ? current : null);
    if (run == null) return;

    if (run.requestId.isEmpty) {
      run.requestId = requestId;
      _runs[requestId] = run;
    }

    run.status = msg['status'] as String?;
    run.summary = msg['summary'] as String?;
    run.finishedAt = DateTime.now().millisecondsSinceEpoch;

    // The core only offers this once a task has genuinely been repeated, so it
    // is worth surfacing rather than filing away.
    final suggest = msg['suggestSave'];
    if (suggest is Map) {
      saveSuggestion = SaveSuggestion(
        suggest['text'] as String? ?? '',
        suggest['times'] as int? ?? 0,
      );
    }

    // A replay changes the workflow's run count, so the list is now stale.
    if (msg['workflow'] != null) refreshWorkflows();
    run.phase = switch (run.status) {
      'COMPLETED' => TaskPhase.done,
      'CANCELLED' => TaskPhase.cancelled,
      _ => TaskPhase.failed,
    };

    if (!history.contains(run)) history.insert(0, run);
    _trimHistory();
  }

  void _trimHistory() {
    while (history.length > 50) {
      _runs.remove(history.removeLast().requestId);
    }
  }

  // ---- commands -----------------------------------------------------------

  void refreshWorkflows() => _send({'type': 'get_workflows'});

  void refreshHistory({String? query}) =>
      _send({'type': 'get_history', if (query != null && query.isNotEmpty) 'query': query});

  void refreshStats({int days = 7}) => _send({'type': 'get_stats', 'days': days});

  void saveLastAsWorkflow(String name) =>
      _send({'type': 'save_workflow', 'name': name});

  void deleteWorkflow(String name) => _send({'type': 'delete_workflow', 'name': name});

  /// Workflows run through the normal submit path so a replay passes the same
  /// Owner Gate, confirmation tiers and event stream as anything typed.
  void runWorkflow(SavedWorkflow workflow, List<String> args) {
    final quoted = args.map((a) => a.contains(' ') ? '"$a"' : a).join(' ');
    final suffix = quoted.isEmpty ? '' : ' $quoted';
    submit('run ${workflow.name}$suffix');
  }

  void submit(String text) {
    if (connection != CoreConnection.connected) return;
    current = TaskRun(
      requestId: '',
      prompt: text,
      startedAt: DateTime.now().millisecondsSinceEpoch,
    );
    _send({'type': 'submit', 'text': text});
    notifyListeners();
  }

  /// [verdict] is one of `approved`, `approved_session`, `handed_off`, `rejected`.
  /// The core re-checks the tier — a Tier 2 step never gets a session pass.
  void respond(ConfirmationRequest request, String verdict) {
    _send({
      'type': 'respond',
      'requestId': request.requestId,
      'stepId': request.stepId,
      'stepVersion': request.stepVersion,
      'verdict': verdict,
    });
    pending.remove(request.key);
    if (verdict == 'approved_session' && request.tier == 3) {
      _send({'type': 'get_status'});
    }
    notifyListeners();
  }

  void clearPreApprovals() {
    _send({'type': 'clear_preapprovals'});
  }

  void cancelCurrent() {
    final id = current?.requestId ?? '';
    if (id.isEmpty) return;
    _send({'type': 'cancel', 'requestId': id});
  }

  void setFullAccess(bool enabled) {
    lastNotice = enabled
        ? 'Requesting elevation — approve the Windows prompt.'
        : 'Removing the DEX service — approve the Windows prompt.';
    _send({'type': 'full_access', 'enabled': enabled});
    notifyListeners();
  }

  void loadEvidence(String requestId) {
    _send({'type': 'get_evidence', 'requestId': requestId});
  }

  void clearCurrent() {
    current = null;
    notifyListeners();
  }

  void dismissNotice() {
    lastNotice = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _reconnectTimer?.cancel();
    _sub?.cancel();
    _channel?.sink.close();
    super.dispose();
  }
}
