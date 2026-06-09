// Memory tab -- personalization toggle, microsoft-usage-equivalent toggle
// (Dex calls it "Cloud diagnostics"), plus links to the view + add screens.

import 'package:flutter/material.dart';

import '../../../theme/tokens.dart';
import '../settings_row.dart';
import 'memory_add.dart';
import 'memory_view.dart';

class MemoryTab extends StatefulWidget {
  const MemoryTab({super.key});
  @override
  State<MemoryTab> createState() => _MemoryTabState();
}

class _MemoryTabState extends State<MemoryTab> {
  bool _personalisation = true;
  bool _cloudDiagnostics = true;
  bool _showAdd = false;
  bool _showView = false;

  @override
  Widget build(BuildContext context) {
    if (_showAdd) {
      return MemoryAdd(onBack: () => setState(() => _showAdd = false));
    }
    if (_showView) {
      return MemoryView(onBack: () => setState(() => _showView = false));
    }
    return SingleChildScrollView(
      padding: const EdgeInsets.all(DexSpace.lg),
      child: SettingsSection(
        title: 'Memory',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SettingsRow(
              label: 'Personalisation and memory',
              control: Switch(
                value: _personalisation,
                onChanged: (v) => setState(() => _personalisation = v),
              ),
              description:
                  'Your conversation history, facts, and instructions will be used to personalise Dex.',
            ),
            SettingsRow(
              label: 'Cloud diagnostics',
              control: Switch(
                value: _cloudDiagnostics,
                onChanged: (v) => setState(() => _cloudDiagnostics = v),
              ),
              description:
                  'Let Dex use anonymised telemetry from your local sessions to improve quality.',
            ),
            const Divider(),
            SettingsLinkRow(
              label: 'Add or import memory',
              description:
                  'Bring in info from other AI products, social media links, and files.',
              onTap: () => setState(() => _showAdd = true),
            ),
            SettingsLinkRow(
              label: 'View memory',
              onTap: () => setState(() => _showView = true),
            ),
          ],
        ),
      ),
    );
  }
}
