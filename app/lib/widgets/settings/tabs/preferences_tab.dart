// Preferences tab: voice/language/theme dropdowns, autostart toggles,
// global hotkey, wake-word, vision text editing, permission link.

import 'package:flutter/material.dart';

import '../../../theme/tokens.dart';
import '../settings_row.dart';

class PreferencesTab extends StatefulWidget {
  const PreferencesTab({super.key});
  @override
  State<PreferencesTab> createState() => _PreferencesTabState();
}

class _PreferencesTabState extends State<PreferencesTab> {
  String _voiceLang = 'Auto-detect';
  String _voice = 'Dune';
  String _language = 'EN';
  String _theme = 'System';
  String _hotkey = 'None';
  bool _autoStart = true;
  bool _keepRunning = true;
  bool _wakeWord = false;
  bool _visionTextEditing = false;

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
              control: _Dropdown(
                value: _voiceLang,
                options: const ['Auto-detect', 'English', 'Spanish', 'French'],
                onChanged: (v) => setState(() => _voiceLang = v),
              ),
            ),
            SettingsRow(
              label: 'Voice',
              control: _Dropdown(
                value: _voice,
                options: const ['Dune', 'Mesa', 'Sandstorm', 'Canyon'],
                onChanged: (v) => setState(() => _voice = v),
              ),
            ),
            SettingsRow(
              label: 'Language',
              control: _Dropdown(
                value: _language,
                options: const ['EN', 'ES', 'FR', 'DE'],
                onChanged: (v) => setState(() => _language = v),
              ),
            ),
            SettingsRow(
              label: 'Theme',
              control: _Dropdown(
                value: _theme,
                options: const ['System', 'Dark', 'Light'],
                onChanged: (v) => setState(() => _theme = v),
              ),
            ),
            const Divider(),
            SettingsRow(
              label: 'Auto start on log in',
              control: Switch(
                value: _autoStart,
                onChanged: (v) => setState(() => _autoStart = v),
              ),
            ),
            SettingsRow(
              label: 'On close, keep the app running',
              control: Switch(
                value: _keepRunning,
                onChanged: (v) => setState(() => _keepRunning = v),
              ),
              description: 'Closing the window hides Dex to the tray instead of exiting.',
            ),
            SettingsRow(
              label: 'Global hotkey to summon Dex',
              control: _Dropdown(
                value: _hotkey,
                options: const ['None', 'Ctrl+K', 'Alt+Space'],
                onChanged: (v) => setState(() => _hotkey = v),
              ),
              description: 'May conflict with certain applications or accessibility features.',
            ),
            SettingsRow(
              label: "Listen for 'Hey, Dex' to start a conversation",
              control: Switch(
                value: _wakeWord,
                onChanged: (v) => setState(() => _wakeWord = v),
              ),
              description:
                  'Allows voice conversations whenever your PC is unlocked. Uses more power on battery.',
            ),
            SettingsRow(
              label: 'Vision session text editing',
              control: Switch(
                value: _visionTextEditing,
                onChanged: (v) => setState(() => _visionTextEditing = v),
              ),
              description:
                  'Dex can read and rewrite text in apps you share during vision sessions.',
            ),
            const Divider(),
            SettingsLinkRow(label: 'Permission settings', onTap: () {}),
          ],
        ),
      ),
    );
  }
}

class _Dropdown extends StatelessWidget {
  const _Dropdown({
    required this.value,
    required this.options,
    required this.onChanged,
  });
  final String value;
  final List<String> options;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButton<String>(
      value: value,
      dropdownColor: DexColors.surface2,
      underline: const SizedBox.shrink(),
      style: DexType.label(color: DexColors.text),
      iconEnabledColor: DexColors.textDim,
      items: options
          .map((o) => DropdownMenuItem<String>(value: o, child: Text(o)))
          .toList(growable: false),
      onChanged: (v) {
        if (v != null) onChanged(v);
      },
    );
  }
}
