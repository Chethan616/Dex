// v1.2 Phase 11 — Windows system tray integration.
//
// Owns the close-to-tray behavior: when the user hits the X, the window
// hides instead of quitting; the tray icon is the way back. A small menu
// gives them Show / Quit-on-close-toggle / Quit explicitly.
//
// The tray icon ships as a bundled Flutter asset (assets/tray/dex.ico)
// rather than a runner resource path because tray_manager on Windows
// needs an absolute path on disk -- we resolve it from rootBundle into
// a stable temp file once at startup.

import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tray_manager/tray_manager.dart';
import 'package:window_manager/window_manager.dart';

/// Persisted preference key for the tray-menu "Quit on close" toggle.
/// When true, hitting X exits the process instead of hiding to tray.
const String prefsKeyQuitOnClose = 'dex.window.quitOnClose';

class DexTray with TrayListener {
  DexTray._();
  static final DexTray instance = DexTray._();

  bool _initialized = false;
  bool _quitOnClose = false;

  /// True when the user has flipped the tray menu's "Quit on close"
  /// checkbox. Drives [WindowListener.onWindowClose] in main.dart.
  bool get quitOnClose => _quitOnClose;

  /// Initialize the tray icon + menu. Safe to call once at startup;
  /// repeated calls are no-ops. On non-Windows this is a no-op so the
  /// rest of main.dart stays portable; macOS / Linux land in v1.3.
  Future<void> init() async {
    if (_initialized) return;
    if (!Platform.isWindows) {
      _initialized = true;
      return;
    }

    final prefs = await SharedPreferences.getInstance();
    _quitOnClose = prefs.getBool(prefsKeyQuitOnClose) ?? false;

    final iconPath = await _resolveTrayIconPath();
    await trayManager.setIcon(iconPath);
    await trayManager.setToolTip('Dex — calm cockpit');
    await _rebuildMenu();
    trayManager.addListener(this);

    _initialized = true;
  }

  /// Restore + focus the main window. Used by the tray click handler
  /// and by the future Spotlight overlay's "summon" path.
  Future<void> showWindow() async {
    if (!await windowManager.isVisible()) {
      await windowManager.show();
    }
    await windowManager.focus();
  }

  /// Hide the window to the tray. Called from the close-intercept
  /// when [quitOnClose] is false.
  Future<void> hideToTray() async {
    await windowManager.hide();
  }

  /// Cleanly exit the app. Called from the tray menu's Quit item and
  /// from the close-intercept when [quitOnClose] is true.
  Future<void> quit() async {
    await windowManager.destroy();
  }

  /// Flip the "Quit on close" preference and rebuild the menu so the
  /// checkbox state updates.
  Future<void> setQuitOnClose(bool value) async {
    _quitOnClose = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(prefsKeyQuitOnClose, value);
    if (_initialized && Platform.isWindows) {
      await _rebuildMenu();
    }
  }

  // ------------------- TrayListener -------------------

  @override
  void onTrayIconMouseDown() {
    // Left click on Windows -- restore the window.
    showWindow();
  }

  @override
  void onTrayIconRightMouseDown() {
    // Right click -- pop the context menu.
    trayManager.popUpContextMenu();
  }

  @override
  void onTrayMenuItemClick(MenuItem menuItem) {
    switch (menuItem.key) {
      case _menuKeyShow:
        showWindow();
        break;
      case _menuKeyQuitOnClose:
        setQuitOnClose(!_quitOnClose);
        break;
      case _menuKeyQuit:
        quit();
        break;
    }
  }

  // ------------------- internal -------------------

  static const String _menuKeyShow = 'dex.tray.show';
  static const String _menuKeyQuitOnClose = 'dex.tray.quitOnClose';
  static const String _menuKeyQuit = 'dex.tray.quit';

  Future<void> _rebuildMenu() async {
    final menu = Menu(
      items: [
        MenuItem(key: _menuKeyShow, label: 'Show Dex'),
        MenuItem.separator(),
        MenuItem.checkbox(
          key: _menuKeyQuitOnClose,
          label: 'Quit on close',
          checked: _quitOnClose,
        ),
        MenuItem.separator(),
        MenuItem(key: _menuKeyQuit, label: 'Quit Dex'),
      ],
    );
    await trayManager.setContextMenu(menu);
  }

  /// tray_manager wants an absolute path; bundled Flutter assets live
  /// inside the application bundle. Copy ours into the system temp
  /// dir once per launch and hand back that path.
  Future<String> _resolveTrayIconPath() async {
    final bytes = await rootBundle.load('assets/tray/dex.ico');
    final out = File('${Directory.systemTemp.path}/dex_tray.ico');
    await out.writeAsBytes(bytes.buffer.asUint8List(), flush: true);
    return out.path;
  }
}
