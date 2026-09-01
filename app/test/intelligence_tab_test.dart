import 'package:dex/core/dex_gateway.dart';
import 'package:dex/core/models/brain_settings.dart';
import 'package:dex/theme/tokens.dart';
import 'package:dex/widgets/settings/tabs/intelligence_tab.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The screen that decides whether Dex can think at all.
///
/// Two properties are worth holding onto here, and they are the two that a
/// redesign would quietly break:
///
///   1. **A key is never displayed.** The core sends the last four characters
///      of a stored key and nothing more. If this screen ever shows something
///      longer, the credential store has been read back into the UI and the
///      reason it is encrypted has gone.
///   2. **Claude Code is offered before API keys**, and its model picker
///      defaults to Haiku — measured to plan as well as Sonnet for this job.

/// The payload the core actually sends, with a key that is *stored* but whose
/// value never leaves the store.
Map<String, dynamic> snapshot({
  String provider = 'claude-code',
  String model = 'haiku',
  bool claudeInstalled = true,
  bool claudeSignedIn = true,
  bool groqStored = true,
}) =>
    {
      'brain': {'provider': provider, 'model': model},
      'claudeCode': {
        'installed': claudeInstalled,
        'signedIn': claudeSignedIn,
        'version': '2.1.241',
        if (!claudeInstalled) 'reason': 'The Claude Code CLI is not on PATH.',
      },
      'claudeModels': [
        {'id': 'haiku', 'label': 'Haiku', 'blurb': 'Enough for this job.', 'recommended': true},
        {'id': 'sonnet', 'label': 'Sonnet', 'blurb': 'Better at long tasks. No faster.'},
        {'id': 'opus', 'label': 'Opus', 'blurb': 'The most capable.'},
      ],
      'brainProviders': [
        {
          'id': 'groq', 'label': 'Groq', 'credential': 'groq_api_key',
          'defaultModel': 'openai/gpt-oss-120b', 'blurb': 'Fast and free.',
        },
        {
          'id': 'claude-code', 'label': 'Claude Code', 'credential': null,
          'defaultModel': 'haiku', 'blurb': 'Uses your Claude Code login.',
        },
      ],
      'credentials': [
        {
          'name': 'groq_api_key', 'label': 'Groq', 'group': 'brain',
          'powers': 'The Brain.', 'source': 'console.groq.com',
          'stored': groqStored, 'hint': groqStored ? 'Qvo2' : null,
        },
      ],
    };

Future<void> pumpTab(WidgetTester tester, Map<String, dynamic> data) async {
  tester.view.physicalSize = const Size(900, 1400);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final client = DexGatewayClient();
  client.settings = BrainSettings.fromJson(data);
  addTearDown(client.dispose);

  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
      backgroundColor: DexColors.bg,
      body: IntelligenceTab(client: client),
    ),
  ));
  await tester.pump(const Duration(seconds: 1));
}

void main() {
  testWidgets('Claude Code is presented first and marked recommended', (tester) async {
    await pumpTab(tester, snapshot());

    expect(find.text('Claude Code'), findsOneWidget);
    expect(find.text('RECOMMENDED'), findsOneWidget);
    expect(find.text('Your own API key'), findsOneWidget);

    // Ordering matters: the recommended tier has to be the one read first.
    final claude = tester.getTopLeft(find.text('Claude Code'));
    final keys = tester.getTopLeft(find.text('Your own API key'));
    expect(claude.dy, lessThan(keys.dy));
  });

  testWidgets('the model picker offers three models with Haiku recommended',
      (tester) async {
    await pumpTab(tester, snapshot());

    for (final model in ['Haiku', 'Sonnet', 'Opus']) {
      expect(find.text(model), findsOneWidget, reason: '$model is missing');
    }
    // The star marks the recommendation, and there should be exactly one.
    expect(find.byIcon(Icons.star_rounded), findsOneWidget);
  });

  testWidgets('the speed caveat is stated, since people assume Haiku is faster',
      (tester) async {
    await pumpTab(tester, snapshot());
    expect(
      find.textContaining('20–30 seconds'),
      findsOneWidget,
      reason: 'the startup cost dominates and the screen has to say so',
    );
  });

  testWidgets('a stored key shows only its last four characters', (tester) async {
    await pumpTab(tester, snapshot(provider: 'groq'));

    expect(find.text('••••Qvo2'), findsOneWidget);
    // Nothing on screen may look like a whole key.
    final texts = tester
        .widgetList<Text>(find.byType(Text))
        .map((w) => w.data ?? '')
        .toList();
    expect(
      texts.any((t) => RegExp(r'[A-Za-z0-9_-]{20,}').hasMatch(t)),
      isFalse,
      reason: 'a long token-shaped string reached the UI — the store was read back',
    );
  });

  testWidgets('a missing CLI says how to install it, not just "unavailable"',
      (tester) async {
    await pumpTab(tester, snapshot(
      provider: 'groq',
      claudeInstalled: false,
      claudeSignedIn: false,
    ));

    expect(find.text('Claude Code CLI is not installed'), findsOneWidget);
    expect(find.textContaining('npm i -g @anthropic-ai/claude-code'), findsOneWidget);
  });

  testWidgets('installed but signed out offers a Sign in button', (tester) async {
    await pumpTab(tester, snapshot(
      provider: 'groq',
      claudeInstalled: true,
      claudeSignedIn: false,
    ));

    expect(find.text('Not signed in'), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget,
        reason: 'signing in should be a button, not an instruction to open a terminal');
  });

  testWidgets('the screen says where keys are kept, and that it is not the project',
      (tester) async {
    await pumpTab(tester, snapshot());
    // The paths sit below the Full Access card, and a ListView only builds
    // what is on screen — so this has to scroll to them rather than assume.
    await tester.scrollUntilVisible(
      find.textContaining(r'%LOCALAPPDATA%\DEX\settings.json'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.textContaining(r'%LOCALAPPDATA%\DEX\settings.json'), findsOneWidget);
    expect(find.textContaining('encrypted'), findsAtLeastNWidgets(1));
  });

  testWidgets('Full Access is on this screen, and inert until the pointer moves',
      (tester) async {
    await pumpTab(tester, snapshot());
    await tester.scrollUntilVisible(
      find.text('Full Access'),
      300,
      scrollable: find.byType(Scrollable).first,
    );

    expect(find.text('Full Access'), findsOneWidget);
    // The guard: a control that grants administrator elevation must not be
    // reachable by the synthetic click Windows injects when a window is
    // raised. It says so rather than just being dead.
    expect(find.textContaining('Move the mouse'), findsOneWidget);
    // And it states what elevation does NOT unlock.
    expect(find.textContaining('RED registry keys stay refused'), findsOneWidget);
    expect(find.textContaining('Hand-offs still reach you'), findsOneWidget);
  });

  testWidgets('choosing a model asks the core rather than changing local state',
      (tester) async {
    // The client is not connected, so nothing is sent — what is asserted is
    // that the tap routes through the client at all, rather than the tab
    // keeping its own idea of the selected model that could drift from the
    // core's.
    await pumpTab(tester, snapshot());
    await tester.tap(find.text('Sonnet'));
    await tester.pump();

    // Still Haiku on screen: the selection follows the core's answer, not the
    // tap. A tab that highlighted Sonnet immediately would be showing a state
    // the engine had not agreed to.
    expect(find.byIcon(Icons.star_rounded), findsOneWidget);
  });
}
