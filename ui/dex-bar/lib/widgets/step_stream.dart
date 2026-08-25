import 'package:flutter/material.dart';

import '../core/models.dart';
import '../theme/tokens.dart';

/// Monospace, colour-coded, auto-scrolling. This is the live thinking-steps view.
class StepStream extends StatefulWidget {
  const StepStream({super.key, required this.events, this.padding});

  final List<DexEvent> events;
  final EdgeInsets? padding;

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
    final prefix = event.stepId != null
        ? '${event.type}:${event.stepId}'
        : event.type;

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
        padding: const EdgeInsets.only(bottom: 3),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 148,
              padding: const EdgeInsets.only(top: 1, right: DexTokens.spaceSm),
              child: Text(
                prefix,
                textAlign: TextAlign.right,
                overflow: TextOverflow.ellipsis,
                style: DexType.mono(size: 11.5, color: color, weight: FontWeight.w500),
              ),
            ),
            Container(width: 1, height: 15, color: t.border),
            const SizedBox(width: DexTokens.spaceMd),
            Expanded(
              child: SelectableText(
                event.message,
                style: DexType.mono(
                  size: 12,
                  color: event.type == 'failed' ? color : t.text,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
