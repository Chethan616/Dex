import 'dart:async';

import 'package:flutter/material.dart';

import '../core/models.dart';
import '../core/window_activity.dart';
import '../theme/tokens.dart';

const _tierLabel = {
  1: 'HAND-OFF',
  2: 'CONFIRM',
  3: 'PRE-APPROVE',
  4: 'SILENT',
};

const _tierBlurb = {
  1: 'DEX cannot do this part — you do it, then DEX continues.',
  2: 'This is not reversible. DEX asks every single time.',
  3: 'Approve once and DEX stops asking for the rest of this session.',
  4: 'No approval needed.',
};

/// Slides inline above the input. Shows the exact action, never a paraphrase.
class ConfirmationCard extends StatefulWidget {
  const ConfirmationCard({
    super.key,
    required this.request,
    required this.onRespond,
    required this.onCancelTask,
  });

  final ConfirmationRequest request;

  /// Emits one of `approved`, `approved_session`, `handed_off`, `rejected`.
  final ValueChanged<String> onRespond;
  final VoidCallback onCancelTask;

  @override
  State<ConfirmationCard> createState() => _ConfirmationCardState();
}

/// A consequential card must not be clickable the instant it appears, nor the
/// instant its window is raised under the pointer. Both clocks have to have run
/// out before any button here accepts input. See [WindowActivity] for why.
class _ConfirmationCardState extends State<ConfirmationCard> {
  Timer? _tick;
  Timer? _arm;
  Duration _left = Duration.zero;
  bool _armed = false;
  late final int _mountedAtMs;

