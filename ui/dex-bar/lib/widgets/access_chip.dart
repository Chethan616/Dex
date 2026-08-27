import 'package:flutter/material.dart';

import '../theme/tokens.dart';
import 'primitives/primitives.dart';

/// Full Access toggle. OFF = Dex asks for elevation per action.
/// ON = the daemon runs as LocalSystem and never prompts again.
class AccessChip extends StatefulWidget {
  const AccessChip({
    super.key,
    required this.enabled,
    required this.serviceState,
    required this.onToggle,
  });

  final bool enabled;
  final String serviceState;
  final ValueChanged<bool> onToggle;

  @override
  State<AccessChip> createState() => _AccessChipState();
}

class _AccessChipState extends State<AccessChip> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    // Green for granted, amber for not. Not red: Full Access being off is the
    // safe state, and colouring the safe state as an error teaches the owner to
    // turn it on to make the warning go away.
    final color = widget.enabled ? t.positive : t.warn;
    final label = widget.enabled ? 'Full Access: ON' : 'Full Access: OFF';

    final tip = widget.enabled
        ? 'DexDaemon service: ${widget.serviceState}\n'
            'Click to revoke — removes the service.'
        : 'Click to grant. One Windows elevation prompt, then never again.';

    return Tooltip(
      message: tip,
      child: FocusRing(
        enabled: true,
        radius: 999,
        semanticLabel: label,
        onTap: () => widget.onToggle(!widget.enabled),
        onHoverChanged: (v) {
          if (v != _hover) setState(() => _hover = v);
        },
        child: AnimatedContainer(
          duration: DexTokens.durFast,
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: color.withValues(alpha: _hover ? 0.18 : 0.10),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: color.withValues(alpha: 0.45)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              ),
              const SizedBox(width: DexTokens.spaceSm),
              Text(label, style: DexType.label(color: color, strong: true)),
            ],
          ),
        ),
      ),
    );
  }
}
