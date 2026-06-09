// Floating voice settings panel: language + voice grid. Dex ships its own
// voice name set (no reuse of any other product's voice catalogue).

import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../theme/tokens.dart';
import '../glossy_menu.dart';

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
      child: ClipRRect(
        borderRadius: DexRadius.rmd,
        child: BackdropFilter(
          filter: ImageFilter.blur(
            sigmaX: DexSurface.blurSigma,
            sigmaY: DexSurface.blurSigma,
          ),
          child: Container(
            decoration: BoxDecoration(
              color: DexColors.surface2.withValues(
                alpha: DexSurface.acrylicAlpha,
              ),
              borderRadius: DexRadius.rmd,
              border: Border.all(color: DexColors.border),
              boxShadow: DexElevation.floating,
            ),
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
                    _Dropdown(
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
                GridView.count(
                  shrinkWrap: true,
                  crossAxisCount: 2,
                  mainAxisSpacing: DexSpace.sm,
                  crossAxisSpacing: DexSpace.sm,
                  childAspectRatio: 2.6,
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
        ),
      ),
    );
  }
}

class _Dropdown extends StatefulWidget {
  const _Dropdown({
    required this.value,
    required this.options,
    required this.onChanged,
  });
  final String value;
  final List<String> options;
  final ValueChanged<String> onChanged;

  @override
  State<_Dropdown> createState() => _DropdownState();
}

class _DropdownState extends State<_Dropdown> {
  final GlobalKey _key = GlobalKey();

  Future<void> _openMenu() async {
    final ctx = _key.currentContext;
    if (ctx == null) return;
    final box = ctx.findRenderObject() as RenderBox?;
    if (box == null) return;
    final anchor = box.localToGlobal(Offset(0, box.size.height + 6));
    final picked = await GlossyMenu.show<String>(
      context: context,
      anchor: anchor,
      width: 220,
      entries: <GlossyMenuEntry<String>>[
        for (final o in widget.options)
          GlossyMenuItem<String>(
            value: o,
            child: Row(
              children: [
                Expanded(
                  child: Text(o,
                      style: DexType.label(
                        color: o == widget.value
                            ? DexColors.accent
                            : DexColors.text,
                      )),
                ),
                if (o == widget.value)
                  const Icon(LucideIcons.check,
                      size: 14, color: DexColors.accent),
              ],
            ),
          ),
      ],
    );
    if (picked != null) widget.onChanged(picked);
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      key: _key,
      borderRadius: DexRadius.rsm,
      onTap: _openMenu,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: DexSpace.md, vertical: DexSpace.xs,
        ),
        decoration: BoxDecoration(
          color: DexColors.surface,
          borderRadius: DexRadius.rsm,
          border: Border.all(color: DexColors.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(widget.value, style: DexType.label(color: DexColors.text)),
            const SizedBox(width: DexSpace.sm),
            const Icon(LucideIcons.chevron_down,
                size: 14, color: DexColors.textDim),
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
    return InkWell(
      onTap: onTap,
      borderRadius: DexRadius.rsm,
      child: Container(
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? DexColors.accentQuiet : DexColors.surface,
          borderRadius: DexRadius.rsm,
          border: Border.all(
            color: selected ? DexColors.accent : DexColors.border,
          ),
        ),
        child: Text(
          label,
          style: DexType.label(
            color: selected ? DexColors.accent : DexColors.text,
          ),
        ),
      ),
    );
  }
}
