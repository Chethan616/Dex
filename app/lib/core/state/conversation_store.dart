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
import '../models/gateway_event.dart';
import '../models/message.dart';

class ConversationStore extends ChangeNotifier {
  ConversationStore(this._client) {
    _sub = _client.events.listen(_onEvent);
  }

  final GatewayClient _client;
  late final StreamSubscription<GatewayEvent> _sub;
  final _uuid = const Uuid();

  final List<Message> _messages = <Message>[];
  AgentState _state = AgentState.idle;
  ActionPreview? _pending;

  // Map runId -> message id so streaming deltas land in the right bubble.
  final Map<String, String> _streaming = <String, String>{};

  List<Message> get messages => List<Message>.unmodifiable(_messages);
  AgentState get state => _state;
  ActionPreview? get pending => _pending;

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
        _messages[idx] = _messages[idx].copyWith(streaming: false);
      }
    }
    if (_pending == null && _state != AgentState.awaiting) {
      _setState(AgentState.idle);
    }
    notifyListeners();
  }

  void _applyToolCall(GatewayEvent evt) {
    // The agent is about to call run_desktop_task. Phase 7 will use this
    // event to enforce the approval gate at the protocol layer. v1 relies
    // on the chat-layer preview parsed from the streaming reply.
    _setState(AgentState.acting);
    notifyListeners();
  }

  void _applyToolResult(GatewayEvent evt) {
    // Render the tool's structured output as an action card.
    final raw = evt.raw ?? const <String, dynamic>{};
    final result = (raw['result'] as Map?)?.cast<String, dynamic>() ?? const {};
    final steps = (result['steps'] as List?)?.cast<String>() ?? const <String>[];
    if (steps.isEmpty) return;
    _messages.add(Message(
      id: _uuid.v4(),
      speaker: MessageSpeaker.action,
      ts: DateTime.now(),
      steps: steps
          .map((t) => ActionStep(
                text: t,
                state: ActionStepState.done,
                ts: DateTime.now(),
              ))
          .toList(growable: false),
    ));
    _setState(AgentState.idle);
    notifyListeners();
  }

  // Heuristic v1 preview extractor: when the agent's streaming reply ends
  // in something like "Approve?" or "approve to continue", and contains
  // bullet/numbered steps, build an ActionPreview.
  static final RegExp _approvalCue = RegExp(
    r'\b(approve|approve\?|confirm|approve to (continue|run|proceed))\b\s*\??\s*$',
    caseSensitive: false,
    multiLine: true,
  );
  static final RegExp _stepLine = RegExp(r'^[\s]*(?:[-*]|\d+\.)\s+(.+)$', multiLine: true);

  void _maybeExtractPreview(Message m) {
    final text = m.text ?? '';
    if (!_approvalCue.hasMatch(text.trim())) return;
    final steps = _stepLine
        .allMatches(text)
        .map((mm) => mm.group(1)?.trim() ?? '')
        .where((s) => s.isNotEmpty)
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
