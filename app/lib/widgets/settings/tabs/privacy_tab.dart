// Privacy tab. Local-first agent, so this surfaces the controls that
// actually mean something on this machine: whether Dex may read the
// active window/screen for context, an optional diagnostics opt-in, and
// a jump to the memory controls. Toggles persist via DexPrefs.

import 'package:flutter/material.dart';

import '../../../core/dex_prefs.dart';
import '../../../theme/tokens.dart';
import '../settings_dialog.dart' show SettingsTab;
import '../settings_row.dart';

class PrivacyTab extends StatefulWidget {
  const PrivacyTab({super.key, this.onNavigate});

  /// Lets a link jump to another settings tab (e.g. Memory).
  final void Function(SettingsTab)? onNavigate;

  @override
  State<PrivacyTab> createState() => _PrivacyTabState();
}

class _PrivacyTabState extends State<PrivacyTab> {
  late bool _contextClues;
  late bool _diagnostics;

  @override
  void initState() {
    super.initState();
    _contextClues = DexPrefs.contextClues;
    _diagnostics = DexPrefs.diagnostics;
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(DexSpace.lg),
      child: SettingsSection(
        title: 'Privacy',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SettingsRow(
              label: 'Context clues',
              control: Switch(
                value: _contextClues,
                onChanged: (v) {
                  setState(() => _contextClues = v);
                  DexPrefs.setContextClues(v);
                },
              ),
              description:
                  'Allow Dex to read the current window, open tabs, or what is '
                  'on screen to give better answers. Everything stays on this '
                  'machine.',
            ),
            SettingsRow(
              label: 'Share anonymous diagnostics',
              control: Switch(
                value: _diagnostics,
                onChanged: (v) {
                  setState(() => _diagnostics = v);
                  DexPrefs.setDiagnostics(v);
                },
              ),
              description:
                  'Off by default. Dex sends no usage data unless you turn '
                  'this on.',
            ),
            const Divider(),
            SettingsLinkRow(
              label: 'Manage personalisation and memory',
              description: 'View, add, or delete what Dex remembers about you.',
              onTap: () => widget.onNavigate?.call(SettingsTab.memory),
            ),
          ],
        ),
      ),
    );
  }
}
