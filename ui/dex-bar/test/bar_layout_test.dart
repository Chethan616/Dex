import 'package:dex_bar/core/gateway_client.dart';
import 'package:dex_bar/core/models.dart';
import 'package:dex_bar/screens/dex_bar.dart';
import 'package:dex_bar/theme/tokens.dart';
import 'package:dex_bar/widgets/command_input.dart';
import 'package:dex_bar/widgets/step_stream.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// The bar used to open to a fixed 560px the moment a task started, so a
/// two-line run rendered two lines above four hundred pixels of deliberate
/// emptiness — there was a literal `Spacer()` holding it open.
///
/// These tests watch what height the bar actually asks the window manager for,
/// because that is the thing the owner sees. Both plugins are mocked: the
/// point is the requested geometry, not whether Windows honoured it.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final requested = <Size>[];
  final calls = <String>[];

  setUp(() {
    requested.clear();
    calls.clear();
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

    messenger.setMockMethodCallHandler(
      const MethodChannel('window_manager'),
      (call) async {
        switch (call.method) {
          case 'setBounds':
            final args = call.arguments as Map<dynamic, dynamic>;
            final w = args['width'], h = args['height'];
            if (w != null && h != null) {
              requested.add(Size((w as num).toDouble(), (h as num).toDouble()));
              calls.add('resize');
            }
            // center() lands here too, as a position-only setBounds.
            // center() and setPosition() both arrive as a position-only
            // setBounds; either way the window moved.
            if (args['x'] != null && args['y'] != null) calls.add('move');
          case 'getBounds':
            return <String, dynamic>{
              'x': 0.0,
              'y': 0.0,
              'width': DexTokens.barWidth,
              'height': DexTokens.barRestHeight,
            };
        }
        return null;
      },
    );

    // Federated since screen_retriever 0.2 — the plain 'screen_retriever'
    // name belongs to the old single-package version and mocking it silently
    // does nothing.
    messenger.setMockMethodCallHandler(
      const MethodChannel('dev.leanflutter.plugins/screen_retriever'),
      (call) async => switch (call.method) {
        'getCursorScreenPoint' => <String, dynamic>{'dx': 10.0, 'dy': 10.0},
        'getPrimaryDisplay' => _display,
        'getAllDisplays' => <String, dynamic>{
            'displays': <Map<String, dynamic>>[_display],
          },
        _ => null,
      },
    );
  });

  /// The last height the bar asked for, after letting the post-frame
  /// measurement run.
  ///
  /// The long pumps drain `WindowActivity.markThrough`'s trailing timer, which
  /// re-marks the settle clock once the resize animation would have landed. It
  /// is fire-and-forget in production; a widget test insists nothing outlives
  /// the tree.
  Future<double> settle(WidgetTester tester) async {
    await tester.pump();
    // `center()` awaits two plugins before it repositions anything, and those
    // replies are real futures — the fake clock alone will not deliver them.
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 120)),
    );
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump(const Duration(milliseconds: 400));
    return requested.isEmpty ? -1 : requested.last.height;
  }

  Future<void> show(WidgetTester tester, GatewayClient client) async {
    tester.view.physicalSize = const Size(DexTokens.barWidth, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildDexTheme(Brightness.dark),
        home: Scaffold(body: DexBar(client: client)),
      ),
    );
  }

  testWidgets('the rest row is one row', (tester) async {
    await show(tester, GatewayClient());
    expect(await settle(tester), DexTokens.barRestHeight);

    // And the row itself, not just the window around it.
    expect(
      tester.getSize(find.byType(CommandInput)).height,
      DexTokens.barRestHeight,
    );
  });

  testWidgets('a short run does not open a tall empty box', (tester) async {
    final client = GatewayClient()..connection = CoreConnection.connected;
    client.current = _run(events: 2);

    await show(tester, client);
    final height = await settle(tester);

    expect(height, greaterThan(DexTokens.barRestHeight));
    expect(
      height,
      lessThan(200),
      reason: 'two events plus the input row is a small bar; it used to be 560',
    );
  });

  testWidgets('a long run is taller than a short one, and stays bounded',
      (tester) async {
    final short = GatewayClient()..connection = CoreConnection.connected;
    short.current = _run(events: 2);
    await show(tester, short);
    final shortHeight = await settle(tester);

    requested.clear();

    final long = GatewayClient()..connection = CoreConnection.connected;
    long.current = _run(events: 40);
    await show(tester, long);
    final longHeight = await settle(tester);

    expect(longHeight, greaterThan(shortHeight));
    expect(
      longHeight,
      lessThanOrEqualTo(DexTokens.barMaxHeight),
      reason: 'the stream cap is what keeps the window bounded',
    );
  });

  testWidgets('a confirmation card leaves room for its own buttons',
      (tester) async {
    final client = GatewayClient()..connection = CoreConnection.connected;
    client.current = _run(events: 30);
    final request = _request(tier: 3);
    client.pending[request.key] = request;

    await show(tester, client);
    final height = await settle(tester);

    // The worst realistic case: a Tier 3 card (four controls, wrapping) on top
    // of a long stream. If this exceeds the ceiling the window clips, and what
    // gets clipped is the bottom of the card — the Approve button.
    expect(height, lessThanOrEqualTo(DexTokens.barMaxHeight));
    expect(tester.takeException(), isNull);
    expect(find.text('Approve once'), findsOneWidget);
    expect(find.text('Approve for session'), findsOneWidget);
    expect(find.text('Cancel task'), findsOneWidget);
  });

  testWidgets('the window is positioned once per task, then left alone',
      (tester) async {
    final client = GatewayClient()..connection = CoreConnection.connected;
    client.current = _run(events: 2);
    await show(tester, client);
    await settle(tester);

    // Leaving the rest row anchors the window. It has to happen: a bar
    // positioned while it was one row tall grows off the bottom of the screen
    // once a card opens under it, and what falls off is the Approve button.
    expect(
      calls.where((c) => c == 'move'),
      hasLength(1),
      reason: 'expected exactly one reposition on open, got: $calls',
    );

    for (var i = 0; i < 20; i++) {
      calls.clear();
      client.current!.events.add(
        DexEvent(
          type: 'executing',
          message: 'another line $i',
          requestId: 'r1',
          timestamp: 100 + i,
          stepId: 'step_$i',
        ),
      );
      client.notifyListeners();
      await settle(tester);

      expect(
        calls,
        isNot(contains('move')),
        reason: 'output must never move the window — it moved on line $i',
      );
    }
  });

  testWidgets('growth stops at the ceiling and the stream scrolls instead',
      (tester) async {
    final client = GatewayClient()..connection = CoreConnection.connected;
    client.current = _run(events: 60);
    await show(tester, client);
    final tall = await settle(tester);

    expect(tall, lessThanOrEqualTo(DexTokens.barMaxHeight));

    // Sixty events do not fit; the list must be scrollable and pinned to the
    // newest line, so old output scrolls up out of view rather than pushing
    // the window taller.
    // .first is the ListView's own Scrollable; each SelectableText below it
    // brings one of its own.
    final scrollable = find
        .descendant(of: find.byType(StepStream), matching: find.byType(Scrollable))
        .first;

    final position = tester.state<ScrollableState>(scrollable).position;
    expect(
      position.maxScrollExtent,
      greaterThan(0),
      reason: 'the stream should be scrolling, not growing',
    );
    expect(
      position.pixels,
      moreOrLessEquals(position.maxScrollExtent, epsilon: 1),
      reason: 'the newest line should be the one you can see',
    );
  });

  testWidgets('collapsing back to rest re-centres, ready for the next task',
      (tester) async {
    final client = GatewayClient()..connection = CoreConnection.connected;
    client.current = _run(events: 3);
    await show(tester, client);
    await settle(tester);
    expect(calls.where((c) => c == 'move'), hasLength(1));

    calls.clear();
    client.current = null;
    client.notifyListeners();
    await settle(tester);

    expect(requested.last.height, DexTokens.barRestHeight);
    expect(
      calls,
      contains('move'),
      reason: 'back at rest the bar should centre again, so the next task '
          'anchors from a sensible place',
    );
  });

  testWidgets('the exact params are on the card, not just the summary',
      (tester) async {
    final client = GatewayClient()..connection = CoreConnection.connected;
    final request = _request(tier: 2);
    client.pending[request.key] = request;

    await show(tester, client);
    await settle(tester);

    // These arrive on the wire and were never rendered. The description line
    // is a summary the core composed; this is what will actually be sent.
    expect(find.text('primary'), findsOneWidget);
    expect(find.text('1.1.1.1'), findsOneWidget);
  });
}

/// Shaped for screen_retriever_platform_interface 0.2.x, where `id` is a
/// String rather than the num the old single-package version used.
const _display = <String, dynamic>{
  'id': 'mock-display-1',
  'name': 'mock',
  'size': {'width': 1920.0, 'height': 1080.0},
  'visiblePosition': {'dx': 0.0, 'dy': 0.0},
  'visibleSize': {'width': 1920.0, 'height': 1040.0},
  'scaleFactor': 1.0,
};

TaskRun _run({required int events}) {
  final run = TaskRun(
    requestId: 'r1',
    prompt: 'set my volume to 35',
    startedAt: DateTime.now().millisecondsSinceEpoch,
  );
  run.phase = TaskPhase.running;
  for (var i = 0; i < events; i++) {
    run.events.add(
      DexEvent(
        type: i.isEven ? 'executing' : 'planning',
        message: 'set_volume({"level":35}) — step $i',
        requestId: 'r1',
        timestamp: i,
        stepId: 'step_$i',
      ),
    );
  }
  return run;
}

ConfirmationRequest _request({required int tier}) => ConfirmationRequest(
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
