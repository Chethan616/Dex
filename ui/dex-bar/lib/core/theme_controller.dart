import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Which theme the owner wants, remembered between launches.
///
/// The light palette existed for three slices and nothing could reach it —
/// `themeMode` was hard-wired to `system`, so it only appeared if you changed
/// Windows itself. That is how it came to ship with `textFaint` at 2.6:1 on
/// 10px labels: a theme nobody can open is a theme nobody looks at.
class ThemeController extends ChangeNotifier {
  ThemeController({ThemeMode initial = ThemeMode.system}) : _mode = initial;

  static const _key = 'dex.themeMode';

  ThemeMode _mode;
  ThemeMode get mode => _mode;

  /// Loads the stored preference. A failure here is not worth surfacing —
  /// falling back to the system theme is exactly what a fresh install does.
  Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getString(_key);
      final found = ThemeMode.values.where((m) => m.name == stored);
      if (found.isNotEmpty) {
        _mode = found.first;
        notifyListeners();
      }
    } catch (_) {
      // Keep the default.
    }
  }

  /// system → dark → light → system.
  ///
  /// System first because it is the right default, and cycling *through* it
  /// rather than offering it as a third button keeps this to one control in a
  /// header that already carries four.
  Future<void> cycle() async {
    _mode = switch (_mode) {
      ThemeMode.system => ThemeMode.dark,
      ThemeMode.dark => ThemeMode.light,
      ThemeMode.light => ThemeMode.system,
    };
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, _mode.name);
    } catch (_) {
      // The choice still applies to this session.
    }
  }

  IconData get icon => switch (_mode) {
        ThemeMode.system => Icons.brightness_auto_rounded,
        ThemeMode.dark => Icons.dark_mode_outlined,
        ThemeMode.light => Icons.light_mode_outlined,
      };

  String get label => switch (_mode) {
        ThemeMode.system => 'Theme: follows Windows',
        ThemeMode.dark => 'Theme: dark',
        ThemeMode.light => 'Theme: light',
      };
}
