// ChangeNotifier holding the live conversation, agent state, and the current
// pending Action Preview. The home screen listens to it and renders.
//
// We deliberately avoid a heavy state library (Riverpod/Bloc) per design.md
// section 9 "lightweight budget". A small ChangeNotifier is enough for v1.

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../gateway_client.dart';
import '../models/action_preview.dart';
import '../models/action_step.dart';
import '../models/agent_state.dart';
import '../models/engine.dart';
import '../models/gateway_event.dart';
import '../models/message.dart';

class ConversationStore extends ChangeNotifier {
  ConversationStore(this._client) {
    _sub = _client.events.listen(_onEvent);
  }

  final GatewayClient _client;
  late final StreamSubscription<GatewayEvent> _sub;

  /// Exposed so widgets (e.g. ConnectionBanner) can observe connection state.
  GatewayClient get client => _client;
  final _uuid = const Uuid();

  final List<Message> _messages = <Message>[];
  AgentState _state = AgentState.idle;
  ActionPreview? _pending;

  // Map runId -> message id so streaming deltas land in the right bubble.
  final Map<String, String> _streaming = <String, String>{};

  List<Message> get messages => List<Message>.unmodifiable(_messages);
  AgentState get state => _state;
  ActionPreview? get pending => _pending;

  /// Most-recent running tool-chip message, or `null` when nothing is
  /// currently running. The Live panel uses this to render the "currently
  /// routing through engine X" card while [state] is `acting`. Cheap O(n)
  /// scan — the chip list per turn is small.
  Message? get runningEngineChip {
    for (var i = _messages.length - 1; i >= 0; i--) {
      final m = _messages[i];
      if (m.speaker == MessageSpeaker.toolChip &&
          m.chipState == ToolChipState.running) {
        return m;
      }
    }
    return null;
  }

  /// Test-only seam: append a message + notify, without a gateway round-trip.
  /// Production code paths must go through `_onEvent` so streaming
  /// correlation IDs stay consistent; this exists purely so widget tests
  /// can put the store into a known visual state.
  @visibleForTesting
  void addMessageForTesting(Message m) {
    _messages.add(m);
    notifyListeners();
  }

  // -----------------------------------------------------------------
  // User -> agent
  // -----------------------------------------------------------------
  Future<void> sendHumanMessage(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;

    _messages.add(Message(
      id: _uuid.v4(),
      speaker: MessageSpeaker.human,
      ts: DateTime.now(),
      text: trimmed,
    ));
    _setState(AgentState.thinking);
    notifyListeners();

    try {
      final runId = await _client.sendMessage(trimmed);
      // Reserve a streaming agent bubble for this runId.
      final agentId = _uuid.v4();
      _streaming[runId] = agentId;
      _messages.add(Message(
        id: agentId,
        speaker: MessageSpeaker.agent,
        ts: DateTime.now(),
        text: '',
        streaming: true,
      ));
      notifyListeners();
    } catch (e) {
      _messages.add(Message(
        id: _uuid.v4(),
        speaker: MessageSpeaker.agent,
        ts: DateTime.now(),
        text: 'gateway error: $e',
      ));
      _setState(AgentState.error);
      notifyListeners();
    }
  }

  // -----------------------------------------------------------------
  // Approval / denial of a pending Action Preview
  // -----------------------------------------------------------------
  Future<void> approve() async {
    final p = _pending;
    if (p == null) return;
    _pending = null;
    _setState(AgentState.acting);
    notifyListeners();
    await _client.inject('Approved. Proceed with: ${p.title}');
  }

  Future<void> deny() async {
    final p = _pending;
    if (p == null) return;
    _pending = null;
    // Flip the most-recent pending chip to "denied" so the conversation
    // surface reflects the user's choice. v1.1 plan 9.4.
    final chipId = _lastPendingChipId;
    if (chipId != null) {
      final idx = _messages.indexWhere((m) => m.id == chipId);
      if (idx >= 0) {
        _messages[idx] = _messages[idx].copyWith(chipState: ToolChipState.denied);
      }
      _lastPendingChipId = null;
    }
    _setState(AgentState.idle);
    notifyListeners();
    await _client.inject('Denied. Do not run: ${p.title}');
  }

