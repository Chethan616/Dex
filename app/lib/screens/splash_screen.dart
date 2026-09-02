// Splash screen — the boot sequence, and the shader warm-up behind it.
//
// Two jobs.
//
// The visible one: Dex is six processes, and this is where they start. The
// splash used to be a spinner on a 2.2-second timer while the app connected to
// a core that something else was supposed to have started — so if nothing had,
// the app opened onto "core not running" and there was no way to fix it from
// inside Dex. Each row here is a real process and a real probe answering; the
// row goes green when the service replies, not when a timer expires.
//
// The invisible one: on Windows the liquid-glass widgets render on Skia and
// the package's Impeller prewarm is skipped, so the first frame that paints a
// GlassContainer / DexGlass / dropdown compiles its shader on the spot — the
// "laggy until you've used it 2-3 times" jank. The off-screen warm strip paints
// those exact surfaces while the processes start, which is free: the boot is
// waiting on sockets, not on the GPU.

import 'package:flutter/material.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

import '../core/supervisor/supervisor.dart';
import '../theme/tokens.dart';
import '../widgets/dex_glass.dart';
import '../widgets/dex_logo.dart';
import '../widgets/glossy_dropdown.dart';
import '../widgets/living_background.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key, this.supervisor, this.onSkip});

  /// The boot in progress. Null in tests and in the Spotlight sub-window,
  /// where the splash is just a splash.
  final Supervisor? supervisor;

  /// "Continue anyway", shown when a required step has failed.
  ///
  /// A degraded Dex that says what is broken beats a splash that hangs. The
  /// owner can always open Settings → Diagnostics from inside it.
  final VoidCallback? onSkip;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: LivingBackground(
        child: Stack(
          // Clip.none so the off-screen warm strip below actually paints
          // (and thus compiles its shaders) instead of being clipped away.
          clipBehavior: Clip.none,
          children: [
            const Positioned(left: -3000, top: 0, child: _ShaderWarmStrip()),
            Center(
              child: DexGlass(
                radius: 24,
                padding: const EdgeInsets.symmetric(
                  horizontal: 40, vertical: 32,
                ),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 460),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const DexLogo(size: 64),
                      const SizedBox(height: DexSpace.md),
                      Text('Dex', style: DexType.title(color: DexColors.text)),
                      const SizedBox(height: DexSpace.lg),
                      if (supervisor == null)
                        const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: DexColors.accent,
                          ),
                        )
                      else
                        _BootList(supervisor: supervisor!, onSkip: onSkip),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One row per process, narrating itself.
class _BootList extends StatelessWidget {
  const _BootList({required this.supervisor, this.onSkip});

  final Supervisor supervisor;
  final VoidCallback? onSkip;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: supervisor,
      builder: (context, _) {
        final stuck = supervisor.steps.any(
          (s) => s.status == BootStatus.failed && !s.optional,
        );
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final step in supervisor.steps) _BootRow(step: step),
            if (stuck) ...[
              const SizedBox(height: DexSpace.md),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: supervisor.booting ? null : () => supervisor.boot(),
                    child: const Text('Try again'),
                  ),
                  const SizedBox(width: DexSpace.sm),
                  TextButton(
                    onPressed: onSkip,
                    child: const Text('Continue anyway'),
                  ),
                ],
              ),
            ],
          ],
        );
      },
    );
  }
}

class _BootRow extends StatelessWidget {
  const _BootRow({required this.step});

  final BootStep step;

  @override
  Widget build(BuildContext context) {
    final (icon, tint) = switch (step.status) {
      BootStatus.pending => (Icons.circle_outlined, DexColors.textFaint),
      BootStatus.running => (Icons.more_horiz_rounded, DexColors.accent),
      BootStatus.done => (Icons.check_rounded, DexColors.stateApprove),
      BootStatus.skipped => (Icons.remove_rounded, DexColors.textFaint),
      BootStatus.failed => (Icons.close_rounded, DexColors.stateError),
    };

    // The running label says what is happening; once it is done the row goes
    // quiet again. "Already running" is said out loud rather than implying the
    // splash did work it did not do.
    final subtitle = switch (step.status) {
      BootStatus.running => step.runningLabel,
      BootStatus.done =>
        step.wasAlreadyUp ? 'already running' : (step.detail ?? step.doneLabel),
      _ => step.detail,
    };

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Icon(icon, size: 15, color: tint),
          ),
          const SizedBox(width: DexSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  step.title,
                  style: DexType.label(
                    color: step.status == BootStatus.pending
                        ? DexColors.textFaint
                        : DexColors.text,
                  ),
                ),
                if (subtitle != null && subtitle.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 1),
                    child: Text(
                      subtitle,
                      style: DexType.caption(
                        color: step.status == BootStatus.failed
                            ? DexColors.stateError
                            : DexColors.textFaint,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Off-screen row that paints one of each heavy glass surface so Skia
/// compiles their shaders during the splash, not on first interaction.
class _ShaderWarmStrip extends StatelessWidget {
  const _ShaderWarmStrip();

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const DexGlass(
          radius: 16,
          padding: EdgeInsets.all(16),
          child: SizedBox(width: 80, height: 40),
        ),
        const SizedBox(width: 8),
        GlassContainer(
          useOwnLayer: true,
          quality: GlassQuality.premium,
          shape: const LiquidRoundedSuperellipse(borderRadius: 16),
          settings: const LiquidGlassSettings(
            glassColor: Color.fromRGBO(255, 255, 255, 0.10),
            blur: 10,
            thickness: 16,
            glowIntensity: 0.5,
          ),
          padding: const EdgeInsets.all(16),
          child: const SizedBox(width: 60, height: 30),
        ),
        const SizedBox(width: 8),
        GlossyDropdown(
          value: 'warm',
          options: const ['warm'],
          onChanged: (_) {},
        ),
      ],
    );
  }
}
