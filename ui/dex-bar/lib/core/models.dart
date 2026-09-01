/// Mirrors of the TypeScript types in `core/events/types.ts`.
/// Keep the field names in sync — the wire format is the contract.
library;

class DexEvent {
  const DexEvent({
    required this.type,
    required this.message,
    required this.requestId,
    required this.timestamp,
    this.stepId,
    this.data,
  });

  final String type;
  final String message;
  final String requestId;
  final int timestamp;
  final String? stepId;
  final dynamic data;

  factory DexEvent.fromJson(Map<String, dynamic> json) => DexEvent(
        type: json['type'] as String? ?? 'unknown',
        message: json['message'] as String? ?? '',
        requestId: json['requestId'] as String? ?? '',
        timestamp: json['timestamp'] as int? ?? 0,
        stepId: json['stepId'] as String?,
        data: json['data'],
      );

  bool get isTerminal => type == 'done' || type == 'failed' || type == 'cancelled';
}

class ExecutionStepModel {
  const ExecutionStepModel({
    required this.id,
    required this.capability,
    required this.action,
    required this.params,
    required this.confirmationTier,
    required this.dependsOn,
  });

  final String id;
  final String capability;
  final String action;
  final Map<String, dynamic> params;
  final int confirmationTier;
  final List<String> dependsOn;

  factory ExecutionStepModel.fromJson(Map<String, dynamic> json) => ExecutionStepModel(
        id: json['id'] as String? ?? '',
        capability: json['capability'] as String? ?? '',
        action: json['action'] as String? ?? '',
        params: Map<String, dynamic>.from(json['params'] as Map? ?? {}),
        confirmationTier: json['confirmationTier'] as int? ?? 4,
        dependsOn: List<String>.from(json['dependsOn'] as List? ?? const []),
      );
}

class ExecutionPlanModel {
  const ExecutionPlanModel({
    required this.requestId,
    required this.intent,
    required this.tier,
    required this.steps,
  });

  final String requestId;
  final String intent;
  final int tier;
  final List<ExecutionStepModel> steps;

  factory ExecutionPlanModel.fromJson(Map<String, dynamic> json) => ExecutionPlanModel(
        requestId: json['requestId'] as String? ?? '',
        intent: json['intent'] as String? ?? '',
        tier: json['tier'] as int? ?? 1,
        steps: (json['steps'] as List? ?? const [])
            .map((s) => ExecutionStepModel.fromJson(Map<String, dynamic>.from(s as Map)))
            .toList(),
      );
}

class ConfirmationRequest {
  const ConfirmationRequest({
    required this.requestId,
    required this.stepId,
    required this.stepVersion,
    required this.capability,
    required this.action,
    required this.params,
    required this.tier,
    required this.description,
    required this.createdAt,
    required this.expiresAt,
  });

  final String requestId;
  final String stepId;
  final String stepVersion;
  final String capability;
  final String action;
  final Map<String, dynamic> params;
  final int tier;
  final String description;
  final int createdAt;
  final int expiresAt;

  /// Identity of a card: a rewritten step produces a different key, so a stale
  /// card can never be mistaken for the live one.
  String get key => '$requestId::$stepId::$stepVersion';

  factory ConfirmationRequest.fromJson(Map<String, dynamic> json) => ConfirmationRequest(
        requestId: json['requestId'] as String? ?? '',
        stepId: json['stepId'] as String? ?? '',
        stepVersion: json['stepVersion'] as String? ?? '',
        capability: json['capability'] as String? ?? '',
        action: json['action'] as String? ?? '',
        params: Map<String, dynamic>.from(json['params'] as Map? ?? {}),
        tier: json['tier'] as int? ?? 4,
        description: json['description'] as String? ?? '',
        createdAt: json['createdAt'] as int? ?? 0,
        expiresAt: json['expiresAt'] as int? ?? 0,
      );
}

enum TaskPhase { idle, thinking, running, awaiting, done, answered, failed, cancelled }

class TaskRun {
  TaskRun({required this.requestId, required this.prompt, required this.startedAt});

  /// Empty until the first event binds this run to its core-side request id.
  String requestId;

  /// The original command. For a task adopted from another channel this is
  /// filled in from the `thinking` event, which quotes the request text.
  String prompt;
  final int startedAt;

  final List<DexEvent> events = [];
  ExecutionPlanModel? plan;
  TaskPhase phase = TaskPhase.thinking;
  String? status;
  String? summary;

  /// What Dex has to say: the reply to a question, or the phrased result of a
  /// task that read something.
  ///
  /// Distinct from [summary], which describes what was *done*. A read used to
  /// finish with "Retrieve the current Windows power plan" and never say what
  /// the plan was, because the value was computed and thrown away.
  String? answer;

  int? finishedAt;

  Duration get elapsed => Duration(
        milliseconds: (finishedAt ?? DateTime.now().millisecondsSinceEpoch) - startedAt,
      );
}

class EvidenceRecord {
  const EvidenceRecord({
    required this.stepId,
    required this.action,
    required this.status,
    required this.reason,
    required this.timestamp,
    this.beforeState,
    this.afterState,
  });

  final String stepId;
  final String action;
  final String status;
  final String reason;
  final int timestamp;
  final dynamic beforeState;
  final dynamic afterState;

