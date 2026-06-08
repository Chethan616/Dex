// Dex -- entry point.
//
// Boots the app, wires the GatewayClient + ConversationStore, and hands the
// home screen the listenable store. v1.2 Phase 11 adds a window_manager
// + system_tray pair so closing the window hides to the tray instead of
// killing the gateway connection.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:window_manager/window_manager.dart';

import 'core/gateway_client.dart';
import 'core/state/conversation_store.dart';
import 'platform/win/tray.dart';
import 'screens/home_desktop.dart';
import 'theme/theme.dart';

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

  runApp(DexApp(store: store));
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
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.dark,
      theme: buildDexLightTheme(),
      darkTheme: buildDexDarkTheme(),
      home: HomeDesktop(store: widget.store),
    );
  }
}