  @override
  void initState() {
    super.initState();
    _mountedAtMs = DateTime.now().millisecondsSinceEpoch;
    _recompute();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) => _recompute());
    // Re-evaluated continuously, never latched: if the window is raised, moved
    // or resized again while the card is up, the buttons go inert again. A
    // latched arm would leave a live Approve button under a window that just
    // jumped under the pointer.
    _arm = Timer.periodic(const Duration(milliseconds: 50), (timer) {
      if (!mounted) return timer.cancel();
      final sinceMount = DateTime.now().millisecondsSinceEpoch - _mountedAtMs;
      final armed = sinceMount >= WindowActivity.settleDelay.inMilliseconds &&
          WindowActivity.safeToAccept;
      if (armed != _armed) setState(() => _armed = armed);
    });
  }

  void _recompute() {
    final ms = widget.request.expiresAt - DateTime.now().millisecondsSinceEpoch;
    if (!mounted) return;
    setState(() => _left = Duration(milliseconds: ms.clamp(0, 1 << 31)));
  }

  @override
  void dispose() {
    _tick?.cancel();
    _arm?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final req = widget.request;
    final tierColor = t.tierColor(req.tier);

    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: DexTokens.durSlow,
      curve: Curves.easeOutCubic,
      builder: (context, v, child) => Opacity(
        opacity: v,
        child: Transform.translate(offset: Offset(0, (1 - v) * 10), child: child),
      ),
      child: Container(
        margin: const EdgeInsets.fromLTRB(
          DexTokens.spaceLg,
          DexTokens.spaceSm,
          DexTokens.spaceLg,
          DexTokens.spaceSm,
        ),
        decoration: BoxDecoration(
          color: t.surfaceRaised,
          borderRadius: BorderRadius.circular(DexTokens.radiusMd),
          border: Border.all(color: tierColor.withValues(alpha: 0.35)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.fromLTRB(DexTokens.spaceMd, DexTokens.spaceSm,
                  DexTokens.spaceMd, DexTokens.spaceSm),
              decoration: BoxDecoration(
                color: tierColor.withValues(alpha: 0.10),
                borderRadius: const BorderRadius.vertical(
                  top: Radius.circular(DexTokens.radiusMd),
                ),
              ),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: tierColor.withValues(alpha: 0.18),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      'TIER ${req.tier} · ${_tierLabel[req.tier] ?? ''}',
                      style: DexType.mono(
                        size: 10,
                        color: tierColor,
                        weight: FontWeight.w600,
                        spacing: 0.4,
                      ),
                    ),
                  ),
                  const SizedBox(width: DexTokens.spaceSm),
                  Expanded(
                    child: Text(
                      _tierBlurb[req.tier] ?? '',
                      style: DexType.sans(size: 11.5, color: t.textMuted),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Text(
                    '${_left.inSeconds}s',
                    style: DexType.mono(
                      size: 11,
                      color: _left.inSeconds < 15 ? t.eventColor('failed') : t.textFaint,
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(DexTokens.spaceMd),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${req.capability} → ${req.action}',
                    style: DexType.mono(size: 11, color: t.textMuted),
                  ),
                  const SizedBox(height: DexTokens.spaceXs),
                  SelectableText(
                    req.description,
                    style: DexType.mono(size: 13, color: t.text, height: 1.45),
                  ),
                  const SizedBox(height: DexTokens.spaceXs),
                  Text(
                    'step ${req.stepId} · v${req.stepVersion}',
                    style: DexType.mono(size: 10, color: t.textFaint),
                  ),
                  const SizedBox(height: DexTokens.spaceMd),
                  // Wrap, not Row: a Tier 3 card carries four controls and must
                  // flow onto a second line rather than clip one of them.
                  Wrap(
                    spacing: DexTokens.spaceSm,
                    runSpacing: DexTokens.spaceSm,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      // Tier 1 is a hand-off: DEX cannot do it, so there is
                      // nothing to approve — only "I did it, carry on".
                      if (req.tier == 1)
                        _CardButton(
                          label: 'Done, continue',
                          primary: true,
                          enabled: _armed,
                          color: t.eventColor('done'),
                          onTap: () => widget.onRespond('handed_off'),
                        )
                      else ...[
                        _CardButton(
                          label: 'Approve once',
                          primary: true,
                          enabled: _armed,
                          color: t.eventColor('done'),
                          onTap: () => widget.onRespond('approved'),
                        ),
                        // Tier 2 never offers a session pass — it re-asks every time.
                        if (req.tier == 3)
                          _CardButton(
                            label: 'Approve for session',
                            enabled: _armed,
                            color: t.eventColor('done'),
                            onTap: () => widget.onRespond('approved_session'),
                          ),
                      ],
                      _CardButton(
                        label: req.tier == 1 ? 'Skip' : 'Reject',
                        enabled: _armed,
                        color: t.eventColor('failed'),
                        onTap: () => widget.onRespond('rejected'),
                      ),
                      _CardButton(
                        label: 'Cancel task',
                        enabled: _armed,
                        color: t.textMuted,
                        onTap: widget.onCancelTask,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CardButton extends StatefulWidget {
  const _CardButton({
    required this.label,
    required this.color,
    required this.onTap,
    required this.enabled,
    this.primary = false,
  });

  final String label;
  final Color color;
  final VoidCallback onTap;
  final bool enabled;
  final bool primary;

  @override
  State<_CardButton> createState() => _CardButtonState();
}

class _CardButtonState extends State<_CardButton> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final hover = _hover && widget.enabled;
    final bg = widget.primary
        ? widget.color.withValues(alpha: hover ? 0.24 : 0.16)
        : (hover ? t.surface : Colors.transparent);

    return MouseRegion(
      cursor: widget.enabled ? SystemMouseCursors.click : SystemMouseCursors.basic,
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: GestureDetector(
        // Null, not a guarded callback: an unarmed button must not be in the
        // gesture arena at all, so a click cannot be queued against it.
        onTap: widget.enabled ? widget.onTap : null,
        child: AnimatedOpacity(
          duration: DexTokens.durFast,
          opacity: widget.enabled ? 1 : 0.35,
          child: AnimatedContainer(
            duration: DexTokens.durFast,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              color: bg,
              borderRadius: BorderRadius.circular(DexTokens.radiusSm),
              border: Border.all(
                color: widget.primary
                    ? widget.color.withValues(alpha: 0.5)
                    : t.border,
              ),
            ),
            child: Text(
              widget.label,
              style: DexType.sans(
                size: 12.5,
                color: widget.primary ? widget.color : t.textMuted,
                weight: widget.primary ? FontWeight.w600 : FontWeight.w500,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
