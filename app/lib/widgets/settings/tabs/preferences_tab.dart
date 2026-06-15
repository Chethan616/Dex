// Preferences tab: voice/language/theme dropdowns, autostart + keep-running
// toggles, global hotkey, wake-word, vision text editing. Every control is
// persisted via DexPrefs and the ones with a real effect apply immediately:
//   - Theme           reskins the app live (DexPrefs.themeMode notifier)
//   - Keep running     binds the tray's quit-on-close behavior
//   - Global hotkey    re-registers the system summon key
//   - Auto start       writes a HKCU Run entry

import 'package:flutter/material.dart';

import '../../../core/dex_prefs.dart';
import '../../../main.dart' show registerSpotlightHotkey;
import '../../../platform/win/tray.dart';
import '../../../theme/tokens.dart';
import '../../glossy_dropdown.dart';
import '../settings_row.dart';

class PreferencesTab extends StatefulWidget {
  const PreferencesTab({super.key});
  @override
  State<PreferencesTab> createState() => _PreferencesTabState();
}

class _PreferencesTabState extends State<PreferencesTab> {
  late String _voiceLang;
  late String _voice;
  late String _language;
  late String _theme;
  late String _hotkey;
  late bool _keepRunning;
  late bool _autoStart;
  late bool _wakeWord;
  late bool _visionTextEditing;

  @override
  void initState() {
    super.initState();
    _voiceLang = DexPrefs.voiceLang;
    _voice = DexPrefs.voice;
    _language = DexPrefs.language;
    _theme = DexPrefs.themeLabel;
    _hotkey = DexPrefs.hotkey;
    // Keep-running is the inverse of the tray's quit-on-close pref.
    _keepRunning = !DexTray.instance.quitOnClose;
    _autoStart = DexPrefs.autoStart;
    _wakeWord = DexPrefs.wakeWord;
    _visionTextEditing = DexPrefs.visionTextEditing;
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(DexSpace.lg),
      child: SettingsSection(
        title: 'Preferences',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SettingsRow(
              label: 'Voice language',
              control: GlossyDropdown(
                value: _voiceLang,
                options: const ['Auto-detect', 'English', 'Spanish', 'French'],
                onChanged: (v) {
                  setState(() => _voiceLang = v);
                  DexPrefs.setVoiceLang(v);
                },
              ),
            ),
            SettingsRow(
              label: 'Voice',
              control: GlossyDropdown(
                value: _voice,
                options: const ['Dune', 'Mesa', 'Sandstorm', 'Canyon'],
                onChanged: (v) {
                  setState(() => _voice = v);
                  DexPrefs.setVoice(v);
                },
              ),
            ),
            SettingsRow(
              label: 'Language',
              control: GlossyDropdown(
                value: _language,
                options: const ['EN', 'ES', 'FR', 'DE'],
                onChanged: (v) {
                  setState(() => _language = v);
                  DexPrefs.setLanguage(v);
                },
              ),
            ),
            SettingsRow(
              label: 'Theme',
              control: GlossyDropdown(
                value: _theme,
                options: const ['System', 'Dark', 'Light'],
                onChanged: (v) {
                  setState(() => _theme = v);
                  DexPrefs.setThemeLabel(v); // reskins live
                },
              ),
            ),
            const Divider(),
            SettingsRow(
              label: 'Auto start on log in',
              control: Switch(
                value: _autoStart,
                onChanged: (v) {
                  setState(() => _autoStart = v);
                  DexPrefs.setAutoStart(v);
                },
              ),
            ),
            SettingsRow(
              label: 'On close, keep the app running',
              control: Switch(
                value: _keepRunning,
                onChanged: (v) {
                  setState(() => _keepRunning = v);
                  // keep-running == do NOT quit on close.
                  DexTray.instance.setQuitOnClose(!v);
                },
              ),
              description:
                  'Closing the window hides Dex to the tray instead of exiting.',
            ),
            SettingsRow(
              label: 'Global hotkey to summon Dex',
              control: GlossyDropdown(
                value: _hotkey,
                options: const ['None', 'Ctrl+K', 'Alt+Space'],
                onChanged: (v) async {
                  setState(() => _hotkey = v);
                  await DexPrefs.setHotkey(v);
                  await registerSpotlightHotkey(); // re-bind immediately
                },
              ),
              description:
                  'May conflict with certain applications or accessibility features.',
            ),
            SettingsRow(
              label: "Listen for 'Hey, Dex' to start a conversation",
              control: Switch(
                value: _wakeWord,
                onChanged: (v) {
                  setState(() => _wakeWord = v);
                  DexPrefs.setWakeWord(v);
                },
              ),
              description:
                  'Allows voice conversations whenever your PC is unlocked. Uses more power on battery.',
            ),
            SettingsRow(
              label: 'Vision session text editing',
              control: Switch(
                value: _visionTextEditing,
                onChanged: (v) {
                  setState(() => _visionTextEditing = v);
                  DexPrefs.setVisionTextEditing(v);
                },
              ),
              description:
                  'Dex can read and rewrite text in apps you share during vision sessions.',
            ),
          ],
        ),
      ),
    );
  }
}
