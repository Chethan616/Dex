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
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';
import 'package:window_manager/window_manager.dart';

import 'core/dex_prefs.dart';
import 'core/dex_gateway.dart';
import 'core/window_activity.dart';
import 'core/log.dart';
import 'core/state/conversation_store.dart';
import 'platform/win/tray.dart';
import 'screens/home_desktop.dart';
import 'screens/splash_screen.dart';
import 'spotlight_window.dart';
import 'theme/theme.dart';
import 'widgets/composer/slash_commands.dart';

/// IPC channel name used by the Spotlight sub-window to send the user's
/// prompt back to the main window's ConversationStore.
const String dexSpotlightChannel = 'dex.spotlight';

/// Lets the global-hotkey handler call into Navigator from a non-widget
/// context. Same key bound onto the MaterialApp below.
final GlobalKey<NavigatorState> dexNavigatorKey = GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Route uncaught framework + zone errors into the in-app Diagnostics
  // panel so crashes are visible without a console.
  DexLog.installGlobalHandlers();
  SystemChrome.setApplicationSwitcherDescription(
    const ApplicationSwitcherDescription(label: 'Dex'),
  );

  // Pre-warm the liquid-glass shaders before the first frame (both the
  // main window and the spotlight sub-window paths run through here, so
  // both get warm shaders and no white flash). Non-critical: it no-ops on
  // renderers without shader-filter support.
  await LiquidGlassWidgets.initialize();

  // desktop_multi_window routes every launch through this same main().
  // The current window's `arguments` tells us which one we are.
  final currentWindow = await WindowController.fromCurrentEngine();
  if (currentWindow.arguments == 'spotlight') {
    await runSpotlightWindow(currentWindow);
    return;
  }

  // ---------- MAIN WINDOW ----------

  // Load UI preferences (theme, hotkey, autostart, ...) before the first
  // frame so the app opens in the user's chosen theme with no flash.
  await DexPrefs.init();

  // Window + tray init on Windows (no-op on other platforms for now;
  // macOS / Linux land in v1.3 platform abstraction).
  // Window geometry (size, position, maximized) is persisted and
  // restored NATIVELY by the runner (win32_window.cpp) via the standard
  // WINDOWPLACEMENT registry round-trip -- the window is already in the
  // right shape before the first frame, so no Dart-side restore exists.
  if (Platform.isWindows) {
    await windowManager.ensureInitialized();
    await windowManager.setPreventClose(true);
    await DexTray.instance.init();
  }

  // Connection details come from the Dex core's own handshake file, the same
  // one the Dex Bar reads — never a hardcoded port, and never a second config
  // that could disagree with the core about where the core is.
  final client = DexGatewayClient();
  // First line in Diagnostics so the panel is never empty: states the
  // target + whether we have a token, the two things that decide whether
  // a connection can even be attempted.
  DexLog.i('app', 'Dex started — core handshake ${DexGatewayClient.handshakeFile.path}');
  // Dex owns its brain: when no gateway is listening, spawn the bundled
  // (or npm-installed) dexagent runtime DETACHED -- the user never
  // opens a terminal. Connection proceeds either way; the banner
  // explains if both paths fail.
  // The core is started by the supervisor, not from here. Connecting retries
  // on its own backoff, so starting before the core is listening is fine.
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

  await registerSpotlightHotkey();

  // Wrap the whole app in the liquid-glass infrastructure so every Glass*
  // widget inherits app-wide defaults + adaptive quality. Dark/light glass
  // variants follow the platform brightness.
  runApp(LiquidGlassWidgets.wrap(
    adaptiveQuality: true,
    theme: const GlassThemeData(),
    child: DexApp(store: store),
  ));
}

