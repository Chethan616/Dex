import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';

import 'app/bar_app.dart';
import 'app/shell_app.dart';
import 'theme/tokens.dart';

/// Dex has two windows, and they are two processes.
///
/// The main window is the application: home, tasks, workflows, logs, settings.
/// The Alt+Space bar is a frameless strip that appears over whatever you are
/// doing. Flutter gives one window per process, so the app launches a second
/// copy of itself with `--bar` and lets that copy own the overlay.
///
/// Splitting them costs nothing to keep in sync, because neither holds state:
/// the core is the single source of truth and broadcasts to every connected
/// client. A task typed into the bar appears in the main window's stream
/// because both are watching the same WebSocket, not because they talk to each
/// other. And the bar process is started into the same job object as the
/// agents, so it closes when Dex does.
Future<void> main(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();
  await windowManager.ensureInitialized();

  if (args.contains('--bar')) {
    await runBarWindow();
  } else {
    await runMainWindow();
  }
}

/// The application window. Starts on the splash, which is sized for it.
Future<void> runMainWindow() async {
  await windowManager.waitUntilReadyToShow(
    const WindowOptions(
      size: Size(560, 640),
      minimumSize: Size(560, 640),
      center: true,
      backgroundColor: Colors.transparent,
      skipTaskbar: false,
      titleBarStyle: TitleBarStyle.hidden,
      windowButtonVisibility: false,
      title: 'Dex',
    ),
    () async {
      await windowManager.setAsFrameless();
      await windowManager.setHasShadow(true);
      await windowManager.setResizable(false);
      await windowManager.show();
      await windowManager.focus();
    },
  );

  runApp(const DexShellApp());
}

/// Grow from the splash into the application window.
///
/// The minimum is lifted first. Setting a size smaller than the current
/// minimum is silently clamped, so doing this the other way round leaves the
/// window stuck at splash size with a shell drawn inside it.
Future<void> growIntoShell() async {
  await windowManager.setMinimumSize(const Size(940, 640));
  await windowManager.setSize(const Size(1180, 780));
  await windowManager.setResizable(true);
  await windowManager.center();
  await windowManager.focus();
}

/// The Alt+Space overlay, in its own process.
Future<void> runBarWindow() async {
  await windowManager.waitUntilReadyToShow(
    const WindowOptions(
      size: Size(DexTokens.barWidth, DexTokens.barRestHeight),
      center: true,
      backgroundColor: Colors.transparent,
      // Off the taskbar: it is an overlay, not a second application, and a
      // second Dex entry would be confusing every time you alt-tab.
      skipTaskbar: true,
      titleBarStyle: TitleBarStyle.hidden,
      windowButtonVisibility: false,
      alwaysOnTop: true,
      title: 'Dex',
    ),
    () async {
      await windowManager.setAsFrameless();
      await windowManager.setHasShadow(true);
      await windowManager.show();
      await windowManager.focus();
    },
  );

  runApp(const DexBarApp());
}
