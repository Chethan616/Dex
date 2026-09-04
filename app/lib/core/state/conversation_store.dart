// The live conversation, driven by the Dex core's step stream.
//
// This class kept its name and its entire public surface on purpose: nine
// files and roughly twelve thousand lines of UI read `messages`, `plan`,
// `activities`, `state` and `pending`, and none of them needed to change. What
// changed is where those come from.
//
// It used to consume an OpenClaw chat stream — delta, delta, delta,
// finalReply — where you learn what happened once it is over, and "steps" had
// to be inferred by pattern-matching the model's prose. It now consumes Dex's
// plan stream, where every step announces itself as it is selected, dispatched,
// executed and verified. That is the difference between a transcript of what
// an agent said and a view of what it did, and it is the whole reason for the
// rewire.
//
// The mapping, once:
//
//   planning   -> the task plan checklist          (PlanStep)
//   selecting  -> a new tool activity, running     (ToolActivity)
//   executing  -> that activity, still running
//   done       -> that activity, done + verified
//   failed     -> that activity, failed
//   awaiting   -> a confirmation card              (ActionPreview)
//   result     -> the agent's closing message      (Message)

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../dex_gateway.dart';
import '../log.dart';
import '../models/action_preview.dart';
import '../models/action_step.dart';
import '../models/agent_state.dart';
import '../models/engine.dart';
import '../models/artifact.dart';
import '../models/message.dart';
import '../models/plan_step.dart';
import '../models/reminder.dart';
import '../models/tool_activity.dart';
import '../attention.dart';

class ConversationStore extends ChangeNotifier {
  ConversationStore(this._client) {
    _sub = _client.frames.listen(_onFrame);
    // Opening a conversation is a request and a reply on the same socket, but
    // the reply is state on the client rather than a frame in the stream — so
    // this is where the reopened thread arrives.
    _client.addListener(_onClientChanged);
  }

  /// Which conversation the visible thread was last restored from, so a
  /// notification that changed something else does not rebuild it.
  String? _restoredFor;

  void _onClientChanged() {
    final opened = _client.openedConversationId;
    if (opened == null || opened != _conversationId) return;
    if (_restoredFor == opened) return;
    _restoredFor = opened;
    _restore(_client.openedMessages);
  }

  final DexGatewayClient _client;
  late final StreamSubscription<DexFrame> _sub;

  /// Exposed so widgets (the connection banner, diagnostics) can observe it.
  DexGatewayClient get client => _client;
  final _uuid = const Uuid();

  final List<Message> _messages = <Message>[];
  AgentState _state = AgentState.idle;
  ActionPreview? _pending;

  /// Approvals waiting to be answered, oldest first.
  ///
  /// A queue, not a slot, because the Orchestrator runs every step whose
  /// dependencies are satisfied **in parallel** — and a plan of a dozen
  /// independent `run_command` steps therefore raises a dozen cards at once.
  ///
  /// This held one. The other eleven were never shown, sat unanswered, and
  /// expired at their 120-second timeout: on screen that read as ten steps
  /// spontaneously failing at exactly "2m 0s" with no explanation, and the
  /// task stopping two steps from the end.
  final List<Map<String, dynamic>> _approvals = <Map<String, dynamic>>[];

  /// The one on screen — the head of the queue.
  Map<String, dynamic>? get _pendingRaw =>
      _approvals.isEmpty ? null : _approvals.first;

  /// How many are behind it, so the card can say so rather than springing
  /// another one on the owner each time they answer.
  int get approvalsWaiting => _approvals.length;

  /// Reminders, from the core.
  ///
  /// They used to live in `_reminders` on this object: created here, listed
  /// from memory, gone on restart, and never fired by anything. Now the core
  /// holds them and rings them — with a real Windows notification, so a
  /// reminder reaches the owner whether or not Dex is the window in front of
  /// them.
  List<Reminder> get reminders => [
        for (final row in _client.reminders) ?Reminder.tryParse(row),
      ];

  void refreshReminders() => _client.listReminders();

  void addReminder({required String text, required DateTime due}) {
    _client.setReminder(text, due);
  }

