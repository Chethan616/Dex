import 'package:flutter/material.dart';

import '../../theme/tokens.dart';
import 'focus_ring.dart';

enum DexButtonVariant {
  /// Filled in its tone. One per surface — the thing you most likely want.
  primary,

  /// Outlined. The alternatives.
  secondary,

  /// Text only. Dismissals and tertiary actions.
  ghost,
}

/// The button. Replaces six near-identical implementations that had drifted to
/// four different paddings, three radii and two type sizes: `_BarButton`,
/// `_CardButton`, the Library's `Run`, the save-suggestion `Save`, the
/// evidence chips and `AccessChip`'s body.
class DexButton extends StatefulWidget {
  const DexButton({
    super.key,
    required this.label,
    required this.onTap,
    this.tone,
    this.variant = DexButtonVariant.secondary,
    this.enabled = true,
    this.dense = false,
    this.icon,
  });

  final String label;
  final VoidCallback onTap;

  /// Defaults to `textMuted` — a button with no tone is not an accident, it is
  /// a neutral action.
  final Color? tone;
  final DexButtonVariant variant;

  /// False makes the control inert *and* unfocusable. See [FocusRing].
  final bool enabled;
  final bool dense;
  final IconData? icon;

  @override
  State<DexButton> createState() => _DexButtonState();
}

class _DexButtonState extends State<DexButton> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final tone = widget.tone ?? t.textMuted;
    final hover = _hover && widget.enabled;

    final (Color bg, Color line, Color fg) = switch (widget.variant) {
      DexButtonVariant.primary => (
          tone.withValues(alpha: hover ? 0.26 : 0.16),
          tone.withValues(alpha: 0.50),
          tone,
        ),
      DexButtonVariant.secondary => (
          hover ? t.surfaceRaised : Colors.transparent,
          t.border,
          tone,
        ),
      DexButtonVariant.ghost => (
          hover ? t.surfaceRaised : Colors.transparent,
          Colors.transparent,
          tone,
        ),
    };

    final pad = widget.dense
        ? const EdgeInsets.symmetric(horizontal: 10, vertical: 5)
        : const EdgeInsets.symmetric(horizontal: 13, vertical: 8);

    return FocusRing(
      enabled: widget.enabled,
      onTap: widget.onTap,
      semanticLabel: widget.label,
      onHoverChanged: (v) {
        if (v != _hover) setState(() => _hover = v);
      },
      child: AnimatedOpacity(
        duration: DexTokens.durFast,
        opacity: widget.enabled ? 1 : 0.35,
        child: AnimatedContainer(
          duration: DexTokens.durFast,
          padding: pad,
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(DexTokens.radiusSm),
            border: Border.all(color: line),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (widget.icon != null) ...[
                Icon(widget.icon, size: 13, color: fg),
                const SizedBox(width: 6),
              ],
              Text(
                widget.label,
                style: DexType.label(
                  color: fg,
                  strong: widget.variant == DexButtonVariant.primary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// An icon-only tap target with a tooltip. Same focus and arming rules.
class DexIconButton extends StatefulWidget {
  const DexIconButton({
    super.key,
    required this.icon,
    required this.tooltip,
    required this.onTap,
    this.enabled = true,
    this.size = 16,
    this.tone,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  final bool enabled;
  final double size;
  final Color? tone;

  @override
  State<DexIconButton> createState() => _DexIconButtonState();
}

class _DexIconButtonState extends State<DexIconButton> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final tone = widget.tone ?? t.textMuted;

    return Tooltip(
      message: widget.tooltip,
      child: FocusRing(
        enabled: widget.enabled,
        onTap: widget.onTap,
        semanticLabel: widget.tooltip,
        onHoverChanged: (v) {
          if (v != _hover) setState(() => _hover = v);
        },
        child: AnimatedContainer(
          duration: DexTokens.durFast,
          padding: const EdgeInsets.all(5),
          decoration: BoxDecoration(
            color: _hover && widget.enabled
                ? t.surfaceRaised
                : Colors.transparent,
            borderRadius: BorderRadius.circular(DexTokens.radiusSm),
          ),
          child: Icon(
            widget.icon,
            size: widget.size,
            color: _hover && widget.enabled ? t.text : tone,
          ),
        ),
      ),
    );
  }
}
