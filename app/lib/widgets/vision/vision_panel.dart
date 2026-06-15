// Floating "share with Dex" panel. Picks a screen or app to stream to the
// agent. v1 renders the chrome only; real capture wiring lands later.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../theme/tokens.dart';
import '../dex_glass.dart';
import '../dex_switch.dart';

class VisionPanel extends StatefulWidget {
  const VisionPanel({super.key, required this.onClose});
  final VoidCallback onClose;

  @override
  State<VisionPanel> createState() => _VisionPanelState();
}

class _VisionPanelState extends State<VisionPanel> {
  bool _startWithVoice = true;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 380,
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
                      child: Text('Dex Vision',
                          style: DexType.heading(color: DexColors.text)),
                    ),
                    IconButton(
                      icon: const Icon(LucideIcons.x, size: 18),
                      color: DexColors.textDim,
                      onPressed: widget.onClose,
                    ),
                  ],
                ),
                const SizedBox(height: DexSpace.sm),
                Row(
                  children: [
                    Expanded(
                      child: Text('Start with voice',
                          style: DexType.label(color: DexColors.text)),
                    ),
                    DexSwitch(
                      value: _startWithVoice,
                      onChanged: (v) => setState(() => _startWithVoice = v),
                    ),
                  ],
                ),
                const SizedBox(height: DexSpace.md),
                Text('Share screen',
                    style: DexType.caption(color: DexColors.textFaint)),
                const SizedBox(height: DexSpace.sm),
                _Thumb(label: 'Screen 1', onTap: widget.onClose),
                const SizedBox(height: DexSpace.lg),
                Text('Share app',
                    style: DexType.caption(color: DexColors.textFaint)),
                const SizedBox(height: DexSpace.sm),
                _AppRow(name: 'Editor', onShare: widget.onClose),
                const SizedBox(height: DexSpace.xs),
                _AppRow(name: 'Browser', onShare: widget.onClose),
              ],
            ),
      ),
    );
  }
}

class _Thumb extends StatelessWidget {
  const _Thumb({required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: DexRadius.rsm,
      child: Container(
        height: 110,
        decoration: BoxDecoration(
          color: DexColors.surface,
          borderRadius: DexRadius.rsm,
          border: Border.all(color: DexColors.border),
        ),
        alignment: Alignment.bottomCenter,
        padding: const EdgeInsets.all(DexSpace.sm),
        child: Text(label, style: DexType.label(color: DexColors.text)),
      ),
    );
  }
}

class _AppRow extends StatelessWidget {
  const _AppRow({required this.name, required this.onShare});
  final String name;
  final VoidCallback onShare;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DexSpace.sm, vertical: DexSpace.sm,
      ),
      decoration: BoxDecoration(
        color: DexColors.surface,
        borderRadius: DexRadius.rsm,
        border: Border.all(color: DexColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: DexColors.surface2,
              borderRadius: DexRadius.rsm,
            ),
            alignment: Alignment.center,
            child: const Icon(LucideIcons.app_window,
                size: 14, color: DexColors.textDim),
          ),
          const SizedBox(width: DexSpace.md),
          Expanded(
            child: Text(name, style: DexType.label(color: DexColors.text)),
          ),
          OutlinedButton(
            onPressed: onShare,
            style: OutlinedButton.styleFrom(
              foregroundColor: DexColors.text,
              side: const BorderSide(color: DexColors.border),
              padding: const EdgeInsets.symmetric(
                horizontal: DexSpace.md, vertical: DexSpace.xs,
              ),
            ),
            child: const Text('Share'),
          ),
        ],
      ),
    );
  }
}