  void snoozeReminder(String id, {int minutes = 10}) =>
      _client.snoozeReminder(id, minutes: minutes);

  void completeReminder(String id) => _client.completeReminder(id);

  void cancelReminder(String id) => _client.deleteReminder(id);

  List<PlanStep> _plan = const <PlanStep>[];

  List<Message> get messages => List<Message>.unmodifiable(_messages);
  AgentState get state => _state;
  ActionPreview? get pending => _pending;
  List<PlanStep> get plan => List<PlanStep>.unmodifiable(_plan);

  static const int _activityBufferCap = 50;
  final List<ToolActivity> _activities = <ToolActivity>[];

  List<ToolActivity> get activities =>
      List<ToolActivity>.unmodifiable(_activities);

  ToolActivity? get currentActivity {
    for (final a in _activities) {
      if (a.state == ToolActivityState.running) return a;
    }
    return null;
  }

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

  /// Replay a stored thread, as the core would send it.
  @visibleForTesting
  void restoreForTesting(String id, List<Map<String, dynamic>> stored) {
    _conversationId = id;
    _restore(stored);
  }

  @visibleForTesting
  void addMessageForTesting(Message m) {
    _messages.add(m);
    notifyListeners();
  }

  @visibleForTesting
  void addActivityForTesting(ToolActivity a) {
    _activities.insert(0, a);
    notifyListeners();
  }

  /// Feed one frame in directly. Used by the widget tests to drive the store
  /// through a whole task without a running core.
  @visibleForTesting
  void applyFrameForTesting(DexFrame frame) => _onFrame(frame);

  // ---------------------------------------------------------------------------
  // Owner -> Dex
  // ---------------------------------------------------------------------------

  /// The thread these messages belong to.
  ///
  /// Created here rather than by the core, because only this side knows
  /// whether the owner is continuing or has started a new chat. Made lazily on
  /// the first message so opening the app and closing it again does not leave
  /// an empty conversation in the history.
  String? _conversationId;

  String get conversationId => _conversationId ??= _uuid.v4();

  /// Whether anything has been said in this thread yet.
  bool get isFresh => _messages.isEmpty;

  /// Start a new chat. The old one stays on disk; this just stops writing to it.
  void newConversation() {
    _conversationId = null;
    _client.conversationId = null;
    _restoredFor = null;
    _messages.clear();
    _plan = const <PlanStep>[];
    _activities.clear();
    _pending = null;
    _approvals.clear();
    _setState(AgentState.idle);
    notifyListeners();
  }

  /// Open a conversation from the history.
  ///
  /// This is the whole point of Phase 3. Clicking a row used to re-run the
  /// request — the only thing stored was the request, so re-running it was the
  /// only thing a click could mean. Now the thread comes back: every message,
  /// every step, as it was.
  Future<void> openConversation(String id) async {
    if (id.isEmpty) return;
    _conversationId = id;
    _client.conversationId = id;
    _restoredFor = null;

    _messages.clear();
    _plan = const <PlanStep>[];
    _activities.clear();
    _pending = null;
    _approvals.clear();
    _setState(AgentState.idle);
    notifyListeners();

    _client.openConversation(id);
  }

  /// Replace the visible thread with what the core sent back.
  void _restore(List<Map<String, dynamic>> stored) {
    _messages.clear();
    for (final row in stored) {
      final text = (row['text'] as String? ?? '').trim();
      if (text.isEmpty) continue;
      final detail = row['detail'] is Map
          ? Map<String, dynamic>.from(row['detail'] as Map)
          : const <String, dynamic>{};

      final speaker = switch (row['speaker'] as String? ?? '') {
        'human' => MessageSpeaker.human,
        'step' => MessageSpeaker.toolChip,
        _ => MessageSpeaker.agent,
      };

      _messages.add(Message(
        id: _uuid.v4(),
        speaker: speaker,
        ts: DateTime.fromMillisecondsSinceEpoch(
          (row['at'] as num?)?.toInt() ?? DateTime.now().millisecondsSinceEpoch,
        ),
        text: text,
        requestId: row['requestId'] as String?,
        // A reopened step keeps its verdict and its card. Without these the
        // thread comes back as prose with the evidence stripped out, which is
        // a summary of the conversation rather than the conversation.
        callId: speaker == MessageSpeaker.toolChip ? row['requestId'] as String? : null,
        toolId: detail['action'] as String?,
        toolGoal: detail['action'] as String?,
        chipState: speaker == MessageSpeaker.toolChip
            ? (detail['verification'] == 'FAILED'
                ? ToolChipState.failed
                : ToolChipState.done)
            : null,
        artifact: Artifact.tryParse(detail['artifact']),
      ));
    }
    notifyListeners();
  }

