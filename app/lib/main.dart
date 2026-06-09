// Dex -- entry point.
//
// Single binary, two windows: the main Dex shell (default) and a
// borderless Spotlight overlay window spawned on-demand via the Ctrl+K
// global hotkey. desktop_multi_window routes every launch through this
// same main(); we inspect WindowController.fromCurrentEngine() to
// decide which one we are.
//
// Layers in the main window:
//   - window_manager + tray_manager: closing the window hides to the
//     tray instead of killing the gateway connection.
//   - hotkey_manager: system-scope Ctrl+K. When Dex is unfocused, the
//     handler spawns the Spotlight sub-window; when focused, it lets
//     the in-app DexComposer Shortcut take over.

import 'dart:async';
import 'dart:io';

import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hotkey_manager/hotkey_manager.dart';
import 'package:window_manager/window_manager.dart';

import 'core/gateway_client.dart';
import 'core/state/conversation_store.dart';
import 'platform/win/tray.dart';
import 'screens/home_desktop.dart';
import 'spotlight_window.dart';
import 'theme/theme.dart';

/// IPC channel name used by the Spotlight sub-window to send the user's
/// prompt back to the main window's ConversationStore.
const String dexSpotlightChannel = 'dex.spotlight';

/// Lets the global-hotkey handler call into Navigator from a non-widget
/// context. Same key bound onto the MaterialApp below.
final GlobalKey<NavigatorState> dexNavigatorKey = GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setApplicationSwitcherDescription(
    const ApplicationSwitcherDescription(label: 'Dex'),
  );

  // desktop_multi_window routes every launch through this same main().
  // The current window's `arguments` tells us which one we are.
  final currentWindow = await WindowController.fromCurrentEngine();
  if (currentWindow.arguments == 'spotlight') {
    await runSpotlightWindow(currentWindow);
    return;
  }

  // ---------- MAIN WINDOW ----------

  // Window + tray init on Windows (no-op on other platforms for now;
  // macOS / Linux land in v1.3 platform abstraction).
  if (Platform.isWindows) {
    await windowManager.ensureInitialized();
    await windowManager.setPreventClose(true);
    await DexTray.instance.init();
  }

  // Read gateway URL + auth token from ~\.dex\openclaw.json (the filename
  // rename to dex.json ships in v1.4); see GatewayConfig.fromLocalConfig
  // for the one-cycle ~/.openclaw/ fallback.
  final client = GatewayClient(GatewayConfig.fromLocalConfig());
  unawaited(client.connect());

  final store = ConversationStore(client);

  // IPC handler: when the Spotlight sub-window submits a prompt, route
  // it to the main store. Restoring the main window happens here so the
  // user can see the streamed reply land.
  const spotlight = WindowMethodChannel(dexSpotlightChannel);
  await spotlight.setMethodCallHandler((call) async {
    if (call.method == 'sendPrompt') {
      final text = (call.arguments as String?)?.trim() ?? '';
      if (text.isEmpty) return null;
      unawaited(_handleSpotlightPrompt(store, text));
      return 'ok';
    }
    return null;
  });

  if (Platform.isWindows) {
    await _registerSpotlightHotkey();
  }

  runApp(DexApp(store: store));
}

Future<void> _handleSpotlightPrompt(
  ConversationStore store,
  String text,
) async {
  // Bring the main window forward so the reply is visible. The
  // Spotlight sub-window itself closes from inside its own onSubmit.
  if (Platform.isWindows) {
    await DexTray.instance.showWindow();
  }
  await store.sendHumanMessage(text);
}

/// Mutex preventing two Ctrl+K presses from racing through
/// `_summonSpotlight` before the first `getAll()` resolves and the
/// second can see the in-flight window. Resets in `finally`.
bool _spotlightSpawning = false;

/// Summon the Spotlight sub-window. Idempotent: if one is already
/// alive (e.g. user hit Ctrl+K twice), re-show that one instead of
/// spawning a duplicate.
///
/// IMPORTANT: we do NOT call `win.show()` on the freshly-created
/// controller. The sub-window's own `windowManager.show()` inside
/// `waitUntilReadyToShow` is what reveals it -- after its first
/// frame is painted. Showing it pre-frame is what produced the
/// brief white flash before the glossy panel rendered.
Future<void> _summonSpotlight() async {
  if (_spotlightSpawning) return;
  _spotlightSpawning = true;
  try {
    try {
      final existing = (await WindowController.getAll())
          .where((w) => w.arguments == 'spotlight')
          .toList(growable: false);
      if (existing.isNotEmpty) {
        await existing.first.show();
        return;
      }
    } catch (_) {
      // getAll() failed -- fall through and try to spawn anyway.
    }
    await WindowController.create(
      const WindowConfiguration(arguments: 'spotlight'),
    );
  } catch (e, st) {
    debugPrint('[dex] spotlight spawn failed: $e\n$st');
  } finally {
    _spotlightSpawning = false;
  }
}

Future<void> _registerSpotlightHotkey() async {
  try {
    await hotKeyManager.unregisterAll();
    final hotKey = HotKey(
      key: PhysicalKeyboardKey.keyK,
      modifiers: [HotKeyModifier.control],
      scope: HotKeyScope.system,
    );
    await hotKeyManager.register(
      hotKey,
      keyDownHandler: (_) async {
        // When the main window is already focused, the in-app
        // DexComposer Shortcut handles Ctrl+K -- it focuses the
        // docked composer. We no-op the system hotkey in that case so
        // the user isn't punished with a modal stealing focus.
        if (await windowManager.isFocused()) return;
        await _summonSpotlight();
      },
    );
  } catch (e, st) {
    debugPrint('[dex] spotlight hotkey registration failed: $e\n$st');
  }
}

void unawaited(Future<void> _) {}

/// App-wide scroll behavior: hides the scrollbar so the home, chat, and
/// settings panels read as one calm Apple-style surface. Scrolling
/// (wheel, trackpad, drag) still works -- only the visible bar is gone.
class DexScrollBehavior extends MaterialScrollBehavior {
  const DexScrollBehavior();

  @override
  Widget buildScrollbar(
    BuildContext context,
    Widget child,
    ScrollableDetails details,
  ) {
    return child;
  }

  @override
  Set<PointerDeviceKind> get dragDevices => <PointerDeviceKind>{
        PointerDeviceKind.touch,
        PointerDeviceKind.mouse,
        PointerDeviceKind.trackpad,
        PointerDeviceKind.stylus,
      };
}

class DexApp extends StatefulWidget {
  const DexApp({super.key, required this.store});

  final ConversationStore store;

  @override
  State<DexApp> createState() => _DexAppState();
}

class _DexAppState extends State<DexApp> with WindowListener {
  @override
  void initState() {
    super.initState();
    if (Platform.isWindows) {
      windowManager.addListener(this);
    }
  }

  @override
  void dispose() {
    if (Platform.isWindows) {
      windowManager.removeListener(this);
    }
    super.dispose();
  }

  @override
  void onWindowClose() async {
    if (!Platform.isWindows) return;
    if (DexTray.instance.quitOnClose) {
      await DexTray.instance.quit();
    } else {
      await DexTray.instance.hideToTray();
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Dex',
      navigatorKey: dexNavigatorKey,
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.dark,
      theme: buildDexLightTheme(),
      darkTheme: buildDexDarkTheme(),
      scrollBehavior: const DexScrollBehavior(),
      home: HomeDesktop(store: widget.store),
    );
  }
}
