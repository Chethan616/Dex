// Dex -- entry point.
//
// Boots the app, wires the GatewayClient + ConversationStore, and hands the
// home screen the listenable store. v1.2 Phase 11 layered on:
//   - window_manager + tray_manager: closing the window hides to the
//     tray instead of killing the gateway connection.
//   - hotkey_manager: system-scope Ctrl+K summons the SpotlightOverlay
//     even when Dex is hidden in the tray.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hotkey_manager/hotkey_manager.dart';
import 'package:window_manager/window_manager.dart';

import 'core/gateway_client.dart';
import 'core/state/conversation_store.dart';
import 'platform/win/tray.dart';
import 'screens/home_desktop.dart';
import 'theme/theme.dart';
import 'widgets/spotlight_overlay.dart';

/// Lets the global-hotkey handler call into Navigator from a non-widget
/// context. Same key bound onto the MaterialApp below.
final GlobalKey<NavigatorState> dexNavigatorKey = GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setApplicationSwitcherDescription(
    const ApplicationSwitcherDescription(label: 'Dex'),
  );

  // Window + tray init on Windows (no-op on other platforms for now;
  // macOS / Linux land in v1.3 platform abstraction).
  if (Platform.isWindows) {
    await windowManager.ensureInitialized();
    // Intercept the close button so the WindowListener can decide
    // between hide-to-tray and quit per the user's preference.
    await windowManager.setPreventClose(true);
    await DexTray.instance.init();
  }

  // Read gateway URL + auth token from ~\.dex\openclaw.json (the filename
  // rename to dex.json ships in v1.4); see GatewayConfig.fromLocalConfig
  // for the one-cycle ~/.openclaw/ fallback.
  final client = GatewayClient(GatewayConfig.fromLocalConfig());
  // Best-effort connect; the UI shows the live connection state.
  unawaited(client.connect());

  final store = ConversationStore(client);

  // Register the global Ctrl+K hotkey AFTER the store + tray exist so
  // the handler has everything it needs. Failures are non-fatal --
  // the in-app Shortcuts on DexComposer still bind Ctrl+K within the
  // window, so the worst case is "no summon while hidden in tray".
  if (Platform.isWindows) {
    await _registerSpotlightHotkey(store);
  }

  runApp(DexApp(store: store));
}

Future<void> _registerSpotlightHotkey(ConversationStore store) async {
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
        // DexComposer Shortcuts handle Ctrl+K -- they focus the
        // docked composer directly. Stacking a modal overlay on top
        // would just steal focus from that composer, which is the
        // "why does the overlay open when I'm already in the app"
        // pain. So we no-op the system hotkey while focused and
        // only fire the spotlight from background / hidden.
        if (await windowManager.isFocused()) return;
        // dexNavigatorKey.currentContext is a GlobalKey lookup, not a
        // captured BuildContext, so it's safe across the await above.
        // ignore: use_build_context_synchronously
        final ctx = dexNavigatorKey.currentContext;
        if (ctx == null) return;
        // ignore: use_build_context_synchronously
        SpotlightOverlay.show(ctx, store);
      },
    );
  } catch (e, st) {
    // Don't crash the app over a hotkey registration failure.
    debugPrint('[dex] spotlight hotkey registration failed: $e\n$st');
  }
}

void unawaited(Future<void> _) {}

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
    // setPreventClose(true) routes the X here. Per the user's pref:
    // either hide to tray (default) or exit cleanly.
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
      home: HomeDesktop(store: widget.store),
    );
  }
}
