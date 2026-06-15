// Floating voice settings panel: language + voice grid. Dex ships its own
// voice name set (no reuse of any other product's voice catalogue).

import 'package:flutter/material.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

import '../../theme/tokens.dart';
import '../dex_glass.dart';
import '../glossy_dropdown.dart';

class VoiceSettingsPanel extends StatefulWidget {
  const VoiceSettingsPanel({super.key, required this.onClose});
  final VoidCallback onClose;

  static const List<String> voices = <String>[
    'Dune', 'Mesa', 'Sandstorm', 'Canyon', 'Oasis', 'Arroyo', 'Saguaro', 'Atlas',
  ];

  @override
  State<VoiceSettingsPanel> createState() => _VoiceSettingsPanelState();
}

class _VoiceSettingsPanelState extends State<VoiceSettingsPanel> {
  String _voice = VoiceSettingsPanel.voices.first;
  String _lang = 'Auto-detect';

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 320,
      child: DexGlass(
        radius: 14,
        padding: const EdgeInsets.all(DexSpace.lg),
        child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text('Language',
                          style: DexType.label(color: DexColors.text)),
                    ),
                    GlossyDropdown(
                      value: _lang,
                      options: const ['Auto-detect', 'English', 'Spanish', 'French'],
                      onChanged: (v) => setState(() => _lang = v),
                    ),
                  ],
                ),
                const SizedBox(height: DexSpace.sm),
                Text('Choose the language for voice conversations.',
                    style: DexType.caption(color: DexColors.textFaint)),
                const SizedBox(height: DexSpace.lg),
                Text('Voice', style: DexType.label(color: DexColors.text)),
                const SizedBox(height: DexSpace.sm),
                Wrap(
                  spacing: DexSpace.sm,
                  runSpacing: DexSpace.sm,
                  children: VoiceSettingsPanel.voices
                      .map((v) => _VoiceTile(
                            label: v,
                            selected: v == _voice,
                            onTap: () => setState(() => _voice = v),
                          ))
                      .toList(growable: false),
                ),
                const SizedBox(height: DexSpace.md),
                Text('Your conversation resets when you change voices.',
                    style: DexType.caption(color: DexColors.textFaint)),
                const SizedBox(height: DexSpace.md),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: widget.onClose,
                    child: const Text('Close'),
                  ),
                ),
              ],
            ),
      ),
    );
  }
}


class _VoiceTile extends StatelessWidget {
  const _VoiceTile({
    required this.label,
    required this.selected,
    required this.onTap,
  });
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // Selectable voice options as liquid-glass chips (their own press
    // physics + frosted surface). MouseRegion adds the hand cursor —
    // GlassChip doesn't set one itself.
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GlassChip(
        label: label,
        selected: selected,
        selectedColor: DexColors.accent,
        onTap: onTap,
        labelStyle: DexType.label(
          color: selected ? DexColors.accent : DexColors.text,
        ),
      ),
    );
  }
}
