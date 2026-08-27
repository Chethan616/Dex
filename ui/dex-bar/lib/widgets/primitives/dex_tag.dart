import 'package:flutter/material.dart';

import '../../theme/tokens.dart';

/// A small status word. Absorbs what were five separate implementations:
/// `_pill`, `_StatusPill`, `_KeyHint`, the confirmation tier chip and the
/// evidence status chip.
///
/// Two shapes, and the shape carries meaning:
///   * [DexTag] — squared, for a machine value (TIER 2, VERIFIED, COMPLETED)
///   * [DexTag.round] — pill, for a live state (running, needs you)
class DexTag extends StatelessWidget {
  const DexTag(
    this.text, {
    super.key,
    this.tone,
    this.filled = true,
    this.outlined = false,
    this.round = false,
    this.uppercase = true,
  });

  const DexTag.round(
    this.text, {
    super.key,
    this.tone,
    this.filled = true,
    this.outlined = true,
  })  : round = true,
        uppercase = false;

  final String text;
  final Color? tone;
  final bool filled;
  final bool outlined;
  final bool round;

  /// Squared tags are machine values and are set in caps; round ones are Dex
  /// speaking and are not.
  final bool uppercase;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final color = tone ?? t.textFaint;

    return Container(
      padding: EdgeInsets.symmetric(horizontal: round ? 8 : 6, vertical: round ? 3 : 2),
      decoration: BoxDecoration(
        color: filled ? color.withValues(alpha: 0.14) : Colors.transparent,
        borderRadius: BorderRadius.circular(round ? 999 : 4),
        border: outlined
            ? Border.all(color: color.withValues(alpha: 0.35))
            : null,
      ),
      child: Text(
        uppercase ? text.toUpperCase() : text,
        style: round
            ? DexType.codeSm(color: color)
            : DexType.tag(color: color),
      ),
    );
  }
}

/// A keyboard hint — `Enter`, `Ctrl+M`. Reads as a key, not as a status.
class DexKeyHint extends StatelessWidget {
  const DexKeyHint(this.label, {super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: t.surfaceRaised,
        borderRadius: BorderRadius.circular(DexTokens.radiusSm),
        border: Border.all(color: t.border),
      ),
      child: Text(label, style: DexType.codeSm(color: t.textFaint)),
    );
  }
}
