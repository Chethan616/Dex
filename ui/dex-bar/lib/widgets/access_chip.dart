import 'dart:async';

import 'package:flutter/material.dart';

import '../core/window_activity.dart';
import '../theme/tokens.dart';
import 'primitives/primitives.dart';

/// Full Access toggle. OFF = Dex asks before each risky step.
/// ON = the daemon runs elevated in the owner's session and stops asking.
///
/// Behind the same movement guard as the confirmation card, and for a sharper
/// reason: this control grants and revokes administrator elevation. Raising a
/// window on Windows injects a synthetic click at the cursor, so without the
/// guard an unaimed click could silently turn Full Access off — unregistering
/// the logon task and rewriting .env — or, worse, on. It was the only
/// consequential control in the app left unguarded, which is exactly the kind
/// of gap a UI rewrite leaves behind.
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
  bool _armed = false;
  Timer? _arm;

  @override
  void initState() {
    super.initState();
    // Polled, not driven by hover.
    //
    // The obvious version — read the guard during build and let the hover
    // handler rebuild — deadlocks: FocusableActionDetector does not report
    // hover while it is disabled, so the one event that would rebuild the chip
    // never arrives and it can never arm itself. The confirmation card polls
    // for the same reason.
    //
    // Re-evaluated continuously and never latched, so if the window is raised
    // again while the chip is on screen it goes inert again.
    _arm = Timer.periodic(const Duration(milliseconds: 50), (timer) {
      if (!mounted) return timer.cancel();
      final armed = WindowActivity.safeToAccept;
      if (armed != _armed) setState(() => _armed = armed);
    });
  }

  @override
  void dispose() {
    _arm?.cancel();
    super.dispose();
  }

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
        enabled: _armed,
        radius: 999,
        semanticLabel: label,
        onTap: () => widget.onToggle(!widget.enabled),
        onHoverChanged: (v) {
          if (v != _hover) setState(() => _hover = v);
        },
        // Dimmed until armed, so an inert control looks inert rather than
        // looking clickable and quietly doing nothing.
        child: AnimatedOpacity(
          duration: DexTokens.durFast,
          opacity: _armed ? 1 : 0.45,
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
                  decoration: BoxDecoration(
                    color: color,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: DexTokens.spaceSm),
                Text(label, style: DexType.label(color: color, strong: true)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
