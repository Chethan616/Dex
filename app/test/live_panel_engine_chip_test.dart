// Phase C.7-flutter widget tests -- the Live panel surfaces the routed
// engine and the EnginePill renders for every engine.

import 'package:dex/core/gateway_client.dart';
import 'package:dex/core/models/engine.dart';
import 'package:dex/core/models/message.dart';
import 'package:dex/core/models/tool_activity.dart';
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

ToolActivity _runningActivity({
  EngineId engine = EngineId.browserUse,
  String goal = 'livechat typing test',
  String toolId = 'run_browser_task',
}) {
  return ToolActivity(
    callId: 'call-1',
    toolId: toolId,
    displayName: 'Browser',
    engine: engine,
    args: <String, dynamic>{'goal': goal, 'url_hint': 'https://livechat.com'},
    goalLabel: goal,
    startedAt: DateTime.now(),
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
    testWidgets('shows ActivityCard with engine pill + tool + goal when a running activity exists', (tester) async {
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
      // column. After injecting a running ToolActivity, the v1.2 ActivityCard
      // replaces it with engine pill + tool name + state badge + args block.
      expect(find.text('No pending action.'), findsOneWidget);

      store.addActivityForTesting(_runningActivity(
        engine: EngineId.browserUse,
        goal: 'livechat typing test',
        toolId: 'run_browser_task',
      ));
      await tester.pump();

      expect(find.text('No pending action.'), findsNothing);
      // Engine pill text
      expect(find.text('browser-use'), findsAtLeastNWidgets(1));
      // Friendly display name in the card header
      expect(find.text('Browser'), findsAtLeastNWidgets(1));
      // Raw tool id rendered above the args block
      expect(find.text('run_browser_task'), findsAtLeastNWidgets(1));
      // Goal appears as an arg row ("goal: livechat typing test"). We assert
      // the goal substring exists via byWidgetPredicate -- the Text widget
      // uses Text.rich so a literal find.text wouldn't match.
      expect(
        find.byWidgetPredicate(
          (w) => w is RichText && w.text.toPlainText().contains('livechat typing test'),
        ),
        findsAtLeastNWidgets(1),
      );
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
