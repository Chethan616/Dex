// DexPrefs — the single store for user UI preferences.
//
// Loaded once at startup into an in-memory cache so the Settings widgets
// read values synchronously, and persisted to shared_preferences so they
// survive restarts. Theme is exposed as a ValueNotifier the app root
// listens to, so changing it in Settings reskins Dex live.
//
// Preferences with a real OS/runtime effect are applied here too:
//   - theme       -> ThemeMode notifier (live)
//   - autoStart    -> HKCU\...\Run registry entry (launch on login)
// The window "keep running on close" toggle is owned by DexTray
// (quitOnClose); the global hotkey lives in main.dart's registration.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class DexPrefs {
  DexPrefs._();

  static SharedPreferences? _p;

  static const _kTheme = 'dex.pref.theme'; // System | Dark | Light
  static const _kVoiceLang = 'dex.pref.voiceLang';
  static const _kVoice = 'dex.pref.voice';
  static const _kLanguage = 'dex.pref.language';
  static const _kHotkey = 'dex.pref.hotkey'; // None | Ctrl+K | Alt+Space
  static const _kAutoStart = 'dex.pref.autoStart';
  static const _kWakeWord = 'dex.pref.wakeWord';
  static const _kVisionTextEditing = 'dex.pref.visionTextEditing';
  static const _kContextClues = 'dex.pref.contextClues';
  static const _kDiagnostics = 'dex.pref.diagnostics';

  /// App theme, watched by the root MaterialApp for live switching.
  static final ValueNotifier<ThemeMode> themeMode =
      ValueNotifier<ThemeMode>(ThemeMode.dark);

  static Future<void> init() async {
    _p = await SharedPreferences.getInstance();
    themeMode.value = _modeFromLabel(_p?.getString(_kTheme) ?? 'Dark');
  }

  // ---- theme -----------------------------------------------------------

  static String get themeLabel => _labelFromMode(themeMode.value);

  static Future<void> setThemeLabel(String label) async {
    themeMode.value = _modeFromLabel(label);
    await _p?.setString(_kTheme, label);
  }

  static ThemeMode _modeFromLabel(String l) => switch (l) {
        'Light' => ThemeMode.light,
        'System' => ThemeMode.system,
        _ => ThemeMode.dark,
      };

  static String _labelFromMode(ThemeMode m) => switch (m) {
        ThemeMode.light => 'Light',
        ThemeMode.system => 'System',
        ThemeMode.dark => 'Dark',
      };

  // ---- plain string prefs ---------------------------------------------

  static String get voiceLang => _p?.getString(_kVoiceLang) ?? 'Auto-detect';
  static Future<void> setVoiceLang(String v) async =>
      _p?.setString(_kVoiceLang, v);

  static String get voice => _p?.getString(_kVoice) ?? 'Dune';
  static Future<void> setVoice(String v) async => _p?.setString(_kVoice, v);

  static String get language => _p?.getString(_kLanguage) ?? 'EN';
  static Future<void> setLanguage(String v) async =>
      _p?.setString(_kLanguage, v);

  static String get hotkey => _p?.getString(_kHotkey) ?? 'Ctrl+K';
  static Future<void> setHotkey(String v) async => _p?.setString(_kHotkey, v);

  // ---- bool prefs ------------------------------------------------------

  static bool get wakeWord => _p?.getBool(_kWakeWord) ?? false;
  static Future<void> setWakeWord(bool v) async => _p?.setBool(_kWakeWord, v);

  static bool get visionTextEditing =>
      _p?.getBool(_kVisionTextEditing) ?? false;
  static Future<void> setVisionTextEditing(bool v) async =>
      _p?.setBool(_kVisionTextEditing, v);

  /// Whether Dex may read the active window / screen context for better
  /// answers (the Phase-H screen-context capability gate).
  static bool get contextClues => _p?.getBool(_kContextClues) ?? true;
  static Future<void> setContextClues(bool v) async =>
      _p?.setBool(_kContextClues, v);

  static bool get diagnostics => _p?.getBool(_kDiagnostics) ?? false;
  static Future<void> setDiagnostics(bool v) async =>
      _p?.setBool(_kDiagnostics, v);

  // ---- auto-start on login (real Windows effect) ----------------------

  static bool get autoStart => _p?.getBool(_kAutoStart) ?? false;

  /// Persist the preference AND register/unregister a HKCU Run entry so
  /// Dex actually launches on login. Best-effort: failures are logged,
  /// the stored preference still flips so the UI stays truthful.
  static Future<void> setAutoStart(bool v) async {
    await _p?.setBool(_kAutoStart, v);
    if (!Platform.isWindows) return;
    const name = 'Dex';
    const runKey = r'HKCU\Software\Microsoft\Windows\CurrentVersion\Run';
    try {
      if (v) {
        final exe = Platform.resolvedExecutable;
        await Process.run('reg', [
          'add', runKey, '/v', name, '/t', 'REG_SZ', '/d', '"$exe"', '/f',
        ]);
      } else {
        await Process.run('reg', ['delete', runKey, '/v', name, '/f']);
      }
    } catch (e) {
      debugPrint('[dex] autostart registry write failed: $e');
    }
  }
}
