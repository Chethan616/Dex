import 'package:flutter/material.dart';

import '../core/models.dart';
import '../theme/tokens.dart';

/// The live thinking-steps view: one line per event, newest at the bottom.
///
/// The prefix used to be `type:step_id` right-aligned inside a fixed 148px
/// column — a fifth of a 760px bar spent on a label, with the step id (the
/// least interesting part) sharing the same weight as the event type, and both
/// truncating together once the type ran long.
///
/// Now the type leads with a glyph, so the shape of a run is scannable without
/// reading a word, and the step id sits at the far right where it is available
/// but not competing.
class StepStream extends StatefulWidget {
  const StepStream({
    super.key,
    required this.events,
    this.padding,
    this.shrinkWrap = false,
  });

  final List<DexEvent> events;
  final EdgeInsets? padding;

  /// Measure to content instead of filling the parent.
  ///
  /// This is what lets the bar size itself to a run: a two-event task now
  /// occupies two lines, where it used to occupy two lines and 400px of
  /// deliberate emptiness.
  final bool shrinkWrap;

  @override
  State<StepStream> createState() => _StepStreamState();
}

class _StepStreamState extends State<StepStream> {
  final _scroll = ScrollController();

  @override
  void didUpdateWidget(covariant StepStream old) {
    super.didUpdateWidget(old);
    if (widget.events.length != old.events.length) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) {
          _scroll.animateTo(
            _scroll.position.maxScrollExtent,
            duration: DexTokens.durMed,
            curve: Curves.easeOutCubic,
          );
        }
      });
    }
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      controller: _scroll,
      shrinkWrap: widget.shrinkWrap,
      padding: widget.padding ??
          const EdgeInsets.fromLTRB(
            DexTokens.spaceLg,
            DexTokens.spaceSm,
            DexTokens.spaceLg,
            DexTokens.spaceLg,
          ),
      itemCount: widget.events.length,
      itemBuilder: (context, i) => _StepLine(
        event: widget.events[i],
        isLatest: i == widget.events.length - 1,
      ),
    );
  }
}

class _StepLine extends StatelessWidget {
  const _StepLine({required this.event, required this.isLatest});

  final DexEvent event;
  final bool isLatest;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final color = t.eventColor(event.type);

    return TweenAnimationBuilder<double>(
      key: ValueKey('${event.timestamp}-${event.message.hashCode}'),
      tween: Tween(begin: isLatest ? 0 : 1, end: 1),
      duration: DexTokens.durMed,
      curve: Curves.easeOut,
      builder: (context, v, child) => Opacity(
        opacity: v,
        child: Transform.translate(offset: Offset(0, (1 - v) * 4), child: child),
      ),
      child: Padding(
        padding: const EdgeInsets.only(bottom: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 3),
              child: Icon(
                DexTokens.eventGlyph(event.type),
                size: 13,
                color: color,
              ),
            ),
            const SizedBox(width: DexTokens.spaceXs),
            SizedBox(
              width: 76,
              child: Text(
                event.type,
                overflow: TextOverflow.ellipsis,
                style: DexType.codeSm(color: color, strong: true),
              ),
            ),
            const SizedBox(width: DexTokens.spaceSm),
            Expanded(
              child: SelectableText(
                event.message,
                style: DexType.code(
                  color: event.type == 'failed' ? color : t.text,
                ),
              ),
            ),
            if (event.stepId != null) ...[
              const SizedBox(width: DexTokens.spaceSm),
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  event.stepId!,
                  style: DexType.codeSm(color: t.textFaint),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