Future<void> _handleSpotlightPrompt(
  ConversationStore store,
  String text,
) async {
  // A slash command from the spotlight runs in the main window (it owns
  // the navigator + dialogs), then we surface that window.
  if (SlashCommands.looksLikeCommand(text)) {
    if (Platform.isWindows) await DexTray.instance.showWindow();
    // Re-read the navigator context AFTER surfacing the window so it's
    // current; null only if the app has no live route yet.
    final ctx = dexNavigatorKey.currentContext;
    if (ctx != null && ctx.mounted) {
      await SlashCommands.handle(
        SlashContext(
          context: ctx,
          sendMessage: store.sendHumanMessage,
          onStop: store.stop,
          onClear: store.clearMessages,
        ),
        text,
      );
    }
    return;
  }
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

/// Register (or clear) the global summon hotkey from the saved pref.
/// Called at startup and again whenever Settings changes the choice, so
/// the binding is always live. "None" leaves no system hotkey registered.
Future<void> registerSpotlightHotkey() async {
  if (!Platform.isWindows) return;
  try {
    await hotKeyManager.unregisterAll();
    final binding = _hotKeyFor(DexPrefs.hotkey);
    if (binding == null) return; // "None" -- nothing registered.
    await hotKeyManager.register(
      binding,
      keyDownHandler: (_) async {
        // When the main window is already focused, the in-app
        // DexComposer Shortcut handles the summon key -- it focuses the
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

HotKey? _hotKeyFor(String label) => switch (label) {
      'Ctrl+K' => HotKey(
          key: PhysicalKeyboardKey.keyK,
          modifiers: [HotKeyModifier.control],
          scope: HotKeyScope.system,
        ),
      'Alt+Space' => HotKey(
          key: PhysicalKeyboardKey.space,
          modifiers: [HotKeyModifier.alt],
          scope: HotKeyScope.system,
        ),
      _ => null, // "None"
    };

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
  /// Launch routing: splash while the shaders warm, then the cockpit.
  ///
  /// There is no sign-in step and no onboarding gate — see _buildRoot.

  // Splash holds the first ~2.2s so the off-screen warm strip compiles the
  // glass shaders before the cockpit paints — smooth on the very first use.
  bool _splashDone = false;

  @override
  void initState() {
    super.initState();
    Future<void>.delayed(const Duration(milliseconds: 2200), () {
      if (mounted) setState(() => _splashDone = true);
    });
    if (Platform.isWindows) {
      windowManager.addListener(this);
    }
  }

  // Any focus or geometry change can put a control where the pointer already
  // is, so each one restarts the settle clock.
  @override
  void onWindowFocus() => WindowActivity.mark();

  @override
  void onWindowRestore() => WindowActivity.mark();

  @override
  void onWindowResized() => WindowActivity.mark();

  @override
  void onWindowMoved() => WindowActivity.mark();

  /// Kept because HomeDesktop takes it, and because a future real sign-out
  /// would land here. It no longer gates anything: there is nothing to sign
  /// out of, so the cockpit stays where it is.
  Future<void> _signOut() async {}

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
    // Geometry persistence happens natively on WM_DESTROY
    // (win32_window.cpp), so close just routes to tray-hide or quit.
    if (DexTray.instance.quitOnClose) {
      await DexTray.instance.quit();
    } else {
      await DexTray.instance.hideToTray();
    }
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<ThemeMode>(
      valueListenable: DexPrefs.themeMode,
      builder: (context, mode, _) => MaterialApp(
        title: 'Dex',
        navigatorKey: dexNavigatorKey,
        debugShowCheckedModeBanner: false,
        themeMode: mode,
        theme: buildDexLightTheme(),
        darkTheme: buildDexDarkTheme(),
        scrollBehavior: const DexScrollBehavior(),
        // Real pointer movement is what distinguishes an aimed click from the
        // synthetic one Windows injects when a window is raised. Consequential
        // controls — Approve, Deny, Full Access — stay inert until it happens.
        home: Listener(
          onPointerHover: (_) => WindowActivity.notePointerMoved(),
          onPointerMove: (_) => WindowActivity.notePointerMoved(),
          child: _buildRoot(),
        ),
      ),
    );
  }

  Widget _buildRoot() {
    if (!_splashDone) {
      // Branded splash while the glass shaders warm up.
      return const SplashScreen();
    }
    // No sign-in.
    //
    // There was a LoginScreen here, and it gated the whole app on an account
    // that existed only in local preferences — nothing was authenticated, no
    // server was contacted, and signing out changed nothing but a boolean.
    // A password prompt that protects nothing is a cost with no benefit: it
    // stood between the owner and their own machine, and it made the app
    // untestable, because a test harness lands on a login form it cannot fill.
    //
    // Dex is a local tool on a Windows account that is already signed in. The
    // credentials that matter — API keys, the Claude Code session — live in
    // Settings under Intelligence, where they can be checked and changed.
    return HomeDesktop(store: widget.store, onSignOut: _signOut);
  }
}
