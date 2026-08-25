import 'package:dex_bar/core/models.dart';
import 'package:dex_bar/core/window_activity.dart';
import 'package:dex_bar/theme/tokens.dart';
import 'package:dex_bar/widgets/confirmation_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

ConfirmationRequest request({int tier = 2}) => ConfirmationRequest(
      requestId: 'r1',
      stepId: 'step_1',
      stepVersion: 'abc123def456',
      capability: 'can_control_os',
      action: 'set_dns',
      params: const {'primary': '1.1.1.1'},
      tier: tier,
      description: 'set_dns (primary=1.1.1.1)',
      createdAt: DateTime.now().millisecondsSinceEpoch,
      expiresAt: DateTime.now().millisecondsSinceEpoch + 120000,
    );

Widget host(ConfirmationRequest req, void Function(String) onRespond) => MaterialApp(
      theme: buildDexTheme(Brightness.dark),
      home: Scaffold(
        body: ConfirmationCard(
          request: req,
          onRespond: onRespond,
          onCancelTask: () {},
        ),
      ),
    );

/// The card reads the wall clock, not the binding's fake one — it is guarding
/// against real injected OS input. Real time has to pass for that check, and
/// the fake clock has to advance for the card's periodic timer to tick.
Future<void> letTimePass(WidgetTester tester, Duration d) async {
  await tester.runAsync(() => Future<void>.delayed(d));
  await tester.pump(d);
}

/// Stand-in for the owner moving the mouse onto the button. Without this the
/// card stays inert no matter how much time passes — which is the point.
void movePointer() => WindowActivity.debugNotePointerMoved();

void main() {
  setUp(() {
    WindowActivity.settleDelay = const Duration(milliseconds: 120);
  });

  tearDown(() {
    WindowActivity.settleDelay = const Duration(milliseconds: 400);
  });

  group('confirmation card arming', () {
    // Raising a window on Windows injects a synthetic mouse click at the
    // cursor. If the card accepted it, a Tier 2 action would self-approve.
    testWidgets('ignores a click that lands right after the window is raised',
        (tester) async {
      final verdicts = <String>[];
      WindowActivity.mark();

      await tester.pumpWidget(host(request(), verdicts.add));
      await tester.pump();

      await tester.tap(find.text('Approve once'), warnIfMissed: false);
      await tester.pump();

      expect(verdicts, isEmpty, reason: 'button must be inert while unsettled');
    });

    testWidgets('accepts a click once the window has settled', (tester) async {
      final verdicts = <String>[];
      WindowActivity.mark();

      await tester.pumpWidget(host(request(), verdicts.add));
      movePointer();
      await letTimePass(tester, const Duration(milliseconds: 300));

      await tester.tap(find.text('Approve once'));
      await tester.pump();

      expect(verdicts, ['approved']);
    });

    // The decisive guarantee. The injected click's delivery latency was
    // measured anywhere from milliseconds to over a second, so no timeout can
    // gate it — but it always arrives at a cursor that has not moved.
    testWidgets('never accepts a click if the pointer never moved', (tester) async {
      final verdicts = <String>[];
      WindowActivity.mark();

      await tester.pumpWidget(host(request(), verdicts.add));
      await letTimePass(tester, const Duration(seconds: 2));

      await tester.tap(find.text('Approve once'), warnIfMissed: false);
      await tester.pump();

      expect(verdicts, isEmpty,
          reason: 'a click with no preceding pointer movement is not the owner');
    });

    testWidgets('goes inert again if the window is raised while the card is up',
        (tester) async {
      final verdicts = <String>[];
      WindowActivity.mark();

      await tester.pumpWidget(host(request(), verdicts.add));
      movePointer();
      await letTimePass(tester, const Duration(milliseconds: 300));

      // The window is raised again — arming must not stay latched.
      WindowActivity.mark();
      await letTimePass(tester, const Duration(milliseconds: 60));

      await tester.tap(find.text('Approve once'), warnIfMissed: false);
      await tester.pump();

      expect(verdicts, isEmpty, reason: 'a re-raised window must re-disarm the card');
    });

    testWidgets('Tier 2 offers no session pass; Tier 3 does', (tester) async {
      await tester.pumpWidget(host(request(tier: 2), (_) {}));
      await tester.pump();
      expect(find.text('Approve for session'), findsNothing);
      expect(find.text('Approve once'), findsOneWidget);

      await tester.pumpWidget(host(request(tier: 3), (_) {}));
      await tester.pump();
      expect(find.text('Approve for session'), findsOneWidget);
    });

    testWidgets('Tier 1 is a hand-off, not an approval', (tester) async {
      await tester.pumpWidget(host(request(tier: 1), (_) {}));
      await tester.pump();

      expect(find.text('Approve once'), findsNothing);
      expect(find.text('Done, continue'), findsOneWidget);
    });

    testWidgets('shows the exact action and step version, not a paraphrase',
        (tester) async {
      await tester.pumpWidget(host(request(), (_) {}));
      await tester.pump();

      expect(find.text('set_dns (primary=1.1.1.1)'), findsOneWidget);
      expect(find.text('step step_1 · vabc123def456'), findsOneWidget);
    });

    testWidgets('a Tier 3 card fits a narrow bar without clipping', (tester) async {
      tester.view.physicalSize = const Size(700, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(host(request(tier: 3), (_) {}));
      await tester.pump();

      expect(tester.takeException(), isNull);
    });
  });
}
