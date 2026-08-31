import 'package:dex_bar/core/window_activity.dart';
import 'package:dex_bar/theme/tokens.dart';
import 'package:dex_bar/widgets/access_chip.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The Full Access chip grants and revokes administrator elevation, so it needs
/// the same injected-click guard the confirmation card has.
///
/// It shipped without one. Raising a window on Windows injects a synthetic
/// click at the cursor, and this control was reachable by it — a click nobody
/// aimed could unregister the logon task and rewrite .env, turning Full Access
/// off. That is exactly what appears to have happened during testing: the task
/// vanished and FULL_ACCESS flipped to false with nobody knowingly clicking
/// anything.
///
/// It was the only consequential control in the app left unguarded, which is
/// the kind of gap a UI rewrite leaves behind. These tests are here so it
/// cannot be left behind twice.
Widget host(void Function(bool) onToggle, {bool enabled = true}) => MaterialApp(
      theme: buildDexTheme(Brightness.dark),
      home: Scaffold(
        body: Center(
          child: AccessChip(
            enabled: enabled,
            serviceState: 'Running',
            onToggle: onToggle,
          ),
        ),
      ),
    );

/// Real time has to pass — the guard reads the wall clock, because it is
/// defending against real injected OS input.
Future<void> letTimePass(WidgetTester tester, Duration d) async {
  await tester.runAsync(() => Future<void>.delayed(d));
  await tester.pump(d);
}

/// Stand-in for the owner moving the mouse onto the chip.
///
/// Real pointer movement reaches WindowActivity through a Listener at the root
/// of the app, which this host does not have — so the movement is reported the
/// same way the confirmation-card tests do it. Without this the chip stays
/// inert however long you wait, which is the entire point.
void movePointer() => WindowActivity.debugNotePointerMoved();

void main() {
  setUp(() {
    WindowActivity.settleDelay = const Duration(milliseconds: 120);
  });

  tearDown(() {
    WindowActivity.settleDelay = const Duration(milliseconds: 400);
  });

  testWidgets('ignores a click right after the window is raised', (tester) async {
    final toggles = <bool>[];
    WindowActivity.mark();

    await tester.pumpWidget(host(toggles.add));
    await tester.pump();

    await tester.tap(find.byType(AccessChip), warnIfMissed: false);
    await tester.pump();

    expect(toggles, isEmpty, reason: 'elevation must not toggle on an unsettled window');
  });

  testWidgets('never accepts a click if the pointer never moved', (tester) async {
    final toggles = <bool>[];
    WindowActivity.mark();

    await tester.pumpWidget(host(toggles.add));
    await letTimePass(tester, const Duration(seconds: 2));

    await tester.tap(find.byType(AccessChip), warnIfMissed: false);
    await tester.pump();

    expect(
      toggles,
      isEmpty,
      reason: 'the injected click arrives at a cursor that has not moved — '
          'time alone must never arm this',
    );
  });

  testWidgets('accepts a real click once settled and the pointer has moved',
      (tester) async {
    final toggles = <bool>[];
    WindowActivity.mark();

    await tester.pumpWidget(host(toggles.add));

    // Order matters, and mirrors what physically happens: the settle delay
    // elapses, then the owner moves the mouse onto the chip. That one movement
    // both satisfies the guard and — through the hover handler — rebuilds the
    // widget so it re-reads it. Reversing the two leaves the flag set with
    // nothing having rebuilt, and the chip stays inert.
    await letTimePass(tester, const Duration(milliseconds: 300));
    movePointer();

    final gesture = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await gesture.addPointer(location: Offset.zero);
    addTearDown(gesture.removePointer);
    await gesture.moveTo(tester.getCenter(find.byType(AccessChip)));
    // Let the arming poll tick — a bare pump() advances the clock by nothing.
    await tester.pump(const Duration(milliseconds: 100));

    await tester.tap(find.byType(AccessChip));
    await tester.pump();

    expect(toggles, [false], reason: 'ON chip toggles to OFF');
  });

  testWidgets('goes inert again if the window is raised while it is on screen',
      (tester) async {
    final toggles = <bool>[];
    WindowActivity.mark();

    await tester.pumpWidget(host(toggles.add));
    final gesture = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await gesture.addPointer(location: Offset.zero);
    addTearDown(gesture.removePointer);
    await gesture.moveTo(tester.getCenter(find.byType(AccessChip)));
    movePointer();
    await letTimePass(tester, const Duration(milliseconds: 300));

    // The window is raised again — arming must not stay latched.
    WindowActivity.mark();
    await letTimePass(tester, const Duration(milliseconds: 60));

    await tester.tap(find.byType(AccessChip), warnIfMissed: false);
    await tester.pump();

    expect(toggles, isEmpty, reason: 'a re-raised window must disarm it again');
  });

  testWidgets('granting is guarded too, not just revoking', (tester) async {
    final toggles = <bool>[];
    WindowActivity.mark();

    await tester.pumpWidget(host(toggles.add, enabled: false));
    await letTimePass(tester, const Duration(seconds: 1));

    await tester.tap(find.byType(AccessChip), warnIfMissed: false);
    await tester.pump();

    expect(
      toggles,
      isEmpty,
      reason: 'turning elevation ON unasked is worse than turning it off',
    );
  });
}
