// Shared "card" container used by the empty-home recent-files and
// recent-chats panels. Acrylic background, header row, slot for rows.

import 'dart:ui';

import 'package:flutter/material.dart';

import '../../theme/tokens.dart';

class HomeCard extends StatelessWidget {
  const HomeCard({
    super.key,
    required this.icon,
    required this.title,
    this.trailing,
    required this.child,
  });

  final IconData icon;
  final String title;
  final Widget? trailing;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: DexRadius.rmd,
      child: BackdropFilter(
        filter: ImageFilter.blur(
          sigmaX: DexSurface.blurSigma,
          sigmaY: DexSurface.blurSigma,
        ),
        child: Container(
          decoration: BoxDecoration(
            color: DexColors.surface2.withValues(
              alpha: DexSurface.acrylicAlphaQuiet,
            ),
            borderRadius: DexRadius.rmd,
            border: Border.all(color: DexColors.border),
          ),
          padding: const EdgeInsets.all(DexSpace.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Icon(icon, size: 14, color: DexColors.textDim),
                  const SizedBox(width: DexSpace.sm),
                  Expanded(
                    child: Text(title,
                        style: DexType.label(color: DexColors.text)),
                  ),
                  if (trailing != null) trailing!,
                ],
              ),
              const SizedBox(height: DexSpace.sm),
              child,
            ],
          ),
        ),
      ),
    );
  }
}
