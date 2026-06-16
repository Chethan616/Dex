// Full-screen voice-mode surface. Animated wave background, centered
// "I'm listening" label, four bottom controls (close, vision, mic, settings).

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../theme/tokens.dart';
import '../dex_glass.dart';
import '../glass_badge_button.dart';
import 'animated_wave_background.dart';
import 'voice_settings_panel.dart';

class VoiceModeScreen extends StatefulWidget {
  const VoiceModeScreen({super.key});
  @override
  State<VoiceModeScreen> createState() => _VoiceModeScreenState();
}

class _VoiceModeScreenState extends State<VoiceModeScreen> {
  bool _settingsOpen = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DexColors.bg,
      body: Stack(
        children: [
          const Positioned.fill(child: AnimatedWaveBackground()),
          Center(
            child: Text(
              "I'm listening",
              style: DexType.title(color: DexColors.text),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: DexSpace.xxl,
            child: Center(
              child: DexGlass(
                radius: 30,
                padding: const EdgeInsets.symmetric(
                  horizontal: DexSpace.lg, vertical: DexSpace.sm,
                ),
                child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _ControlButton(
                            icon: LucideIcons.x,
                            tooltip: 'Exit voice mode',
                            onTap: () => Navigator.of(context).maybePop(),
                          ),
                          const SizedBox(width: DexSpace.sm),
                          _ControlButton(
                            icon: LucideIcons.glasses,
                            tooltip: 'Share screen',
                            onTap: () {},
                          ),
                          const SizedBox(width: DexSpace.sm),
                          _ControlButton(
                            icon: LucideIcons.mic,
                            tooltip: 'Mute',
                            accent: true,
                            onTap: () {},
                          ),
                          const SizedBox(width: DexSpace.sm),
                          _ControlButton(
                            icon: LucideIcons.settings,
                            tooltip: 'Voice settings',
                            onTap: () => setState(() => _settingsOpen = true),
                          ),
                        ],
                      ),
              ),
            ),
          ),
          if (_settingsOpen)
            // Anchored bottom-right within the safe area + a hard right
            // margin so the 360-wide panel is always fully on-screen
            // (it used to clip the rightmost voice chips against the edge).
            Positioned.fill(
              child: SafeArea(
                child: Align(
                  alignment: Alignment.bottomRight,
                  child: Padding(
                    padding: const EdgeInsets.only(
                      right: DexSpace.lg, bottom: DexSpace.xxl,
                    ),
                    child: VoiceSettingsPanel(
                      onClose: () => setState(() => _settingsOpen = false),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ControlButton extends StatelessWidget {
  const _ControlButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    this.accent = false,
  });
  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  final bool accent;

  @override
  Widget build(BuildContext context) {
    return GlassBadgeButton(
      icon: icon,
      tooltip: tooltip,
      onTap: onTap,
      size: 48,
      iconColor: accent ? DexColors.accent : DexColors.textDim,
      glowColor: accent ? DexColors.accent : null,
    );
  }
}
