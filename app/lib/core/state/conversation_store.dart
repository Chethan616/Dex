// ChangeNotifier holding the live conversation, agent state, and the current
// pending Action Preview. The home screen listens to it and renders.
//
// We deliberately avoid a heavy state library (Riverpod/Bloc) per design.md
// section 9 "lightweight budget". A small ChangeNotifier is enough for v1.

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../gateway_client.dart';
import '../log.dart';
import '../models/action_preview.dart';
import '../models/action_step.dart';
import '../models/agent_state.dart';
import '../models/engine.dart';
import '../models/gateway_event.dart';
import '../models/message.dart';
import '../models/plan_step.dart';
import '../models/reminder.dart';
import '../models/tool_activity.dart';
import '../tool_registry.dart';

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

  // Reminders are in-memory only for v1; the real backend lands when
  // dex-core ships a `reminders.*` gateway namespace. The list is kept
  // ordered by due time ascending so the UI doesn't have to re-sort.
  final List<Reminder> _reminders = <Reminder>[];

  List<Reminder> get reminders => List<Reminder>.unmodifiable(_reminders);

  /// Add a new reminder. Inserts in due-order so the upcoming list
  /// reads naturally. Returns the created Reminder so callers can
  /// reference its id immediately (e.g. for an undo affordance).
  Reminder addReminder({required String text, required DateTime due}) {
    final r = Reminder(
      id: _uuid.v4(),
      text: text,
      due: due,
      createdAt: DateTime.now(),
    );
    final i = _reminders.indexWhere((other) => other.due.isAfter(due));
    if (i < 0) {
      _reminders.add(r);
    } else {
      _reminders.insert(i, r);
    }
    notifyListeners();
    return r;
  }

  /// Cancel by id. No-op if the id isn't found (e.g. double-cancel
  /// from an undo).
  void cancelReminder(String id) {
    final before = _reminders.length;
    _reminders.removeWhere((r) => r.id == id);
    if (_reminders.length != before) notifyListeners();
  }

  // Map runId -> message id so streaming deltas land in the right bubble.
  final Map<String, String> _streaming = <String, String>{};

  // Live task plan from the agent's `update_plan` tool. Replaced wholesale
  // on each update_plan call; cleared when a new human turn starts so the
  // checklist always reflects the current task.
  List<PlanStep> _plan = const <PlanStep>[];

  List<Message> get messages => List<Message>.unmodifiable(_messages);
  AgentState get state => _state;
  ActionPreview? get pending => _pending;

  /// The agent's current task plan (empty when there's no active plan).
  /// Drives the live checklist card so the user sees steps, not "thinking…".
  List<PlanStep> get plan => List<PlanStep>.unmodifiable(_plan);

  // -----------------------------------------------------------------
  // v1.2 Live Tool Activity tracking (rendered in the Live panel
  // straight from raw toolCall + toolResult events; no LLM tokens
  // spent narrating "I'm running command X").
  // -----------------------------------------------------------------
  static const int _activityBufferCap = 50;
  final List<ToolActivity> _activities = <ToolActivity>[];

  /// All known tool activities, most-recent first. The Live panel renders
  /// the currently-running one as a full card and shows the last few
  /// completed ones as collapsed rows. Bounded so a long session can't
  /// leak memory.
  List<ToolActivity> get activities =>
      List<ToolActivity>.unmodifiable(_activities);

  /// The most recent activity that's still running (if any). Drives the
  /// "currently running" card at the top of the Live panel.
  ToolActivity? get currentActivity {
    for (final a in _activities) {
      if (a.state == ToolActivityState.running) return a;
    }
    return null;
  }

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

  /// Test-only seam: inject a ToolActivity at the front of the list +
  /// notify. v1.2 Live panel renders these directly.
  @visibleForTesting
  void addActivityForTesting(ToolActivity a) {
    _activities.insert(0, a);
    notifyListeners();
  }

  // -----------------------------------------------------------------
  // User -> agent
  // -----------------------------------------------------------------
  Future<void> sendHumanMessage(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;

    // New turn → drop the previous task's plan checklist.
    _plan = const <PlanStep>[];

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

  /// True when an agent turn is in flight (we sent a chat.send and the
  /// final/aborted/error frame hasn't landed yet). Drives the Stop button
  /// visibility.
  bool get isBusy => _streaming.isNotEmpty || _state == AgentState.thinking ||
      _state == AgentState.acting || _state == AgentState.awaiting;

  /// The most-recent in-flight runId, or null if no turn is streaming.
  /// The Stop button passes this to `client.abort(runId: ...)` so the
  /// gateway only cancels the specific run, not the whole session.
  String? get currentRunId =>
      _streaming.isEmpty ? null : _streaming.keys.last;

  // -----------------------------------------------------------------
  // Stop the current turn / clear the conversation
  // -----------------------------------------------------------------

  /// Best-effort interrupt of the running agent turn. The gateway
  /// cancels the LLM stream immediately; a long-running tool subprocess
  /// (UFO² / browser-use) may not stop until its current step finishes,
  /// so we flip the UI state to error right away to be honest about
  /// what we know vs. what we hope.
  Future<void> stop() async {
    final runId = currentRunId;
    await _client.abort(runId: runId);
    // Flip any streaming bubble + running chip to a clean "stopped" state.
    for (final entry in _streaming.entries) {
      final idx = _messages.indexWhere((m) => m.id == entry.value);
      if (idx >= 0) {
        _messages[idx] = _messages[idx].copyWith(streaming: false);
      }
    }
    _streaming.clear();
    for (var i = 0; i < _messages.length; i++) {
      final m = _messages[i];
      if (m.speaker == MessageSpeaker.toolChip &&
          m.chipState == ToolChipState.running) {
        _messages[i] = m.copyWith(chipState: ToolChipState.failed);
      }
    }
    _pending = null;
    _lastPendingChipId = null;
    // v1.2: any running ActivityCard gets the abort state so the user sees
    // exactly which tool was interrupted.
    for (var i = 0; i < _activities.length; i++) {
      if (_activities[i].state == ToolActivityState.running) {
        _activities[i] = _activities[i].copyWith(
          state: ToolActivityState.aborted,
          ok: false,
          endedAt: DateTime.now(),
        );
      }
    }
    _setState(AgentState.idle);
    notifyListeners();
  }

  /// Wipe the visible conversation buffer. Does NOT clear the gateway's
  /// session memory -- the agent will still remember prior turns server-
  /// side until a future "reset session" call exists. This is purely the
  /// local view, so the user can get a clean canvas without restarting.
  void clearMessages() {
    _messages.clear();
    _streaming.clear();
    _toolByCallId.clear();
    _activities.clear();
    _lastPendingChipId = null;
    _pending = null;
    _setState(AgentState.idle);
    notifyListeners();
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
    if (p.isApprovalRequest) {
      try {
        await _client.request(
          'exec.approval.resolve',
          params: <String, dynamic>{
            'id': p.id,
            'decision': 'allow-once',
          },
        );
      } catch (e) {
        _setState(AgentState.error);
        _messages.add(Message(
          id: _uuid.v4(),
          speaker: MessageSpeaker.agent,
          ts: DateTime.now(),
          text: 'Failed to resolve approval: $e',
        ));
        notifyListeners();
      }
    } else {
      await _client.inject('Approved. Proceed with: ${p.title}');
    }
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
    if (p.isApprovalRequest) {
      try {
        await _client.request(
          'exec.approval.resolve',
          params: <String, dynamic>{
            'id': p.id,
            'decision': 'deny',
          },
        );
      } catch (e) {
        _messages.add(Message(
          id: _uuid.v4(),
          speaker: MessageSpeaker.agent,
          ts: DateTime.now(),
          text: 'Failed to deny approval: $e',
        ));
        notifyListeners();
      }
    } else {
      await _client.inject('Denied. Do not run: ${p.title}');
    }
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
      case GatewayEventKind.approvalRequested:
        _applyApprovalRequested(evt);
        break;
      case GatewayEventKind.error:
      case GatewayEventKind.aborted:
        _applyErrorOrAborted(evt);
        break;
      case GatewayEventKind.other:
        // synthetic res frames carry _correlationId; we ignore here, the
        // GatewayClient.sendMessage future handles them.
        break;
    }
  }

  /// Error / aborted frames must land VISIBLE text. Before this, the
  /// store only flipped the status pill to error -- a run killed by the
  /// gateway (watchdog abort, provider failure) showed the user nothing
  /// at all, which read as Dex silently ignoring the message.
  void _applyErrorOrAborted(GatewayEvent evt) {
    final aborted = evt.kind == GatewayEventKind.aborted;
    final detail = (evt.deltaText ?? '').trim();
    // Mirror to Diagnostics so a failed turn leaves a trace even after
    // the chat bubble scrolls away.
    if (aborted) {
      DexLog.w('agent', 'run aborted${detail.isEmpty ? '' : ': $detail'}');
    } else {
      DexLog.e('agent', 'turn error${detail.isEmpty ? '' : ': $detail'}');
    }
    // Quota/rate-limit is the most common failure on the free Gemini tier.
    // Give it an actionable message instead of a raw 429 dump.
    // Classify the failure into one clean, actionable message. The raw
    // provider detail (multi-model failure dump) is mirrored to Diagnostics
    // logs above — we deliberately keep it OUT of the chat bubble so the
    // user sees a fix, not a stack of provider errors.
    final lower = detail.toLowerCase();
    final isSuspended = !aborted &&
        (lower.contains('suspended') ||
            lower.contains('permission_denied') ||
            lower.contains('permission denied') ||
            lower.contains('api key not valid') ||
            lower.contains('(403)'));
    final isTooLarge = !aborted &&
        (lower.contains('request too large') ||
            lower.contains('tokens per minute') ||
            lower.contains('reduce your message') ||
            lower.contains('(413)') ||
            lower.contains('context length'));
    final isQuota = !aborted &&
        !isTooLarge &&
        (lower.contains('resource_exhausted') ||
            lower.contains('rate-limit') ||
            lower.contains('rate limit') ||
            lower.contains('quota') ||
            lower.contains('429'));
    final isProviderFail = !aborted &&
        !isQuota &&
        !isTooLarge &&
        !isSuspended &&
        (lower.contains('llm request failed') ||
            lower.contains('all models failed') ||
            lower.contains('no model') ||
            lower.contains('provider'));
    const groqHint =
        'Settings → Account → Secrets → set the Brain model to '
        '“Groq · Llama 4 Scout” (no daily limit), then restart the gateway '
        'in Settings → Diagnostics.';
    final text = aborted
        ? 'That run was stopped before it finished. Try sending it again.'
        : isSuspended
            ? 'Your model API key was rejected (expired, invalid, or '
                'suspended). $groqHint'
            : isTooLarge
                ? 'This conversation got too long for the model’s per-minute '
                    'token limit. Start a new chat to reset it — or switch to a '
                    'higher-limit brain model. $groqHint'
                : isQuota
                    ? 'The free Gemini tier’s daily quota is used up. Groq '
                        'resets every minute (no daily wall) — $groqHint'
                    : isProviderFail
                        ? "Dex couldn’t reach the model. Check your key and "
                            'selected model in Settings → Account → Secrets, '
                            'then restart the gateway in Settings → Diagnostics.'
                        : 'Something went wrong on that turn. Check Settings → '
                            'Diagnostics for details.';

    // Reuse the streaming bubble when one exists for this run -- the
    // partial text the agent managed to say stays, with the error line
    // appended below it.
    final agentId = _streaming.remove(evt.runId);
    final idx =
        agentId != null ? _messages.indexWhere((m) => m.id == agentId) : -1;
    if (idx >= 0) {
      final existing = _messages[idx];
      final current = (existing.text ?? '').trim();
      _messages[idx] = existing.copyWith(
        text: current.isEmpty ? text : '$current\n\n$text',
        streaming: false,
      );
    } else {
      _messages.add(Message(
        id: _uuid.v4(),
        speaker: MessageSpeaker.agent,
        ts: DateTime.now(),
        text: text,
      ));
    }
    _setState(aborted ? AgentState.idle : AgentState.error);
    notifyListeners();
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

    // update_plan is meta: it carries the agent's step checklist, not an
    // action. Feed the live plan card and skip the generic chip/activity so
    // it doesn't clutter the conversation as just another tool row.
    if (toolName == 'update_plan') {
      final argsMap = args is Map ? args : const {};
      final parsed = PlanStep.listFromArgs(argsMap['plan']);
      if (parsed.isNotEmpty) {
        _plan = parsed;
        _setState(AgentState.acting);
        notifyListeners();
      }
      return;
    }

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
    final engineId = engineForToolId(toolName);
    _messages.add(Message(
      id: chipId,
      speaker: MessageSpeaker.toolChip,
      ts: DateTime.now(),
      callId: callId,
      toolId: toolName,
      toolGoal: goalLabel,
      chipState: ToolChipState.running,
      engine: engineId,
    ));

    // v1.2 Live Tool Activity: append a running activity card the Live
    // panel renders straight from this event. The LLM doesn't have to
    // narrate "I'm running X" -- the user sees the args and (when the
    // result lands) the output, no extra tokens.
    final argsMap = args is Map ? Map<String, dynamic>.from(args) : null;
    _activities.insert(
      0,
      ToolActivity(
        callId: callId,
        toolId: toolName,
        displayName: descriptorFor(toolName).friendlyName,
        engine: engineId,
        args: argsMap,
        goalLabel: goalLabel,
        startedAt: DateTime.now(),
      ),
    );
    if (_activities.length > _activityBufferCap) {
      _activities.removeRange(_activityBufferCap, _activities.length);
    }
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

    // v1.2 Live Tool Activity: flip the matching activity card to done /
    // failed with the captured output. Pull every signal the result frame
    // carries: structured steps, summary, stdout, stderr, result text.
    _updateActivity(evt.runId, ok: ok, payload: payload, result: result);

    notifyListeners();
  }

  void _applyApprovalRequested(GatewayEvent evt) {
    final raw = evt.raw ?? const <String, dynamic>{};
    final payload = (raw['payload'] as Map?)?.cast<String, dynamic>() ?? const {};
    final id = payload['id'] as String? ?? '';
    final request = (payload['request'] as Map?)?.cast<String, dynamic>() ?? const {};
    final command = (request['command'] as String? ?? request['commandPreview'] as String? ?? '').trim();
    if (id.isEmpty || command.isEmpty) return;

    final warningText = (request['warningText'] as String?)?.trim() ?? '';
    final displayCommand = warningText.isNotEmpty ? '$warningText\n\n$command' : command;

    final step = ActionStep(
      text: displayCommand,
      state: ActionStepState.queued,
      ts: DateTime.now(),
    );

    _pending = ActionPreview(
      id: id,
      title: 'Command Execution Approval',
      appHint: 'Requires authorization to run',
      steps: [step],
      ts: DateTime.now(),
      isApprovalRequest: true,
    );
    _setState(AgentState.awaiting);
    notifyListeners();
  }

  void _updateActivity(
    String callId, {
    required bool ok,
    required Map<String, dynamic> payload,
    required Map<String, dynamic> result,
  }) {
    final idx = _activities.indexWhere((a) => a.callId == callId);
    if (idx < 0) return;
    final lines = <String>[];
    final steps = (result['steps'] as List?)?.cast<String>();
    if (steps != null) lines.addAll(steps);
    final stdoutText = (result['stdout'] ?? result['log'] ?? result['log_excerpt']) as String?;
    if (stdoutText != null && stdoutText.trim().isNotEmpty) {
      lines.addAll(stdoutText.split('\n').take(40));
    }
    final stderrText = result['stderr'] as String?;
    if (stderrText != null && stderrText.trim().isNotEmpty) {
      lines.add('--- stderr ---');
      lines.addAll(stderrText.split('\n').take(20));
    }
    final summary = (payload['summary'] ?? result['summary'] ?? result['text']) as String?;
    _activities[idx] = _activities[idx].copyWith(
      state: ok ? ToolActivityState.done : ToolActivityState.failed,
      ok: ok,
      endedAt: DateTime.now(),
      outputLines: lines.map((l) => l.length > 200 ? '${l.substring(0, 199)}…' : l).toList(),
      summary: summary,
    );
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