  factory EvidenceRecord.fromJson(Map<String, dynamic> json) {
    final verification = Map<String, dynamic>.from(
      json['verificationResult'] as Map? ?? const {},
    );
    return EvidenceRecord(
      stepId: json['stepId'] as String? ?? '',
      action: json['action'] as String? ?? '',
      status: verification['status'] as String? ?? 'UNKNOWN',
      reason: verification['reason'] as String? ?? '',
      timestamp: json['timestamp'] as int? ?? 0,
      beforeState: json['beforeState'],
      afterState: verification['afterState'],
    );
  }
}

/// A task Dex worked out once and kept, so it never has to plan it again.
class SavedWorkflow {
  const SavedWorkflow({
    required this.name,
    required this.description,
    required this.params,
    required this.steps,
    required this.runCount,
    required this.triggerText,
  });

  final String name;
  final String description;

  /// Values the owner varied, in the order `run <name> …` expects them.
  final List<String> params;
  final int steps;
  final int runCount;

  /// What was originally said. Shown so a workflow's purpose is recognisable
  /// even when its name has stopped being.
  final String triggerText;

  factory SavedWorkflow.fromJson(Map<String, dynamic> json) => SavedWorkflow(
        name: json['name'] as String? ?? '',
        description: json['description'] as String? ?? '',
        params: List<String>.from((json['params'] as List?) ?? const []),
        steps: json['steps'] as int? ?? 0,
        runCount: json['runCount'] as int? ?? 0,
        triggerText: json['triggerText'] as String? ?? '',
      );
}

/// A persisted schedule shown in the Schedules destination.
class ScheduleRecord {
  const ScheduleRecord({
    required this.name,
    required this.cron,
    required this.description,
    required this.request,
    required this.createdAt,
    required this.enabled,
    required this.lastFiredAt,
    required this.lastStatus,
    required this.runCount,
    required this.failCount,
    required this.nextRun,
  });

  final String name;
  final String cron;
  final String description;
  final String request;
  final int createdAt;
  final bool enabled;
  final int? lastFiredAt;
  final String? lastStatus;
  final int runCount;
  final int failCount;
  final DateTime? nextRun;

  factory ScheduleRecord.fromJson(Map<String, dynamic> json) => ScheduleRecord(
        name: json['name'] as String? ?? '',
        cron: json['cron'] as String? ?? '',
        description: json['description'] as String? ?? '',
        request: json['request'] as String? ?? '',
        createdAt: json['createdAt'] as int? ?? 0,
        enabled: json['enabled'] as bool? ?? false,
        lastFiredAt: json['lastFiredAt'] as int?,
        lastStatus: json['lastStatus'] as String?,
        runCount: json['runCount'] as int? ?? 0,
        failCount: json['failCount'] as int? ?? 0,
        nextRun: _date(json['nextRun']),
      );

  static DateTime? _date(dynamic value) {
    if (value is! String || value.isEmpty) return null;
    return DateTime.tryParse(value);
  }
}

/// One entry in the history of what has been asked.
class TaskRecord {
  const TaskRecord({
    required this.text,
    required this.status,
    required this.startedAt,
    this.intent,
    this.workflow,
    this.durationMs,
  });

  final String text;
  final String? status;
  final int startedAt;
  final String? intent;

  /// Set when this ran from a saved workflow rather than a fresh plan.
  final String? workflow;
  final int? durationMs;

  bool get succeeded => status == 'COMPLETED';

  factory TaskRecord.fromJson(Map<String, dynamic> json) => TaskRecord(
        text: json['text'] as String? ?? '',
        status: json['status'] as String?,
        startedAt: json['startedAt'] as int? ?? 0,
        intent: json['intent'] as String?,
        workflow: json['workflow'] as String?,
        durationMs: json['durationMs'] as int?,
      );
}

class DayCount {
  const DayCount(this.day, this.tasks);
  final String day;
  final int tasks;
}

class ActionCount {
  const ActionCount(this.action, this.capability, this.runs, this.failures);
  final String action;
  final String capability;
  final int runs;
  final int failures;
}

/// What Dex has been used for lately.
class UsageStats {
  const UsageStats({
    required this.totalTasks,
    required this.completed,
    required this.failed,
    required this.brainCalls,
    required this.workflowRuns,
    required this.byDay,
    required this.topActions,
  });

  final int totalTasks;
  final int completed;
  final int failed;

  /// Tasks that needed a planning call, versus tasks replayed from a workflow.
  /// The second number is planning calls that did not have to happen.
  final int brainCalls;
  final int workflowRuns;

  final List<DayCount> byDay;
  final List<ActionCount> topActions;

  factory UsageStats.fromJson(Map<String, dynamic> json) => UsageStats(
        totalTasks: json['totalTasks'] as int? ?? 0,
        completed: json['completed'] as int? ?? 0,
        failed: json['failed'] as int? ?? 0,
        brainCalls: json['brainCalls'] as int? ?? 0,
        workflowRuns: json['workflowRuns'] as int? ?? 0,
        byDay: ((json['byDay'] as List?) ?? const [])
            .map((d) => DayCount(
                  (d as Map)['day'] as String? ?? '',
                  d['tasks'] as int? ?? 0,
                ))
            .toList(),
        topActions: ((json['topActions'] as List?) ?? const [])
            .map((a) => ActionCount(
                  (a as Map)['action'] as String? ?? '',
                  a['capability'] as String? ?? '',
                  a['runs'] as int? ?? 0,
                  a['failures'] as int? ?? 0,
                ))
            .toList(),
      );
}

/// Dex noticing you keep doing the same thing.
class SaveSuggestion {
  const SaveSuggestion(this.text, this.times);
  final String text;
  final int times;
}
