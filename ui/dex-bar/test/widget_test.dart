import 'package:dex_bar/core/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('wire format', () {
    test('parses a DexEvent', () {
      final event = DexEvent.fromJson({
        'type': 'executing',
        'message': 'set_dns({"primary":"1.1.1.1"})',
        'requestId': 'abc',
        'stepId': 'step_1',
        'timestamp': 1700000000000,
      });

      expect(event.type, 'executing');
      expect(event.stepId, 'step_1');
      expect(event.isTerminal, isFalse);
    });

    test('a confirmation key changes when the step version changes', () {
      Map<String, dynamic> json(String version) => {
            'requestId': 'r1',
            'stepId': 'step_1',
            'stepVersion': version,
            'capability': 'can_control_os',
            'action': 'set_dns',
            'params': <String, dynamic>{'primary': '1.1.1.1'},
            'tier': 2,
            'description': 'set_dns (primary=1.1.1.1)',
            'createdAt': 0,
            'expiresAt': 0,
          };

      final a = ConfirmationRequest.fromJson(json('aaa111'));
      final b = ConfirmationRequest.fromJson(json('bbb222'));

      expect(a.key, isNot(equals(b.key)));
    });

    test('groups plan steps and keeps dependencies', () {
      final plan = ExecutionPlanModel.fromJson({
        'requestId': 'r1',
        'intent': 'Set DNS then confirm',
        'tier': 2,
        'steps': [
          {
            'id': 'step_1',
            'capability': 'can_control_os',
            'action': 'set_dns',
            'params': <String, dynamic>{},
            'confirmationTier': 4,
            'dependsOn': <String>[],
          },
          {
            'id': 'step_2',
            'capability': 'can_control_os',
            'action': 'get_dns',
            'params': <String, dynamic>{},
            'confirmationTier': 4,
            'dependsOn': ['step_1'],
          },
        ],
      });

      expect(plan.steps, hasLength(2));
      expect(plan.steps[1].dependsOn, ['step_1']);
    });

    test('reads a verification verdict out of an evidence record', () {
      final record = EvidenceRecord.fromJson({
        'stepId': 'step_1',
        'action': 'set_dns',
        'timestamp': 1700000000000,
        'verificationResult': {
          'status': 'VERIFIED',
          'reason': 'DNS primary 1.1.1.1 confirmed in netsh output',
          'afterState': 'Statistics for ...',
        },
      });

      expect(record.status, 'VERIFIED');
      expect(record.afterState, isNotNull);
    });
  });
}
