import 'dart:async';

import 'package:flutter/material.dart';

import '../core/models.dart';
import '../core/window_activity.dart';
import '../theme/tokens.dart';
import 'primitives/primitives.dart';

const _tierLabel = {
  1: 'HAND-OFF',
  2: 'CONFIRM',
  3: 'PRE-APPROVE',
  4: 'SILENT',
};

const _tierBlurb = {
  1: 'Dex cannot do this part — you do it, then Dex continues.',
  2: 'Not reversible. Dex asks every single time, and there is no session pass '
      'for this tier.',
  3: 'Approve once, or let this action through until Dex restarts.',
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
      // The rail is the tier. Tier 2 and Tier 3 used to differ only by the hue
      // of a 35%-alpha hairline — a distinction nobody resolves under time
      // pressure, between two things that mean genuinely different amounts of
      // trust.
      child: DexPanel(
        accent: tierColor,
        margin: const EdgeInsets.fromLTRB(
          DexTokens.spaceLg,
          DexTokens.spaceSm,
          DexTokens.spaceLg,
          DexTokens.spaceSm,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _header(t, req, tierColor),
            Padding(
              padding: const EdgeInsets.all(DexTokens.spaceMd),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${req.capability} → ${req.action}',
                    style: DexType.codeSm(color: t.textMuted),
                  ),
                  const SizedBox(height: DexTokens.spaceXs),
                  SelectableText(
                    req.description,
                    style: DexType.code(color: t.text),
                  ),
                  if (req.params.isNotEmpty) ...[
                    const SizedBox(height: DexTokens.spaceSm),
                    _Params(params: req.params),
                  ],
                  const SizedBox(height: DexTokens.spaceSm),
                  Text(
                    'step ${req.stepId} · v${req.stepVersion}',
                    style: DexType.codeSm(color: t.textFaint),
                  ),
                  const SizedBox(height: DexTokens.spaceMd),
                  _actions(t, req),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _header(DexTokens t, ConfirmationRequest req, Color tierColor) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(
        DexTokens.spaceMd,
        DexTokens.spaceSm,
        DexTokens.spaceMd,
        DexTokens.spaceSm,
      ),
      color: tierColor.withValues(alpha: 0.10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              DexTag(
                'Tier ${req.tier} · ${_tierLabel[req.tier] ?? ''}',
                tone: tierColor,
              ),
              const Spacer(),
              Text(
                '${_left.inSeconds}s',
                style: DexType.codeSm(
                  color: _left.inSeconds < 15 ? t.negative : t.textFaint,
                ),
              ),
            ],
          ),
          const SizedBox(height: DexTokens.spaceXs),
          Text(
            _tierBlurb[req.tier] ?? '',
            style: DexType.caption(color: t.textMuted),
          ),
        ],
      ),
    );
  }

  Widget _actions(DexTokens t, ConfirmationRequest req) {
    // Wrap, not Row: a Tier 3 card carries four controls and must flow onto a
    // second line rather than clip one of them.
    return Wrap(
      spacing: DexTokens.spaceSm,
      runSpacing: DexTokens.spaceSm,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        // Tier 1 is a hand-off: Dex cannot do it, so there is nothing to
        // approve — only "I did it, carry on".
        if (req.tier == 1)
          DexButton(
            label: 'Done, continue',
            variant: DexButtonVariant.primary,
            enabled: _armed,
            tone: t.positive,
            onTap: () => widget.onRespond('handed_off'),
          )
        else ...[
          DexButton(
            label: 'Approve once',
            variant: DexButtonVariant.primary,
            enabled: _armed,
            tone: t.positive,
            onTap: () => widget.onRespond('approved'),
          ),
          // Tier 2 never offers a session pass — it re-asks every time.
          if (req.tier == 3)
            DexButton(
              label: 'Approve for session',
              enabled: _armed,
              tone: t.positive,
              onTap: () => widget.onRespond('approved_session'),
            ),
        ],
        DexButton(
          label: req.tier == 1 ? 'Skip' : 'Reject',
          enabled: _armed,
          tone: t.negative,
          onTap: () => widget.onRespond('rejected'),
        ),
        DexButton(
          label: 'Cancel task',
          variant: DexButtonVariant.ghost,
          enabled: _armed,
          onTap: widget.onCancelTask,
        ),
      ],
    );
  }
}

/// The exact payload, as key and value.
///
/// These arrive on the wire and were never shown. The description line above is
/// a summary the core composed; this is what will actually be sent. On a card
/// whose entire purpose is "the exact action, never a paraphrase", the
/// paraphrase was the only thing on screen.
class _Params extends StatelessWidget {
  const _Params({required this.params});

  final Map<String, dynamic> params;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: t.surface,
        borderRadius: BorderRadius.circular(DexTokens.radiusSm),
        border: Border.all(color: t.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final entry in params.entries)
            Padding(
              padding: const EdgeInsets.only(bottom: 1),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 96,
                    child: Text(
                      entry.key,
                      overflow: TextOverflow.ellipsis,
                      style: DexType.codeSm(color: t.textMuted),
                    ),
                  ),
                  const SizedBox(width: DexTokens.spaceSm),
                  Expanded(
                    child: SelectableText(
                      '${entry.value}',
                      style: DexType.codeSm(color: t.text),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