  Future<void> sendHumanMessage(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;

    // A new turn clears the previous task's checklist and step cards. Leaving
    // them would put the last task's progress under this task's question.
    _plan = const <PlanStep>[];
    _activities.clear();
    _pending = null;
    _approvals.clear();

    // Claims an id for this thread if it does not have one yet, so the core
    // knows which conversation to write the turn into.
    _client.conversationId = conversationId;

    _messages.add(Message(
      id: _uuid.v4(),
      speaker: MessageSpeaker.human,
      ts: DateTime.now(),
      text: trimmed,
    ));
    _setState(AgentState.thinking);
    notifyListeners();

    if (_client.connection != DexConnection.connected) {
      _say('The Dex core is not connected yet. It starts with the app — '
          'check the Logs if this does not clear.');
      _setState(AgentState.error);
      return;
    }

    _client.submit(trimmed);
  }

  /// True while a turn is in flight. Drives the Stop button.
  bool get isBusy =>
      _state == AgentState.thinking ||
      _state == AgentState.acting ||
      _state == AgentState.awaiting;

  String? get currentRunId => _client.currentRequestId;

  Future<void> stop() async {
    _client.cancel();
    _say('Stopping…');
  }

  /// Wipe the screen without ending the thread.
  ///
  /// Distinct from `newConversation`, which starts a new one. This is for
  /// clearing a view; that is for starting a chat.
  void clearMessages() {
    _messages.clear();
    _activities.clear();
    _plan = const <PlanStep>[];
    _pending = null;
    _approvals.clear();
    _setState(AgentState.idle);
    notifyListeners();
  }

  // ---------------------------------------------------------------------------
  // Approvals
  // ---------------------------------------------------------------------------

  Future<void> approve() async => _respond('approved');

  Future<void> deny() async => _respond('rejected');

  /// Approve, and stop asking for this kind of step for the rest of the
  /// session. The core refuses this for anything above Tier 3, so offering it
  /// here cannot widen what a session pass covers.
  Future<void> approveForSession() async => _respond('approved_session');

  Future<void> _respond(String verdict) async {
    final raw = _pendingRaw;
    if (raw == null) return;

    _client.respond(
      requestId: raw['requestId'] as String? ?? '',
      stepId: raw['stepId'] as String? ?? '',
      // Sent back exactly as received. It is a hash of the step the owner was
      // shown, and the core compares it before acting.
      stepVersion: raw['stepVersion'] as String? ?? '',
      verdict: verdict,
    );

    _approvals.removeAt(0);
    // Straight on to the next one. They are all waiting on their own timers,
    // so a pause between cards is a step quietly expiring.
    _showHead();
    _setState(_approvals.isEmpty ? AgentState.acting : AgentState.awaiting);
    notifyListeners();
  }

  /// Answer every queued approval the same way.
  ///
  /// The honest alternative to clicking Approve twelve times when a plan
  /// fans out. It is still one verdict per step — each carries its own step
  /// version and the core re-checks every one — so this is a shortcut through
  /// the clicking, not through the checking.
  Future<void> approveAll() async {
    while (_approvals.isNotEmpty) {
      await _respond('approved');
    }
  }

  // ---------------------------------------------------------------------------
  // Dex -> owner
  // ---------------------------------------------------------------------------

