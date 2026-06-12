// Full-screen voice-mode surface. Animated wave background, centered
// "I'm listening" label, four bottom controls (close, vision, mic, settings).

import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../theme/tokens.dart';
import '../refractive_edge.dart';
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
              child: DecoratedBox(
                decoration: const BoxDecoration(
                  borderRadius: DexRadius.rpill,
                  boxShadow: DexSurface.glossyShadow,
                ),
                child: RefractiveEdge(
                  radius: DexRadius.rpill,
                  child: BackdropFilter(
                    filter: ImageFilter.blur(
                      sigmaX: DexSurface.blurSigma,
                      sigmaY: DexSurface.blurSigma,
                    ),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: DexSpace.lg, vertical: DexSpace.sm,
                      ),
                      decoration: BoxDecoration(
                        gradient: DexSurface.glossyGradient(),
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
              ),
            ),
          ),
          if (_settingsOpen)
            Positioned(
              right: DexSpace.xl,
              bottom: DexSpace.xxxl + 40,
              child: VoiceSettingsPanel(
                onClose: () => setState(() => _settingsOpen = false),
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
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: Tooltip(
        message: tooltip,
        child: InkResponse(
          onTap: onTap,
          radius: 22,
          child: Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: accent ? DexColors.accent : DexColors.surface,
              shape: BoxShape.circle,
              border: Border.all(
                color: accent ? DexColors.accent : DexColors.border,
              ),
            ),
            child: Icon(
              icon,
              size: 18,
              color: accent ? DexColors.bg : DexColors.textDim,
            ),
          ),
        ),
      ),
    );
  }
}
