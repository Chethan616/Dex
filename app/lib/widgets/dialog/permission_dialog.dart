// Generic Yes/No permission modal, used for the mic prompt before voice
// mode and for any future capability that needs an explicit OK.
// Carries the same glossy gradient + edge highlight + spring entry as
// the composer card and popup menus so every floating surface in Dex
// reads as one family.

import 'dart:ui';

import 'package:flutter/material.dart';

import '../../theme/motion.dart';
import '../../theme/tokens.dart';

class PermissionDialog extends StatelessWidget {
  const PermissionDialog({
    super.key,
    required this.title,
    required this.description,
  });

  final String title;
  final String description;

  static Future<bool?> show(
    BuildContext context, {
    required String title,
    required String description,
  }) {
    return showGeneralDialog<bool>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Dismiss permission',
      barrierColor: Colors.black.withValues(alpha: 0.35),
      transitionDuration: DexMotion.dialog,
      pageBuilder: (_, _, _) =>
          PermissionDialog(title: title, description: description),
      transitionBuilder: (ctx, anim, _, child) {
        final reduce = MediaQuery.of(ctx).disableAnimations;
        if (reduce) return child;
        // Dampened decelerate (Material 3 emphasized decelerate) for
        // a smooth, confident landing -- no spring overshoot. Fade
        // + 16px slide-up + 0.96→1.0 scale, all driven by the same
        // dampened curve so the components arrive together.
        final eased = CurvedAnimation(parent: anim, curve: DexMotion.dampened);
        return FadeTransition(
          opacity: eased,
          child: AnimatedBuilder(
            animation: eased,
            builder: (_, c) => Transform.translate(
              offset: Offset(0, (1 - eased.value) * 16),
              child: Transform.scale(
                scale: 0.96 + 0.04 * eased.value,
                child: c,
              ),
            ),
            child: child,
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.transparency,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: ClipRRect(
            borderRadius: DexRadius.rlg,
            child: BackdropFilter(
              filter: ImageFilter.blur(
                sigmaX: DexSurface.blurSigma,
                sigmaY: DexSurface.blurSigma,
              ),
              child: Container(
                decoration: BoxDecoration(
                  gradient: DexSurface.glossyGradient(),
                  borderRadius: DexRadius.rlg,
                  border: DexSurface.glossyBorder(),
                  boxShadow: DexSurface.glossyShadow,
                ),
                padding: const EdgeInsets.all(DexSpace.xl),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(title,
                        textAlign: TextAlign.center,
                        style: DexType.heading(color: DexColors.text)),
                    const SizedBox(height: DexSpace.sm),
                    Text(description,
                        textAlign: TextAlign.center,
                        style: DexType.body(color: DexColors.textDim)),
                    const SizedBox(height: DexSpace.xl),
                    ElevatedButton(
                      onPressed: () => Navigator.of(context).pop(true),
                      child: const Text('Yes'),
                    ),
                    const SizedBox(height: DexSpace.sm),
                    OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(false),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: DexColors.text,
                        side: const BorderSide(color: DexColors.border),
                        padding: const EdgeInsets.symmetric(vertical: DexSpace.md),
                        shape: const RoundedRectangleBorder(
                          borderRadius: DexRadius.rsm,
                        ),
                      ),
                      child: const Text('No'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
