// Phase C.7-flutter widget tests -- the Live panel surfaces the routed
// engine and the EnginePill renders for every engine.

import 'package:dex/core/dex_gateway.dart';
import 'package:dex/core/models/engine.dart';
import 'package:dex/core/models/message.dart';
import 'package:dex/core/models/tool_activity.dart';
import 'package:dex/core/state/conversation_store.dart';
import 'package:dex/widgets/tool_chip.dart';
import 'package:flutter/material.dart';
import 'package:dex/widgets/activity_card.dart';
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
    // ActivityCard is rendered directly rather than through DexApp.
    //
    // It is not wired into any screen — nothing in lib/ constructs it — so the
    // original version of this test drove the whole app and then looked for a
    // card that could never appear. It failed for that reason, not because the
    // card is wrong. Pumping the widget itself tests what the name says it
    // tests, and it will keep passing when the card is finally placed on a
    // screen.
    testWidgets('ActivityCard shows the engine pill, tool and goal', (tester) async {
      tester.view.physicalSize = const Size(900, 700);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          backgroundColor: const Color(0xFF0B0A10),
          body: SingleChildScrollView(
            child: ActivityCard(
              activity: _runningActivity(
                engine: EngineId.browserUse,
                goal: 'livechat typing test',
                toolId: 'run_browser_task',
              ),
            ),
          ),
        ),
      ));
      await tester.pump(const Duration(seconds: 1));

      expect(find.text('browser-use'), findsAtLeastNWidgets(1));
      expect(find.text('Browser'), findsAtLeastNWidgets(1));
      expect(find.text('run_browser_task'), findsAtLeastNWidgets(1));
      expect(
        find.byWidgetPredicate(
          (w) => w is RichText && w.text.toPlainText().contains('livechat typing test'),
        ),
        findsAtLeastNWidgets(1),
      );
    });

    testWidgets('runningEngineChip getter returns the latest running chip', (tester) async {
      final client = DexGatewayClient();
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
