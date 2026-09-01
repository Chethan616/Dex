// Full Access: stop being asked before every privileged step.
//
// This exists because of a plan that produced twelve `run_command` steps.
// Every one of them was Tier 2, so every one raised an approval card, and the
// owner had to answer twelve times to change one power plan. Full Access is
// the answer to that — one Windows consent, once, and then those steps run.
//
// The control carries the injected-click guard, and that is not decoration.
// Raising a window on Windows injects a synthetic click at the cursor, and
// this toggle grants and revokes administrator elevation. It has been flipped
// by a click nobody aimed before — the logon task vanished and Full Access
// turned itself off mid-session with nothing on screen having been pressed.
// So it stays inert until the window has settled *and* the pointer has moved.

import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/dex_gateway.dart';
import '../../core/window_activity.dart';
import '../../theme/tokens.dart';

class FullAccessCard extends StatefulWidget {
  const FullAccessCard({super.key, required this.client});

  final DexGatewayClient client;

  @override
  State<FullAccessCard> createState() => _FullAccessCardState();
}

class _FullAccessCardState extends State<FullAccessCard> {
  bool _armed = false;
  Timer? _arm;

  @override
  void initState() {
    super.initState();
    widget.client.addListener(_onChange);

    // Polled, not driven by hover.
    //
    // The obvious version — read the guard during build and let a hover
    // handler rebuild — deadlocks: a disabled control does not report hover,
    // so the one event that would arm it never arrives. Re-evaluated
    // continuously and never latched, so if the window is raised again while
    // this is on screen it goes inert again.
    _arm = Timer.periodic(const Duration(milliseconds: 50), (timer) {
      if (!mounted) return timer.cancel();
      final armed = WindowActivity.safeToAccept;
      if (armed != _armed) setState(() => _armed = armed);
    });
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _arm?.cancel();
    widget.client.removeListener(_onChange);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final on = widget.client.fullAccess;
    final tone = on ? DexColors.stateApprove : DexColors.stateAwaiting;

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: on
            ? DexColors.stateApprove.withValues(alpha: 0.07)
            : DexColors.surface.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: on ? tone.withValues(alpha: 0.5) : DexColors.border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(on ? Icons.lock_open_rounded : Icons.lock_outline_rounded,
                  size: 19, color: on ? tone : DexColors.textDim),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Full Access',
                      style: TextStyle(
                        color: DexColors.text,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      on
                          ? 'Privileged steps run without asking.'
                          : 'Dex asks before each privileged step. A plan with a '
                              'dozen of them means a dozen approvals.',
                      style: const TextStyle(
                        color: DexColors.textDim,
                        fontSize: 12,
                        height: 1.5,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              _Toggle(
                on: on,
                armed: _armed,
                onTap: () => widget.client.setFullAccess(!on),
              ),
            ],
          ),
          if (!_armed) ...[
            const SizedBox(height: 10),
            const Text(
              'Move the mouse to enable this control.',
              style: TextStyle(color: DexColors.textFaint, fontSize: 11),
            ),
          ],
          if (widget.client.fullAccessNotice != null) ...[
            const SizedBox(height: 12),
            _Note(
              tone: DexColors.stateActing,
              text: widget.client.fullAccessNotice!,
            ),
          ],
          const SizedBox(height: 16),
          const Text(
            'One Windows prompt, once. After that a logon task runs the daemon '
            'elevated in your own session, so DNS, Wi-Fi, power plans and '
            'registry writes work without asking again.',
            style: TextStyle(color: DexColors.textDim, fontSize: 12, height: 1.5),
          ),
          const SizedBox(height: 14),
          const _Boundary(
            'RED registry keys stay refused.',
            'Defender, Group Policy, services, Winlogon, LSA, autostart, UAC. '
                'Full Access does not unlock them.',
          ),
          const _Boundary(
            'Hand-offs still reach you.',
            'No privilege lets Dex read a CAPTCHA or type a password it does '
                'not know. Those always stop and ask.',
          ),
          const _Boundary(
            'It turns itself off if it is not real.',
            'Configured but not actually elevated is the worst state available '
                '— approvals skipped for steps that then fail. Dex detects that '
                'and puts the cards back.',
          ),
        ],
      ),
    );
  }
}

class _Toggle extends StatelessWidget {
  const _Toggle({required this.on, required this.armed, required this.onTap});

  final bool on;
  final bool armed;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tone = on ? DexColors.stateApprove : DexColors.stateAwaiting;

    return Opacity(
      // Dimmed until armed, so an inert control looks inert rather than
      // looking pressable and quietly doing nothing.
      opacity: armed ? 1 : 0.4,
      child: GestureDetector(
        onTap: armed ? onTap : null,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
            color: tone.withValues(alpha: 0.16),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: tone.withValues(alpha: 0.5)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(color: tone, shape: BoxShape.circle),
              ),
              const SizedBox(width: 8),
              Text(
                on ? 'ON' : 'OFF',
                style: TextStyle(
                  color: tone,
                  fontSize: 11,
                  letterSpacing: 0.8,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Boundary extends StatelessWidget {
  const _Boundary(this.title, this.detail);

  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.shield_outlined, size: 14, color: DexColors.accent),
            const SizedBox(width: 9),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: const TextStyle(
                        color: DexColors.text,
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                      )),
                  const SizedBox(height: 2),
                  Text(detail,
                      style: const TextStyle(
                        color: DexColors.textDim,
                        fontSize: 11.5,
                        height: 1.45,
                      )),
                ],
              ),
            ),
          ],
        ),
      );
}

class _Note extends StatelessWidget {
  const _Note({required this.tone, required this.text});

  final Color tone;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
        decoration: BoxDecoration(
          color: tone.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: tone.withValues(alpha: 0.3)),
        ),
        child: Text(text,
            style: TextStyle(color: tone, fontSize: 11.5, height: 1.45)),
      );
}
