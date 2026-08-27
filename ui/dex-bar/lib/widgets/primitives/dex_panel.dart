import 'package:flutter/material.dart';

import '../../theme/tokens.dart';

/// A bounded region of content: surface, hairline, radius.
///
/// The confirmation card, the Library panel, evidence rows and workflow tiles
/// each built this by hand, and had drifted to three different radii and two
/// different surfaces for the same visual role.
class DexPanel extends StatelessWidget {
  const DexPanel({
    super.key,
    required this.child,
    this.raised = true,
    this.accent,
    this.padding,
    this.margin,
    this.radius = DexTokens.radiusMd,
    this.clip = false,
  });

  final Widget child;

  /// Raised panels sit on top of the bar; flat ones sit inside another panel.
  final bool raised;

  /// Draws a rail down the leading edge in this tone.
  ///
  /// This exists for the confirmation card. Tier 2 and Tier 3 previously
  /// differed only by the hue of a 35%-alpha hairline, which is a distinction
  /// nobody reads under time pressure — and the two tiers mean genuinely
  /// different things ("asks every time" versus "hands out a session pass").
  /// A solid rail is legible before any text is.
  final Color? accent;

  final EdgeInsets? padding;
  final EdgeInsets? margin;
  final double radius;
  final bool clip;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final body = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: raised ? t.surfaceRaised : t.surface,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(
          color: accent == null ? t.border : accent!.withValues(alpha: 0.30),
        ),
      ),
      clipBehavior: clip || accent != null ? Clip.antiAlias : Clip.none,
      child: accent == null
          ? child
          // Stack, not a stretched Row. A Row with CrossAxisAlignment.stretch
          // hands its children an infinite height constraint whenever the panel
          // itself has unbounded height -- which is exactly where the
          // confirmation card lives now that the bar measures its own content.
          // A positioned rail takes the height the child settles on instead of
          // demanding one.
          : Stack(
              children: [
                // Inset by the rail's width so the rail sits beside the
                // content rather than on top of its first character.
                Padding(padding: const EdgeInsets.only(left: 3), child: child),
                Positioned(
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 3,
                  child: ColoredBox(color: accent!),
                ),
              ],
            ),
    );

    return margin == null ? body : Padding(padding: margin!, child: body);
  }
}