  void _onFrame(DexFrame frame) {
    switch (frame.kind) {
      case DexFrameKind.step:
        _applyStep(frame);
        break;
      case DexFrameKind.confirmation:
        _applyConfirmation(frame);
        break;
      case DexFrameKind.confirmationClosed:
        // A card can be withdrawn from anywhere in the queue — it may have
        // expired, or the task may have been cancelled — so this cannot just
        // check the head.
        _approvals.removeWhere((a) =>
            a['requestId'] == frame.requestId && a['stepId'] == frame.stepId);
        _showHead();
        if (_approvals.isEmpty) _setState(AgentState.acting);
        notifyListeners();
        break;
      case DexFrameKind.result:
        _applyResult(frame);
        break;
      case DexFrameKind.error:
        _activeRequestId = frame.requestId;
        _say(frame.message);
        _setState(AgentState.error);
        break;
    }
  }

  /// A correlation key that is unique across tasks.
  ///
  /// Step ids are `step_1`, `step_2` … *per request*, so keying a card on the
  /// bare step id makes the next task's first step reach back and update the
  /// last task's first card. Seen on screen: two chips from a failed run
  /// flipped to "done" when an unrelated task started.
  String _key(DexFrame frame) => '${frame.requestId}:${frame.stepId}';

  void _applyStep(DexFrame frame) {
    switch (frame.type) {
      case 'thinking':
      case 'routing':
        _setState(AgentState.thinking);
        break;

      // The plan, the moment it exists. This is the checklist the owner
      // watches — it arrives before any work starts, which is the difference
      // between showing progress and reporting it afterwards.
      case 'planning':
        _plan = _planFrom(frame.dataMap);
        _setState(AgentState.acting);
        break;

      // A step was chosen. One card per step, created here rather than when it
      // finishes, so a slow step is visible while it is slow.
      case 'selecting':
        if (frame.stepId != null) {
          _beginActivity(frame);
          _markPlan(frame.stepId!, PlanStepStatus.inProgress);
        }
        _setState(AgentState.acting);
        break;

      case 'dispatching':
      case 'executing':
      case 'retrying':
        if (frame.stepId != null) _appendOutput(_key(frame), frame.message);
        _setState(AgentState.acting);
        break;

      case 'awaiting':
        _setState(AgentState.awaiting);
        // A hand-off: a password or a CAPTCHA, which Dex never does itself.
        // The task is stopped until the owner acts, so it says so where they
        // are rather than where they are not.
        unawaited(Attention.needed(reason: 'Dex needs you to do something'));
        break;

      case 'done':
        if (frame.stepId != null) {
          // A step finished. The message carries the verification — "read back
          // as 35%", "Window open: Calculator" — which is the sentence worth
          // keeping on the card.
          _finishActivity(
            _key(frame),
            ok: true,
            summary: frame.message,
            artifact: Artifact.tryParse((frame.dataMap ?? const {})['artifact']),
          );
          _markPlan(frame.stepId!, PlanStepStatus.completed);
        } else {
          // No step id: this is the task's closing line. The result frame
          // carries the same text and is the one that ends the turn, so this
          // is left to it rather than saying it twice.
        }
        break;

      case 'failed':
        if (frame.stepId != null) {
          _finishActivity(_key(frame), ok: false, summary: frame.message);
          // Not `completed`. A step that failed is finished, but saying so
          // with the same tick as a step that worked is the display lying
          // about the outcome.
          _markPlan(frame.stepId!, PlanStepStatus.failed);
        } else {
          _say(frame.message);
          _setState(AgentState.error);
        }
        break;

      case 'cancelled':
        _setState(AgentState.idle);
        break;

      default:
        break;
    }
    notifyListeners();
  }

  void _applyConfirmation(DexFrame frame) {
    final raw = frame.dataMap;
    if (raw == null) return;

    // Queued, not replaced. Replacing is what lost eleven of twelve.
    final key = '${raw['requestId']}:${raw['stepId']}';
    if (_approvals.any((a) => '${a['requestId']}:${a['stepId']}' == key)) return;
    _approvals.add(raw);

    _showHead();
    notifyListeners();

    // A question that blocks a task, asked of someone who is almost certainly
    // looking at the browser Dex is driving. Leaving it behind three windows
    // means the task waits until they happen to come back and find it.
    //
    // Safe because of WindowActivity: raising a window on Windows injects a
    // click at the cursor, and a control arms only once the pointer has moved
    // since the raise — so the card cannot answer itself.
    unawaited(Attention.needed(reason: 'a confirmation is waiting'));
  }

