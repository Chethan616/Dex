import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hotkey_manager/hotkey_manager.dart';
import 'package:window_manager/window_manager.dart';

import '../core/gateway_client.dart';
import '../core/supervisor/supervisor.dart';
import '../core/supervisor/win32_spawn.dart';
import '../core/theme_controller.dart';
import '../core/window_activity.dart';
import '../main.dart';
import '../screens/shell.dart';
import '../screens/splash.dart';
import '../theme/tokens.dart';

/// The application: splash, then shell.
///
/// This process owns the supervisor, which means it owns every other Dex
/// process. Closing this window ends all of them — enforced by the job object
/// in win32_spawn.dart rather than by anything here, so it holds even when
/// this code does not get to run.
class DexShellApp extends StatefulWidget {
  const DexShellApp({super.key});

  @override
  State<DexShellApp> createState() => _DexShellAppState();
}

class _DexShellAppState extends State<DexShellApp> with WindowListener {
  final _client = GatewayClient();
  final _theme = ThemeController();
  final _supervisor = Supervisor();
  final _shell = GlobalKey<DexShellState>();

  bool _ready = false;
  SpawnedProcess? _bar;

  @override
  void initState() {
    super.initState();
    windowManager.addListener(this);
    _theme.load();
    _registerHotkeys();
  }

  /// Called by the splash once every required process is up.
  Future<void> _enterShell() async {
    if (_ready) return;
    setState(() => _ready = true);

    await growIntoShell();

    // Connect only now. Before the core is up this would spin through its
    // reconnect backoff and put "Core not running" on screen underneath a
    // splash that is busy starting the core — two truths at once, one of them
    // stale.
    await _client.connect();
    _startBarWindow();
  }

  /// Launch the overlay as a second copy of this executable.
  ///
  /// It is spawned through the same job object as the agents, so it closes
  /// when this window does. A stale bar left behind after the app quits would
  /// be a window with no way to reach it and no way to close it.
  void _startBarWindow() {
    if (_bar != null) return;
    try {
      _bar = ProcessJob.instance.spawn(
        executable: Platform.resolvedExecutable,
        arguments: ['--bar'],
        label: 'bar',
      );
    } catch (_) {
      // Not fatal. Alt+Space stops working; the app does not.
    }
  }

  /// Hotkeys owned by this window.
  ///
  /// Alt+Space belongs to the bar process, which registers it itself — a
  /// system hotkey can have exactly one owner, and the bar is the one that
  /// needs to appear.
  Future<void> _registerHotkeys() async {
    await hotKeyManager.unregisterAll();
    try {
      await hotKeyManager.register(
        HotKey(
          key: PhysicalKeyboardKey.keyD,
          modifiers: [HotKeyModifier.alt, HotKeyModifier.shift],
          scope: HotKeyScope.system,
        ),
        keyDownHandler: (_) async {
          WindowActivity.mark();
          await windowManager.show();
          await windowManager.focus();
          WindowActivity.markThrough(const Duration(milliseconds: 600));
        },
      );
    } catch (_) {
      // Another application owns it. The window is still reachable normally.
    }
  }

  // Any focus or geometry change can put a control where the pointer already
  // is, so each one restarts the settle clock that arms the confirmation card
  // and the Full Access chip.
  @override
  void onWindowFocus() => WindowActivity.mark();

  @override
  void onWindowRestore() => WindowActivity.mark();

  @override
  void onWindowResized() => WindowActivity.mark();

  @override
  void onWindowMoved() => WindowActivity.mark();

  @override
  void dispose() {
    windowManager.removeListener(this);
    hotKeyManager.unregisterAll();
    _supervisor.dispose();
    _theme.dispose();
    _client.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([_theme, _client]),
      builder: (context, _) => MaterialApp(
        debugShowCheckedModeBanner: false,
        title: 'Dex',
        theme: buildDexTheme(Brightness.light),
        darkTheme: buildDexTheme(Brightness.dark),
        themeMode: _theme.mode,
        home: Listener(
          // Real pointer movement is what tells an aimed click apart from the
          // synthetic one Windows injects when a window is raised.
          onPointerHover: (_) => WindowActivity.notePointerMoved(),
          onPointerMove: (_) => WindowActivity.notePointerMoved(),
          child: Shortcuts(
            shortcuts: _shortcuts,
            child: Actions(
              actions: _actions,
              child: Focus(
                autofocus: true,
                child: Scaffold(
                  backgroundColor: Colors.transparent,
                  body: _ready
                      ? DexShell(
                          key: _shell,
                          client: _client,
                          supervisor: _supervisor,
                          theme: _theme,
                        )
                      : SplashScreen(
                          supervisor: _supervisor,
                          onEnter: _enterShell,
                        ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Map<ShortcutActivator, Intent> get _shortcuts => const {
        SingleActivator(LogicalKeyboardKey.comma, control: true):
            _GoIntent('Settings'),
        SingleActivator(LogicalKeyboardKey.keyL, control: true):
            _GoIntent('Logs'),
        SingleActivator(LogicalKeyboardKey.keyH, control: true):
            _GoIntent('Home'),
        SingleActivator(LogicalKeyboardKey.keyT, control: true):
            _GoIntent('Tasks'),
        SingleActivator(LogicalKeyboardKey.keyJ, control: true):
            _GoIntent('Schedules'),
        SingleActivator(LogicalKeyboardKey.keyW, control: true):
            _GoIntent('Workflows'),
        SingleActivator(LogicalKeyboardKey.escape): _StopIntent(),
      };

  Map<Type, Action<Intent>> get _actions => {
        _GoIntent: CallbackAction<_GoIntent>(
          onInvoke: (intent) {
            _shell.currentState?.goTo(intent.destination);
            return null;
          },
        ),
        _StopIntent: CallbackAction<_StopIntent>(
          onInvoke: (_) {
            _client.cancelCurrent();
            return null;
          },
        ),
      };
}

class _GoIntent extends Intent {
  const _GoIntent(this.destination);
  final String destination;
}

class _StopIntent extends Intent {
  const _StopIntent();
}
