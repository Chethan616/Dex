import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hotkey_manager/hotkey_manager.dart';
import 'package:window_manager/window_manager.dart';

import '../core/gateway_client.dart';
import '../core/theme_controller.dart';
import '../core/window_activity.dart';
import '../screens/dex_bar.dart';
import '../theme/tokens.dart';

/// The Alt+Space overlay, unchanged.
///
/// This was `main.dart` before the application window existed, and it is
/// deliberately the same code: the bar works, its window behaviour is
/// carefully tuned, and every one of the odd-looking details below is there
/// because of a specific failure.
///
/// It runs in its own process, launched with `--bar` by the main window. It
/// keeps no state of its own — the core broadcasts to every connected client,
/// so this and the application window see the same task without talking to
/// each other.
class DexBarApp extends StatefulWidget {
  const DexBarApp({super.key});

  @override
  State<DexBarApp> createState() => _DexBarAppState();
}

class _DexBarAppState extends State<DexBarApp> with WindowListener {
  final _client = GatewayClient();
  final _theme = ThemeController();

  @override
  void initState() {
    super.initState();
    windowManager.addListener(this);
    _client.addListener(_surfaceWhenNeeded);
    _client.connect();
    _theme.load();
    _registerHotkey();
  }

  /// Tracks which confirmation we last surfaced for, so the window is raised
  /// once per card rather than on every event that arrives while it waits.
  /// Repeatedly calling show/focus fights the owner for focus and re-centres
  /// the window under their pointer, which is how a stray click lands on a
  /// button they never aimed at.
  String? _surfacedFor;

  /// A confirmation card is useless behind a hidden window. If the core asks
  /// for approval — whoever started the task — bring the bar forward once.
  Future<void> _surfaceWhenNeeded() async {
    if (_client.pending.isEmpty) {
      _surfacedFor = null;
      return;
    }
    final key = _client.pending.keys.first;
    if (_surfacedFor == key) return;
    _surfacedFor = key;

    if (await windowManager.isVisible()) return;

    // Mark before and after: show/focus injects a synthetic mouse event whose
    // delivery can lag the call, so the settle clock has to cover both sides.
    WindowActivity.mark();
    await windowManager.show();
    await windowManager.focus();
    WindowActivity.markThrough(const Duration(milliseconds: 600));
  }

  // Any focus change or geometry change can put a control somewhere the
  // pointer already is. Each one restarts the settle clock that gates the
  // confirmation card's buttons.
  @override
  void onWindowFocus() => WindowActivity.mark();

  @override
  void onWindowRestore() => WindowActivity.mark();

  @override
  void onWindowResize() => WindowActivity.mark();

  @override
  void onWindowResized() => WindowActivity.mark();

  @override
  void onWindowMove() => WindowActivity.mark();

  @override
  void onWindowMoved() => WindowActivity.mark();

  /// Alt+Space summons or dismisses the bar from anywhere in Windows.
  /// Deliberately not a Windows-key shortcut — those are reserved by the OS.
  Future<void> _registerHotkey() async {
    await hotKeyManager.unregisterAll();
    final hotKey = HotKey(
      key: PhysicalKeyboardKey.space,
      modifiers: [HotKeyModifier.alt],
      scope: HotKeyScope.system,
    );
    try {
      await hotKeyManager.register(
        hotKey,
        keyDownHandler: (_) async {
          if (await windowManager.isVisible() && await windowManager.isFocused()) {
            await windowManager.hide();
          } else {
            WindowActivity.mark();
            await windowManager.show();
            await windowManager.focus();
            WindowActivity.markThrough(const Duration(milliseconds: 600));
          }
        },
      );
    } catch (_) {
      // Another app already owns Alt+Space — the bar still works, just not globally.
    }
  }

  @override
  void onWindowBlur() {
    // Stay put while a confirmation is waiting; otherwise get out of the way.
    if (_client.pending.isEmpty && _client.current == null) windowManager.hide();
  }

  @override
  void dispose() {
    windowManager.removeListener(this);
    _client.removeListener(_surfaceWhenNeeded);
    hotKeyManager.unregisterAll();
    _theme.dispose();
    _client.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _theme,
      builder: (context, _) => MaterialApp(
        debugShowCheckedModeBanner: false,
        title: 'Dex',
        theme: buildDexTheme(Brightness.light),
        darkTheme: buildDexTheme(Brightness.dark),
        themeMode: _theme.mode,
        // Real pointer movement is what distinguishes an aimed click from the
        // synthetic one Windows injects when a window is raised.
        home: Listener(
          onPointerHover: (_) => WindowActivity.notePointerMoved(),
          onPointerMove: (_) => WindowActivity.notePointerMoved(),
          child: Scaffold(
            backgroundColor: Colors.transparent,
            body: DexBar(client: _client, theme: _theme),
          ),
        ),
      ),
    );
  }
}