  // -----------------------------------------------------------------
  // Gateway events -> conversation
  // -----------------------------------------------------------------
  void _onEvent(GatewayEvent evt) {
    switch (evt.kind) {
      case GatewayEventKind.delta:
        _applyDelta(evt);
        break;
      case GatewayEventKind.finalReply:
        _applyFinal(evt);
        break;
      case GatewayEventKind.toolCall:
        _applyToolCall(evt);
        break;
      case GatewayEventKind.toolResult:
        _applyToolResult(evt);
        break;
      case GatewayEventKind.error:
      case GatewayEventKind.aborted:
        _setState(AgentState.error);
        notifyListeners();
        break;
      case GatewayEventKind.other:
        // synthetic res frames carry _correlationId; we ignore here, the
        // GatewayClient.sendMessage future handles them.
        break;
    }
  }

  void _applyDelta(GatewayEvent evt) {
    final agentId = _streaming[evt.runId];
    if (agentId == null || evt.deltaText == null) return;
    final idx = _messages.indexWhere((m) => m.id == agentId);
    if (idx < 0) return;
    final existing = _messages[idx];
    _messages[idx] = existing.copyWith(
      text: (existing.text ?? '') + (evt.deltaText ?? ''),
      streaming: true,
    );
    // Detect a pending preview heuristically from the streaming text.
    _maybeExtractPreview(_messages[idx]);
    notifyListeners();
  }

  void _applyFinal(GatewayEvent evt) {
    final agentId = _streaming.remove(evt.runId);
    if (agentId != null) {
      final idx = _messages.indexWhere((m) => m.id == agentId);
      if (idx >= 0) {
        final existing = _messages[idx];
        // If the final frame carries text and we accumulated nothing during
        // streaming (e.g. backend buffered the whole reply), use the final
        // text. Otherwise the existing text wins -- a no-op append.
        final hasFinalText = (evt.deltaText ?? '').isNotEmpty;
        final currentText = existing.text ?? '';
        final newText = (currentText.isEmpty && hasFinalText)
            ? evt.deltaText!
            : currentText;
        _messages[idx] = existing.copyWith(text: newText, streaming: false);
      }
    }
    if (_pending == null && _state != AgentState.awaiting) {
      _setState(AgentState.idle);
    }
    notifyListeners();
  }

  // callId -> (chipMessageId, actionMessageId) so chip + Action card flip
  // together when the matching tool result arrives. callId is the runId
  // from the gateway event when present, else a synthesized one.
  final Map<String, _ToolCorrelation> _toolByCallId = <String, _ToolCorrelation>{};

  // Track the most recently-emitted chip so deny() (Action Preview denial)
  // can flip its state, per v1.1 plan section 9.4.
  String? _lastPendingChipId;

  void _applyToolCall(GatewayEvent evt) {
    _setState(AgentState.acting);
    final raw = evt.raw ?? const <String, dynamic>{};
    final payload = (raw['payload'] as Map?)?.cast<String, dynamic>() ?? const {};
    final toolName = (payload['name'] ?? payload['toolName'] ?? payload['tool'] ?? raw['event']) as String? ?? 'tool';
    final args = payload['args'] ?? payload['arguments'] ?? payload['params'];
    final goalLabel = _summarizeArgs(toolName, args);

    final callId = evt.runId.isNotEmpty ? evt.runId : _uuid.v4();
    final chipId = _uuid.v4();
    final actionId = _uuid.v4();
    _toolByCallId[callId] = _ToolCorrelation(chipId: chipId, actionId: actionId);
    _lastPendingChipId = chipId;

    // CHIP first (the Gemini-style "selecting tool X" announcement). The
    // Action card follows immediately so the rich step list still has its
    // own home in the conversation.
    //
    // engine is inferred from toolName via engineForToolId() until the
    // gateway emits a structured engineAttempt frame (C.7+).
    _messages.add(Message(
      id: chipId,
      speaker: MessageSpeaker.toolChip,
      ts: DateTime.now(),
      callId: callId,
      toolId: toolName,
      toolGoal: goalLabel,
      chipState: ToolChipState.running,
      engine: engineForToolId(toolName),
    ));
    _messages.add(Message(
      id: actionId,
      speaker: MessageSpeaker.action,
      ts: DateTime.now(),
      callId: callId,
      steps: <ActionStep>[
        ActionStep(
          text: goalLabel,
          state: ActionStepState.running,
          ts: DateTime.now(),
        ),
      ],
    ));
    notifyListeners();
  }