  /// Put the head of the approval queue on screen.
  void _showHead() {
    final raw = _pendingRaw;
    if (raw == null) {
      _pending = null;
      return;
    }

    _pending = ActionPreview(
      id: '${raw['requestId']}:${raw['stepId']}',
      title: raw['summary'] as String? ?? 'Approval needed',
      appHint: raw['capability'] as String?,
      isApprovalRequest: true,
      ts: DateTime.now(),
      steps: [
        ActionStep(
          text: _describeStep(raw),
          state: ActionStepState.queued,
          ts: DateTime.now(),
        ),
      ],
    );
    _setState(AgentState.awaiting);
  }

  void _applyResult(DexFrame frame) {
    final data = frame.dataMap ?? const {};
    final status = data['status'] as String? ?? 'COMPLETED';

    // Any step still marked running when the task ends did not report a
    // terminal event. Leaving a spinner on screen forever is worse than
    // admitting the outcome is unknown.
    for (var i = 0; i < _activities.length; i++) {
      if (_activities[i].state == ToolActivityState.running) {
        _activities[i] = _activities[i].copyWith(
          state: status == 'CANCELLED'
              ? ToolActivityState.aborted
              : ToolActivityState.done,
          endedAt: DateTime.now(),
          ok: status == 'COMPLETED',
        );
      }
    }

    if (frame.message.trim().isNotEmpty) _say(frame.message);

    _setState(switch (status) {
      'FAILED' => AgentState.error,
      'CANCELLED' => AgentState.idle,
      _ => AgentState.idle,
    });
    notifyListeners();
  }

  // ---------------------------------------------------------------------------
  // Building what the UI renders
  // ---------------------------------------------------------------------------

  void _say(String text, {String? requestId}) {
    _messages.add(Message(
      id: _uuid.v4(),
      speaker: MessageSpeaker.agent,
      ts: DateTime.now(),
      text: text,
      // Which task this line is about, so a thumbs-up has something to attach
      // to. Absent for Dex's own housekeeping lines, which are not a task.
      requestId: requestId ?? _activeRequestId,
    ));
    notifyListeners();
  }

  /// The task currently running, for attributing feedback and retries.
  String? _activeRequestId;


  List<PlanStep> _planFrom(Map<String, dynamic>? data) {
    final steps = data?['steps'];
    if (steps is! List) return const <PlanStep>[];
    return steps
        .whereType<Map>()
        .map((s) => PlanStep(
              label: _labelFor(Map<String, dynamic>.from(s)),
              status: PlanStepStatus.pending,
            ))
        .toList();
  }

  /// A step, described the way a person would say it.
  ///
  /// `set_volume {level: 35}` reads as "set volume — level 35". The raw action
  /// name and its JSON are on the card underneath; this is the line in the
  /// checklist, and it should be readable at a glance.
  String _labelFor(Map<String, dynamic> step) {
    final action = (step['action'] as String? ?? '').replaceAll('_', ' ');
    final params = step['params'];
    if (params is Map && params.isNotEmpty) {
      final shown = params.entries
          .take(2)
          .map((e) => '${e.key} ${e.value}')
          .join(', ');
      return '$action — $shown';
    }
    return action.isEmpty ? 'step' : action;
  }

  void _markPlan(String stepId, PlanStepStatus status) {
    // Plan steps arrive in order and step ids are `step_1`, `step_2`… so the
    // trailing number is the index. When it is not — a planner naming steps
    // `step_4_wait_settings` — the first pending entry is advanced instead,
    // which keeps the checklist moving rather than freezing on a name mismatch.
    //
    // The *last* number, not the first. A repaired plan numbers its steps
    // `step_1_step_1` and `step_1_step_2`, and taking the first match read
    // both as step one: the second step ran, finished, and the checklist sat
    // at 1/2 with a hollow circle next to work that was already done. A
    // progress display that under-reports is worse than none, because it
    // looks like something is stuck.
    final numbers = RegExp(r'(\d+)').allMatches(stepId).toList();
    final index = numbers.isNotEmpty
        ? int.parse(numbers.last.group(1)!) - 1
        : -1;

    if (index >= 0 && index < _plan.length) {
      _plan = [
        for (var i = 0; i < _plan.length; i++)
          i == index ? PlanStep(label: _plan[i].label, status: status) : _plan[i],
      ];
      return;
    }

    final pending = _plan.indexWhere((s) =>
        s.status != PlanStepStatus.completed && s.status != PlanStepStatus.failed);
    if (pending == -1) return;
    _plan = [
      for (var i = 0; i < _plan.length; i++)
        i == pending ? PlanStep(label: _plan[i].label, status: status) : _plan[i],
    ];
  }

