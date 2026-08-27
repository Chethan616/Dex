import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../theme/tokens.dart';

/// Keyboard focus, made visible.
///
/// Dex sets `splashFactory: NoSplash` and a transparent highlight, and every
/// control used to be a bare [GestureDetector] — so a keyboard user got no
/// indication of where they were, on a surface whose whole job is asking for
/// deliberate approval. This draws the ring, and routes Enter/Space to the same
/// callback the pointer uses.
///
/// The ring's 2px gutter is reserved whether or not it is drawn, so focus never
/// reflows the row.
///
/// **The [enabled] gate is load-bearing.** A disabled control is not focusable
/// and its activation actions are not installed, so the keyboard cannot reach a
/// button the pointer is forbidden to press. That matters because `enabled`
/// is how the confirmation card's injected-click guard is expressed: a keyboard
/// path around it would be a hole straight through the guard.
class FocusRing extends StatefulWidget {
  const FocusRing({
    super.key,
    required this.child,
    required this.onTap,
    required this.enabled,
    this.radius = DexTokens.radiusSm,
    this.onHoverChanged,
    this.semanticLabel,
  });

  final Widget child;
  final VoidCallback onTap;
  final bool enabled;
  final double radius;
  final ValueChanged<bool>? onHoverChanged;
  final String? semanticLabel;

  @override
  State<FocusRing> createState() => _FocusRingState();
}

class _FocusRingState extends State<FocusRing> {
  bool _focused = false;

  void _activate() {
    if (widget.enabled) widget.onTap();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;

    return FocusableActionDetector(
      enabled: widget.enabled,
      mouseCursor:
          widget.enabled ? SystemMouseCursors.click : SystemMouseCursors.basic,
      onShowFocusHighlight: (v) {
        if (v != _focused) setState(() => _focused = v);
      },
      onShowHoverHighlight: widget.onHoverChanged,
      shortcuts: const {
        SingleActivator(LogicalKeyboardKey.enter): ActivateIntent(),
        SingleActivator(LogicalKeyboardKey.space): ActivateIntent(),
      },
      actions: {
        ActivateIntent: CallbackAction<ActivateIntent>(
          onInvoke: (_) {
            _activate();
            return null;
          },
        ),
      },
      child: Semantics(
        button: true,
        enabled: widget.enabled,
        label: widget.semanticLabel,
        child: Container(
          padding: const EdgeInsets.all(2),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(widget.radius + 2),
            border: Border.all(
              width: 2,
              color: _focused && widget.enabled
                  ? t.focusRing.withValues(alpha: 0.60)
                  : Colors.transparent,
            ),
          ),
          child: GestureDetector(
            // Null, not a guarded callback. A control that must not act has to
            // be absent from the gesture arena entirely, so a click cannot be
            // queued against it and delivered a frame later.
            onTap: widget.enabled ? widget.onTap : null,
            child: widget.child,
          ),
        ),
      ),
    );
  }
}
