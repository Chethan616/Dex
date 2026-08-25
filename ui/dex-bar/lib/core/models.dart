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

enum TaskPhase { idle, thinking, running, awaiting, done, failed, cancelled }

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
