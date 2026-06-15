// Memory tab -- personalisation toggle (gates whether MEMORY.md is loaded),
// a live count of stored facts, plus links to the view + add screens.
// Backed by DexMemory so everything reflects the real ~/.dex/workspace
// /MEMORY.md the agent reads.

import 'package:flutter/material.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

import '../../../core/dex_memory.dart';
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
  late bool _personalisation;
  late int _factCount;
  bool _showAdd = false;
  bool _showView = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  void _refresh() {
    _personalisation = DexMemory.isEnabled;
    _factCount = _personalisation ? DexMemory.read().length : 0;
  }

  void _setPersonalisation(bool v) {
    DexMemory.setEnabled(v);
    setState(_refresh);
  }

  @override
  Widget build(BuildContext context) {
    if (_showAdd) {
      return MemoryAdd(onBack: () => setState(() {
            _showAdd = false;
            _refresh();
          }));
    }
    if (_showView) {
      return MemoryView(onBack: () => setState(() {
            _showView = false;
            _refresh();
          }));
    }
    final viewDesc = _factCount == 0
        ? 'Nothing remembered yet.'
        : '$_factCount ${_factCount == 1 ? 'fact' : 'facts'} stored.';
    return SingleChildScrollView(
      padding: const EdgeInsets.all(DexSpace.lg),
      child: SettingsSection(
        title: 'Memory',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SettingsRow(
              label: 'Personalisation and memory',
              control: GlassSwitch(
                value: _personalisation,
                onChanged: _setPersonalisation,
              ),
              description:
                  'Dex remembers durable facts and preferences in one compact '
                  'file it reads each session. Turn off to stop using it '
                  '(your saved facts are kept, just set aside).',
            ),
            const Divider(),
            SettingsLinkRow(
              label: 'Add or import memory',
              description:
                  'Bring in info from other AI products, social links, and files.',
              onTap: _personalisation
                  ? () => setState(() => _showAdd = true)
                  : null,
            ),
            SettingsLinkRow(
              label: 'View memory',
              description: viewDesc,
              onTap: _personalisation
                  ? () => setState(() => _showView = true)
                  : null,
            ),
          ],
        ),
      ),
    );
  }
}
