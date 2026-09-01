// Smoke test: the app renders without crashing.
//
// We stub the gateway client so no real socket is required during tests.

import 'package:flutter/material.dart';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:dex/core/dex_gateway.dart';
import 'package:dex/core/state/conversation_store.dart';
import 'package:dex/main.dart';

void main() {
  // The app gates its home surface on DexAccount.load(), which reads
  // SharedPreferences. Without a mock store that Future never completes in a
  // test harness, so the app sits on the splash screen forever and every
  // assertion about the home surface fails — which is exactly what this test
  // had been doing.
  TestWidgetsFlutterBinding.ensureInitialized();
  // Signed in and past onboarding: the app shows a login screen otherwise,
  // and this test is about the home surface. The old assertion looked for
  // greeting copy that is not in the codebase, so it never got far enough to
  // discover that the login gate was in the way.
  SharedPreferences.setMockInitialValues(<String, Object>{
    'dex.account.signedIn': true,
    'dex.account.name': 'Test',
    'dex.onboarding.seen': true,
  });

  testWidgets('Dex boots and shows the empty home', (tester) async {
    // The cockpit is a desktop layout; below this it overflows, which is a
    // real constraint of the design rather than a test artifact.
    tester.view.physicalSize = const Size(1600, 1000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = DexGatewayClient();
    final store = ConversationStore(client);
    await tester.pumpWidget(DexApp(store: store));

    // The app opens on a warm-up screen for ~2.2s before the home surface, and
    // the home surface then staggers a fade-in per element.
    //
    // Not pumpAndSettle: the background animates continuously, so settle waits
    // for an idle that never arrives. Not a tight loop of small pumps either —
    // that leaves the staggered timers pending at teardown and the framework
    // fails the test for it. One long pump advances fake time past all of them.
    await tester.pump(const Duration(seconds: 3));
    await tester.pump(const Duration(seconds: 3));

    // Asserts the composer, not the greeting.
    //
    // The greeting is chosen at random from a list and then typed in one
    // character at a time over about 700ms, so after a single pump almost none
    // of it is on screen. The old assertion looked for a specific line that is
    // not in the codebase at all, and could only ever have passed by accident.
    // The composer is always there, and "the app booted and you can type into
    // it" is what this test is actually for.
    // Structure, not copy. The greeting is picked at random and typed in one
    // character at a time; the composer hint lives inside a decoration rather
    // than a Text widget. Both are the kind of thing that changes for cosmetic
    // reasons and takes the test with it. The sidebar and a focusable composer
    // are what "the app booted and you can use it" actually means.
    expect(find.text('New chat'), findsOneWidget);
    expect(find.text('Library'), findsOneWidget);
    expect(find.byType(EditableText), findsOneWidget,
        reason: 'no composer to type into');

    client.dispose();
  });
}
