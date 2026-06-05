// Phase C.7-flutter widget tests -- the Live panel surfaces the routed
// engine and the EnginePill renders for every engine.

import 'package:dex/core/gateway_client.dart';
import 'package:dex/core/models/engine.dart';
import 'package:dex/core/models/message.dart';
import 'package:dex/core/state/conversation_store.dart';
import 'package:dex/main.dart';
import 'package:dex/widgets/tool_chip.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Message _runningChip({EngineId engine = EngineId.browserUse, String goal = 'take typing test'}) {
  return Message(
    id: 'chip-1',
    speaker: MessageSpeaker.toolChip,
    ts: DateTime.now(),
    callId: 'call-1',
    toolId: 'run_browser_task',
    toolGoal: goal,
    chipState: ToolChipState.running,
    engine: engine,
  );
}

void main() {
  group('EnginePill', () {
    testWidgets('renders label + icon for every engine', (tester) async {
      for (final id in EngineId.values) {
        await tester.pumpWidget(
          MaterialApp(home: Scaffold(body: Center(child: EnginePill(engine: id)))),
        );
        final desc = descriptorForEngine(id);
        expect(find.text(desc.label), findsOneWidget,
            reason: 'engine ${id.name} should show label ${desc.label}');
        expect(find.byIcon(desc.icon), findsOneWidget,
            reason: 'engine ${id.name} should show its icon');
      }
    });
  });

  group('Live panel running-engine card', () {
    testWidgets('shows engine pill + goal when a running chip exists', (tester) async {
      tester.view.physicalSize = const Size(1400, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final client = GatewayClient(GatewayConfig.fromLocalConfig());
      final store = ConversationStore(client);
      addTearDown(client.dispose);

      await tester.pumpWidget(DexApp(store: store));
      await tester.pump();

      // Before injection: "No pending action." copy is visible in the Live
      // column. After injecting a running chip with engine=browser-use,
      // the running-engine card replaces it.
      expect(find.text('No pending action.'), findsOneWidget);

      store.addMessageForTesting(_runningChip(
        engine: EngineId.browserUse,
        goal: 'livechat typing test',
      ));
      await tester.pump();

      expect(find.text('No pending action.'), findsNothing);
      expect(find.text('Running'), findsOneWidget);
      expect(find.text('browser-use'), findsAtLeastNWidgets(1));
      expect(find.text('livechat typing test'), findsAtLeastNWidgets(1));
    });

    testWidgets('runningEngineChip getter returns the latest running chip', (tester) async {
      final client = GatewayClient(GatewayConfig.fromLocalConfig());
      final store = ConversationStore(client);
      addTearDown(client.dispose);

      expect(store.runningEngineChip, isNull);

      store.addMessageForTesting(_runningChip(engine: EngineId.ufoUia, goal: 'first'));
      expect(store.runningEngineChip?.engine, EngineId.ufoUia);
      expect(store.runningEngineChip?.toolGoal, 'first');

      store.addMessageForTesting(_runningChip(engine: EngineId.omniparser, goal: 'second'));
      // Latest running chip wins.
      expect(store.runningEngineChip?.engine, EngineId.omniparser);
      expect(store.runningEngineChip?.toolGoal, 'second');
    });
  });
}