  void _beginActivity(DexFrame frame) {
    final data = frame.dataMap ?? const {};
    final action = data['action'] as String? ?? 'step';
    final capability = data['capability'] as String? ?? '';

    final key = _key(frame);
    if (_activities.any((a) => a.callId == key)) return;

    _activities.insert(
      0,
      ToolActivity(
        callId: key,
        toolId: action,
        displayName: action.replaceAll('_', ' '),
        engine: _engineFor(capability),
        goalLabel: frame.message,
        startedAt: DateTime.now(),
      ),
    );
    while (_activities.length > _activityBufferCap) {
      _activities.removeLast();
    }

    _messages.add(Message(
      id: _uuid.v4(),
      speaker: MessageSpeaker.toolChip,
      ts: DateTime.now(),
      callId: key,
      toolId: action,
      toolGoal: frame.message,
      chipState: ToolChipState.running,
      engine: _engineFor(capability),
    ));
  }

  void _appendOutput(String stepId, String line) {
    final at = _activities.indexWhere((a) => a.callId == stepId);
    if (at == -1 || line.trim().isEmpty) return;
    final activity = _activities[at];
    if (activity.outputLines.contains(line)) return;
    _activities[at] = activity.copyWith(
      outputLines: [...activity.outputLines, line],
    );
  }

  void _finishActivity(
    String stepId, {
    required bool ok,
    String? summary,
    Artifact? artifact,
  }) {
    final at = _activities.indexWhere((a) => a.callId == stepId);
    if (at != -1) {
      _activities[at] = _activities[at].copyWith(
        state: ok ? ToolActivityState.done : ToolActivityState.failed,
        ok: ok,
        endedAt: DateTime.now(),
        summary: summary,
      );
    }

    for (var i = _messages.length - 1; i >= 0; i--) {
      final m = _messages[i];
      if (m.speaker == MessageSpeaker.toolChip && m.callId == stepId) {
        _messages[i] = Message(
          id: m.id,
          speaker: m.speaker,
          ts: m.ts,
          callId: m.callId,
          toolId: m.toolId,
          toolGoal: m.toolGoal,
          engine: m.engine,
          chipState: ok ? ToolChipState.done : ToolChipState.failed,
          artifact: artifact,
        );
        break;
      }
    }
  }

  /// Which engine a capability routes through, for the pill on the card.
  ///
  /// Dex's tiers map onto the engine labels this UI already draws: OS and file
  /// work is the shell tier, application control is UI Automation, the web is
  /// the browser, and vision is the screen parser.
  EngineId? _engineFor(String capability) => switch (capability) {
        'can_control_os' || 'can_control_files' || 'can_deliver' => EngineId.shell,
        'can_control_app' => EngineId.ufoUia,
        'can_browse_web' => EngineId.browserUse,
        'can_control_gui' => EngineId.omniparser,
        _ => null,
      };

  String _describeStep(Map<String, dynamic> raw) {
    final action = (raw['action'] as String? ?? '').replaceAll('_', ' ');
    final params = raw['params'];
    if (params is Map && params.isNotEmpty) {
      final shown =
          params.entries.map((e) => '${e.key}=${e.value}').take(4).join('  ');
      return '$action  $shown';
    }
    return action;
  }

  void _setState(AgentState s) {
    if (_state == s) return;
    _state = s;
    DexLog.i('store', 'state -> ${s.name}');
  }

  @override
  void dispose() {
    _sub.cancel();
    _client.removeListener(_onClientChanged);
    super.dispose();
  }
}