  void _applyToolResult(GatewayEvent evt) {
    final raw = evt.raw ?? const <String, dynamic>{};
    final payload = (raw['payload'] as Map?)?.cast<String, dynamic>() ?? const {};
    final ok = (payload['ok'] ?? payload['success'] ?? true) == true;

    final corr = _toolByCallId.remove(evt.runId);
    if (corr != null) {
      // Flip the chip.
      final chipIdx = _messages.indexWhere((m) => m.id == corr.chipId);
      if (chipIdx >= 0) {
        _messages[chipIdx] = _messages[chipIdx].copyWith(
          chipState: ok ? ToolChipState.done : ToolChipState.failed,
        );
      }
      if (_lastPendingChipId == corr.chipId) _lastPendingChipId = null;

      // Flip the matching Action card's step(s).
      final actIdx = _messages.indexWhere((m) => m.id == corr.actionId);
      if (actIdx >= 0) {
        final existing = _messages[actIdx];
        final steps = (existing.steps ?? const [])
            .map((s) => s.state == ActionStepState.running
                ? s.withState(ok ? ActionStepState.done : ActionStepState.failed)
                : s)
            .toList(growable: false);
        _messages[actIdx] = existing.copyWith(steps: steps);
      }
    }

    // If the tool result carried structured step text (UFO² / browser-use
    // return these in `result.steps`), append a fresh card listing each.
    final result = (payload['result'] as Map?)?.cast<String, dynamic>() ?? const {};
    final structured = (result['steps'] as List?)?.cast<String>() ?? const <String>[];
    if (structured.isNotEmpty) {
      _messages.add(Message(
        id: _uuid.v4(),
        speaker: MessageSpeaker.action,
        ts: DateTime.now(),
        steps: structured
            .map((t) => ActionStep(
                  text: t,
                  state: ActionStepState.done,
                  ts: DateTime.now(),
                ))
            .toList(growable: false),
      ));
    }

    notifyListeners();
  }

  static const _toolLabelMax = 80;

  String _summarizeArgs(String toolName, dynamic args) {
    String hint;
    if (args is Map) {
      final keys = ['goal', 'command', 'cmd', 'path', 'url', 'message', 'query', 'name'];
      String? picked;
      for (final k in keys) {
        final v = args[k];
        if (v is String && v.trim().isNotEmpty) { picked = v.trim(); break; }
      }
      hint = picked ?? '';
    } else if (args is String) {
      hint = args;
    } else {
      hint = '';
    }
    final base = hint.isEmpty ? toolName : '$toolName  -  $hint';
    return base.length > _toolLabelMax
        ? '${base.substring(0, _toolLabelMax - 1)}...'
        : base;
  }

  // Heuristic v1 preview extractor. We were too aggressive before -- any
  // "approve?" in the middle of a paragraph would pop a modal-like card.
  // Stricter rules now:
  //   1. Reply must end with an explicit ask ("approve?" / "shall I proceed?")
  //      AND the trailing 200 chars must contain at least 2 numbered/bullet steps.
  //   2. Reply must NOT have already produced tool output (i.e. streaming).
  // This still misfires sometimes; the real fix is an MCP-side gate (Phase 7).
  static final RegExp _approvalCue = RegExp(
    r'(?:approve\??|shall i (?:proceed|continue|go ahead)\??|should i (?:proceed|continue)\??|confirm to proceed\??)\s*$',
    caseSensitive: false,
  );
  static final RegExp _stepLine = RegExp(r'^[\s]*(?:[-*]|\d+\.)\s+(.+)$', multiLine: true);

  void _maybeExtractPreview(Message m) {
    if (_pending != null) return; // one preview at a time
    final text = (m.text ?? '').trimRight();
    if (text.length < 40) return;
    final tail = text.length > 240 ? text.substring(text.length - 240) : text;
    if (!_approvalCue.hasMatch(tail)) return;

    final steps = _stepLine
        .allMatches(text)
        .map((mm) => mm.group(1)?.trim() ?? '')
        .where((s) => s.isNotEmpty && s.length < 200)
        .toList(growable: false);
    if (steps.length < 2) return;

    _pending = ActionPreview(
      id: _uuid.v4(),
      title: _deriveTitle(text),
      steps: steps
          .map((t) => ActionStep(
                text: t,
                state: ActionStepState.queued,
                ts: DateTime.now(),
              ))
          .toList(growable: false),
      ts: DateTime.now(),
    );
    _setState(AgentState.awaiting);
  }

  String _deriveTitle(String text) {
    // First non-empty line, truncated.
    for (final line in text.split('\n')) {
      final t = line.trim();
      if (t.isEmpty) continue;
      return t.length > 80 ? '${t.substring(0, 77)}...' : t;
    }
    return 'Pending action';
  }

  void _setState(AgentState s) {
    if (_state != s) _state = s;
  }

  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }
}

/// Internal mapping of a single MCP tool call's chip + Action card so the
/// gateway's matching tool-result frame can flip both atomically.
class _ToolCorrelation {
  final String chipId;
  final String actionId;
  const _ToolCorrelation({required this.chipId, required this.actionId});
}
