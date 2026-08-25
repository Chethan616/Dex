import 'package:flutter/material.dart';

import '../theme/tokens.dart';

/// Full Access toggle. OFF = red, DEX asks for elevation per action.
/// ON = green, the daemon runs as LocalSystem and never prompts again.
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
    final color = widget.enabled ? t.eventColor('done') : t.eventColor('failed');
    final label = widget.enabled ? 'Full Access: ON' : 'Full Access: OFF';

    final tip = widget.enabled
        ? 'DexDaemon service: ${widget.serviceState}\nClick to revoke — removes the service.'
        : 'Click to grant. One Windows elevation prompt, then never again.';

    return Tooltip(
      message: tip,
      textStyle: DexType.sans(size: 11, color: t.text),
      decoration: BoxDecoration(
        color: t.surfaceRaised,
        borderRadius: BorderRadius.circular(DexTokens.radiusSm),
        border: Border.all(color: t.border),
      ),
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        onEnter: (_) => setState(() => _hover = true),
        onExit: (_) => setState(() => _hover = false),
        child: GestureDetector(
          onTap: () => widget.onToggle(!widget.enabled),
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
                Text(
                  label,
                  style: DexType.sans(size: 11.5, color: color, weight: FontWeight.w600),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
