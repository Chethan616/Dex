// Smoke test: the app renders without crashing.
//
// We stub the gateway client so no real socket is required during tests.

import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';

import 'package:dex/core/gateway_client.dart';
import 'package:dex/core/state/conversation_store.dart';
import 'package:dex/main.dart';

void main() {
  testWidgets('Dex boots and shows the empty home', (tester) async {
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final client = GatewayClient(GatewayConfig.fromLocalConfig());
    final store = ConversationStore(client);
    await tester.pumpWidget(DexApp(store: store));
    await tester.pump();

    expect(
      find.textContaining('what should we dive into today'),
      findsOneWidget,
    );

    await client.dispose();
  });
}
