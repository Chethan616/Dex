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
import 'package:shared_preferences/shared_preferences.dart';
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
    await _restoreWindowState();
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

/// Read the saved window size + position + maximized flag and apply
/// them before the first frame. `waitUntilReadyToShow` lets us call
/// `maximize`/`setBounds` against the OS window without the user
/// seeing the default-sized window flash before the restore lands.
Future<void> _restoreWindowState() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    final maximized = prefs.getBool(prefsKeyWindowMaximized) ?? false;
    final rawBounds = prefs.getString(prefsKeyWindowBounds);
    final savedBounds = _parseBounds(rawBounds);

    // The window is invisible until the tray click brings it in; we
    // still apply state here so the FIRST show is correctly shaped.
    await windowManager.waitUntilReadyToShow(null, () async {
      if (maximized) {
        await windowManager.maximize();
      } else if (savedBounds != null) {
        await windowManager.setBounds(savedBounds);
      }
    });
  } catch (e, st) {
    debugPrint('[dex] window state restore failed: $e\n$st');
  }
}

/// Parse `"x,y,w,h"` back into a [Rect]. Returns null on any malformed
/// input so a corrupt prefs blob never breaks the restore path.
Rect? _parseBounds(String? raw) {
  if (raw == null || raw.isEmpty) return null;
  final parts = raw.split(',');
  if (parts.length != 4) return null;
  final values = <double>[];
  for (final part in parts) {
    final v = double.tryParse(part.trim());
    if (v == null || !v.isFinite) return null;
    values.add(v);
  }
  // Reject zero/negative sizes; they would produce a fully collapsed
  // window the user can't grab. Defer to a fresh default.
  if (values[2] <= 0 || values[3] <= 0) return null;
  return Rect.fromLTWH(values[0], values[1], values[2], values[3]);
}

Future<void> _handleSpotlightPrompt(
  ConversationStore store,
  String text,
) async {
  // Push the message into the store FIRST. sendHumanMessage's
  // synchronous prefix (append + state flip + notifyListeners) runs
  // before any await, so by the time we yield, the home pane has
  // already rebuilt from EmptyHome → ChatView. THEN bring the main
  // window forward and the user lands directly on the streaming
  // reply instead of seeing a one-frame flash of the empty home.
  final delivery = store.sendHumanMessage(text);
  if (Platform.isWindows) {
    await DexTray.instance.showWindow();
  }
  await delivery;
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
  /// Debounce timer for bounds writes. Without it, dragging a window
  /// to a new position would fire dozens of onWindowMove ticks per
  /// second, each scheduling a prefs write. 300ms is the same window
  /// used by other apps that persist drag state (Linear, VS Code).
  Timer? _boundsSaveDebounce;

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
    _boundsSaveDebounce?.cancel();
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
  void onWindowResize() => _scheduleBoundsSave();

  @override
  void onWindowMove() => _scheduleBoundsSave();

  @override
  void onWindowMaximize() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(prefsKeyWindowMaximized, true);
  }

  @override
  void onWindowUnmaximize() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(prefsKeyWindowMaximized, false);
    // After the unmaximize lands, immediately persist the natural
    // restore-bounds so a follow-up launch lands in the same shape.
    _scheduleBoundsSave();
  }

  void _scheduleBoundsSave() {
    _boundsSaveDebounce?.cancel();
    _boundsSaveDebounce = Timer(const Duration(milliseconds: 300), () async {
      try {
        // Don't persist bounds while maximized -- the OS reports the
        // maximized rect, not the restore rect, so saving it would
        // collapse the next launch into "maximized but at full screen
        // coords" if the user unmaximized first.
        if (await windowManager.isMaximized()) return;
        final bounds = await windowManager.getBounds();
        if (!bounds.size.isFinite ||
            bounds.width <= 0 ||
            bounds.height <= 0) {
          return;
        }
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(
          prefsKeyWindowBounds,
          '${bounds.left},${bounds.top},${bounds.width},${bounds.height}',
        );
      } catch (e, st) {
        debugPrint('[dex] window bounds save failed: $e\n$st');
      }
    });
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
