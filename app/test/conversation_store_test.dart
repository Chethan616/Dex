import 'package:dex/core/dex_gateway.dart';
import 'package:dex/core/models/agent_state.dart';
import 'package:dex/core/models/message.dart';
import 'package:dex/core/models/plan_step.dart';
import 'package:dex/core/models/tool_activity.dart';
import 'package:dex/core/state/conversation_store.dart';
import 'package:flutter_test/flutter_test.dart';

/// The store turns Dex's plan stream into what this app draws.
///
/// The whole reason for the rewire is on this page: the owner wanted to watch
/// steps happen, not read a summary once they were over. So these check that a
/// step is on screen *while it runs* — a card that only appears at the end is
/// the failure being fixed, and it would pass any test that only looked at the
/// final state.
DexFrame step(
  String type, {
  String request = 'req-1',
  String? stepId,
  String message = '',
  Object? data,
}) =>
    DexFrame(
      kind: DexFrameKind.step,
      type: type,
      message: message,
      requestId: request,
      stepId: stepId,
      data: data,
    );

void main() {
  late ConversationStore store;

  setUp(() => store = ConversationStore(DexGatewayClient()));
  tearDown(() => store.dispose());

  test('the plan appears before any work starts', () {
    store.applyFrameForTesting(step('planning', message: 'Plan', data: {
      'steps': [
        {'action': 'get_volume', 'params': <String, dynamic>{}},
        {'action': 'set_volume', 'params': {'level': 35}},
      ],
    }));

    expect(store.plan, hasLength(2));
    expect(store.plan[0].label, 'get volume');
    // Parameters make the checklist readable — "set volume — level 35" says
    // what will happen; "set_volume" does not.
    expect(store.plan[1].label, contains('level 35'));
    expect(store.plan.every((s) => s.status == PlanStepStatus.pending), isTrue);
  });

  test('a repaired plan ticks the step that actually finished', () {
    // Real ids from a repaired plan: `step_1_step_1` and `step_1_step_2`.
    // Reading the first number in each made both of them step one, so the
    // second step ran, finished, and the checklist stayed at 1/2 with a
    // hollow circle beside work that was already done.
    store.applyFrameForTesting(step('planning', data: {
      'steps': [
        {'action': 'find_files', 'params': {'query': 'aadhar'}},
        {'action': 'find_files', 'params': {'query': 'aadhaar'}},
      ],
    }));

    store.applyFrameForTesting(
        step('done', stepId: 'step_1_step_1', message: 'Verified'));
    store.applyFrameForTesting(
        step('done', stepId: 'step_1_step_2', message: 'Verified'));

    expect(
      store.plan.map((s) => s.status),
      everyElement(PlanStepStatus.completed),
      reason: 'both steps finished, so both rows must be ticked',
    );
  });

  test('a file search is drawn as a card, not read out', () {
    store.applyFrameForTesting(step('planning', data: {
      'steps': [
        {'action': 'find_files', 'params': {'query': 'aadhar'}},
      ],
    }));
    store.applyFrameForTesting(step('selecting',
        stepId: 'step_1',
        message: 'search for files',
        data: {'action': 'find_files', 'capability': 'can_control_files'}));
    store.applyFrameForTesting(
        step('done', stepId: 'step_1', message: 'Verified', data: {
      'artifact': {
        'kind': 'files',
        'title': '2 files found',
        'total': 2,
        'items': [
          {'label': 'aadhar.pdf', 'detail': 'C:/Users/cheth/aadhar.pdf'},
          {'label': 'scan001.jpg', 'detail': 'C:/Users/cheth/scan001.jpg'},
        ],
      },
    }));

    final reported = store.messages.lastWhere(
      (m) => m.speaker == MessageSpeaker.toolChip,
    );
    expect(reported.artifact, isNotNull);
    expect(reported.artifact!.items, hasLength(2));
    expect(reported.artifact!.items.first.label, 'aadhar.pdf');
  });

  test('a step is visible while it is still running', () {
    store.applyFrameForTesting(step('planning', data: {
      'steps': [
        {'action': 'get_volume', 'params': <String, dynamic>{}},
      ],
    }));
    store.applyFrameForTesting(step(
      'selecting',
      stepId: 'step_1',
      message: 'Planner selected step_1: get volume',
      data: {'capability': 'can_control_os', 'action': 'get_volume'},
    ));

    final running = store.currentActivity;
    expect(running, isNotNull, reason: 'no card while the step is running');
    expect(running!.state, ToolActivityState.running);
    expect(running.toolId, 'get_volume');
    expect(store.plan.first.status, PlanStepStatus.inProgress);
    expect(store.state, AgentState.acting);

    // And the inline chip, which is what appears in the transcript itself.
    expect(store.runningEngineChip, isNotNull);
  });

  test('finishing a step carries the verification, not just a tick', () {
    store.applyFrameForTesting(step('selecting', stepId: 'step_1', data: {
      'capability': 'can_control_os',
      'action': 'get_volume',
    }));
    store.applyFrameForTesting(step(
      'done',
      stepId: 'step_1',
      message: 'SystemAgent verified it: Endpoint reports 30%',
    ));

    final activity = store.activities.first;
    expect(activity.state, ToolActivityState.done);
    expect(activity.ok, isTrue);
    // The sentence the owner reads is the evidence, not "done".
    expect(activity.summary, contains('30%'));
    expect(store.currentActivity, isNull);
  });

  test('a failed step is marked failed, not quietly finished', () {
    store.applyFrameForTesting(step('selecting', stepId: 'step_1', data: {
      'capability': 'can_control_app',
      'action': 'click_element',
    }));
    store.applyFrameForTesting(step(
      'failed',
      stepId: 'step_1',
      message: 'No control named "1920 x 1080"',
    ));

    expect(store.activities.first.state, ToolActivityState.failed);
    expect(store.activities.first.ok, isFalse);
  });

  test('steps from a new task do not reach back into the last one', () {
    // Step ids are per-request: every task has a step_1. Keying a card on the
    // bare id made a new task's first step flip the previous task's first card
    // to "done" — seen on screen before this was fixed.
    store.applyFrameForTesting(
      step('selecting', request: 'req-A', stepId: 'step_1',
          data: {'capability': 'can_control_os', 'action': 'get_dns'}),
    );
    store.applyFrameForTesting(
      step('failed', request: 'req-A', stepId: 'step_1', message: 'daemon down'),
    );

    store.applyFrameForTesting(
      step('selecting', request: 'req-B', stepId: 'step_1',
          data: {'capability': 'can_control_os', 'action': 'get_volume'}),
    );
    store.applyFrameForTesting(
      step('done', request: 'req-B', stepId: 'step_1', message: 'verified'),
    );

    expect(store.activities, hasLength(2));
    final a = store.activities.firstWhere((x) => x.toolId == 'get_dns');
    final b = store.activities.firstWhere((x) => x.toolId == 'get_volume');
    expect(a.state, ToolActivityState.failed,
        reason: 'the earlier task was rewritten by the later one');
    expect(b.state, ToolActivityState.done);
  });

  test('a confirmation becomes an approval card carrying its step version', () {
    store.applyFrameForTesting(DexFrame(
      kind: DexFrameKind.confirmation,
      type: 'confirmation',
      message: 'Change the display resolution',
      requestId: 'req-1',
      stepId: 'step_2',
      data: {
        'requestId': 'req-1',
        'stepId': 'step_2',
        'stepVersion': 'sha-abc',
        'summary': 'Change the display resolution',
        'action': 'set_display',
        'capability': 'can_control_os',
        'params': {'resolution': '1920x1080'},
        'tier': 2,
      },
    ));

    expect(store.state, AgentState.awaiting);
    expect(store.pending, isNotNull);
    expect(store.pending!.isApprovalRequest, isTrue);
    // The card shows what will actually happen, not just the step's name.
    expect(store.pending!.steps.first.text, contains('1920x1080'));
  });

  test('the closing line is the answer, not a restatement of the task', () {
    store.applyFrameForTesting(DexFrame(
      kind: DexFrameKind.result,
      type: 'result',
      message: 'Your volume is 30% and muted.',
      requestId: 'req-1',
      data: {'status': 'COMPLETED', 'summary': 'Retrieve the system volume'},
    ));

    final last = store.messages.last;
    expect(last.speaker, MessageSpeaker.agent);
    expect(last.text, 'Your volume is 30% and muted.');
    expect(store.state, AgentState.idle);
  });

  test('a step still running when the task ends does not spin forever', () {
    store.applyFrameForTesting(step('selecting', stepId: 'step_1', data: {
      'capability': 'can_control_os',
      'action': 'get_volume',
    }));
    // No terminal event for the step — the task just ends.
    store.applyFrameForTesting(DexFrame(
      kind: DexFrameKind.result,
      type: 'result',
      message: 'done',
      requestId: 'req-1',
      data: {'status': 'COMPLETED'},
    ));

    expect(store.currentActivity, isNull,
        reason: 'a spinner left running forever is worse than an unknown outcome');
  });

  test('each capability routes to the engine pill the UI already draws', () {
    for (final (capability, action) in const [
      ('can_control_os', 'get_dns'),
      ('can_control_app', 'click_element'),
      ('can_browse_web', 'navigate'),
      ('can_control_gui', 'run_task'),
    ]) {
      store.applyFrameForTesting(step(
        'selecting',
        request: capability,
        stepId: 'step_1',
        data: {'capability': capability, 'action': action},
      ));
    }
    expect(store.activities.where((a) => a.engine != null), hasLength(4));
  });

  group('approvals queue rather than overwrite', () {
    // The bug this replaces, exactly as it happened: a plan produced twelve
    // independent run_command steps. The Orchestrator runs everything whose
    // dependencies are met in parallel, so twelve cards were raised at once.
    // The store held one. The other eleven were never shown, went unanswered,
    // and expired at their 120-second timeout — on screen, ten steps failing
    // simultaneously at "2m 0s" and the task stopping two steps from the end.
    DexFrame approval(String stepId, {String request = 'req-1'}) => DexFrame(
          kind: DexFrameKind.confirmation,
          type: 'confirmation',
          message: 'Run a command',
          requestId: request,
          stepId: stepId,
          data: {
            'requestId': request,
            'stepId': stepId,
            'stepVersion': 'v-$stepId',
            'summary': 'Run a command',
            'action': 'run_command',
            'capability': 'can_control_os',
            'params': {'command': ['powercfg', '/setactive', stepId]},
            'tier': 2,
          },
        );

    test('twelve at once are all kept', () {
      for (var i = 1; i <= 12; i++) {
        store.applyFrameForTesting(approval('step_$i'));
      }
      expect(store.approvalsWaiting, 12,
          reason: 'eleven approvals were dropped and expired unseen');
      expect(store.pending, isNotNull);
      expect(store.state, AgentState.awaiting);
    });

    test('the first raised is the first shown', () {
      store.applyFrameForTesting(approval('step_1'));
      store.applyFrameForTesting(approval('step_2'));
      // Oldest first: it is closest to its own timeout.
      expect(store.pending!.id, contains('step_1'));
    });

    test('answering one immediately shows the next', () async {
      store.applyFrameForTesting(approval('step_1'));
      store.applyFrameForTesting(approval('step_2'));

      await store.approve();

      expect(store.approvalsWaiting, 1);
      expect(store.pending, isNotNull);
      expect(store.pending!.id, contains('step_2'),
          reason: 'a gap between cards is a step quietly expiring');
      expect(store.state, AgentState.awaiting);
    });

    test('answering the last one leaves none and resumes', () async {
      store.applyFrameForTesting(approval('step_1'));
      await store.approve();

      expect(store.approvalsWaiting, 0);
      expect(store.pending, isNull);
      expect(store.state, AgentState.acting);
    });

    test('approve all clears the queue', () async {
      for (var i = 1; i <= 12; i++) {
        store.applyFrameForTesting(approval('step_$i'));
      }
      await store.approveAll();

      expect(store.approvalsWaiting, 0);
      expect(store.pending, isNull);
    });

    test('a withdrawn approval is removed from the middle, not just the head',
        () {
      store.applyFrameForTesting(approval('step_1'));
      store.applyFrameForTesting(approval('step_2'));
      store.applyFrameForTesting(approval('step_3'));

      // step_2 expires while step_1 is still on screen.
      store.applyFrameForTesting(DexFrame(
        kind: DexFrameKind.confirmationClosed,
        type: 'confirmation_closed',
        message: '',
        requestId: 'req-1',
        stepId: 'step_2',
      ));

      expect(store.approvalsWaiting, 2);
      expect(store.pending!.id, contains('step_1'),
          reason: 'withdrawing a queued card must not disturb the visible one');
    });

    test('the same approval arriving twice is only queued once', () {
      store.applyFrameForTesting(approval('step_1'));
      store.applyFrameForTesting(approval('step_1'));
      expect(store.approvalsWaiting, 1);
    });

    test('a new turn clears anything left unanswered', () async {
      store.applyFrameForTesting(approval('step_1'));
      store.applyFrameForTesting(approval('step_2'));

      await store.sendHumanMessage('something else');

      expect(store.approvalsWaiting, 0);
      expect(store.pending, isNull);
    });
  });
}
