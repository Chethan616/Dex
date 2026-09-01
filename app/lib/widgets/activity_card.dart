// v1.2 Live Tool Activity card.
//
// Rendered in the Live panel for every tool call the gateway dispatches.
// Pulled straight from raw toolCall / toolResult events so the LLM never
// has to narrate "I'm running PowerShell ..." -- the user reads the
// activity card and knows. Saves tokens AND surfaces what's actually
// happening during slow turns.

import 'dart:async';

import 'package:flutter/material.dart';

import '../core/models/tool_activity.dart';
import '../theme/tokens.dart';
import 'tool_chip.dart';

class ActivityCard extends StatefulWidget {
  const ActivityCard({super.key, required this.activity, this.compact = false});

  final ToolActivity activity;
  /// When true, render a single-line summary (used for completed activities
  /// in the Live panel below the active one). When false, render the full
  /// args + output block.
  final bool compact;

  @override
  State<ActivityCard> createState() => _ActivityCardState();
}

class _ActivityCardState extends State<ActivityCard> {
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    if (widget.activity.state == ToolActivityState.running) {
      _tick = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() {});
      });
    }
  }

  @override
  void didUpdateWidget(ActivityCard old) {
    super.didUpdateWidget(old);
    if (widget.activity.state == ToolActivityState.running && _tick == null) {
      _tick = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() {});
      });
    } else if (widget.activity.state != ToolActivityState.running) {
      _tick?.cancel();
      _tick = null;
    }
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.activity;
    final (badgeColor, badgeText) = _badge(a);
    final durationLabel = _formatDuration(a.duration);

    if (widget.compact) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            if (a.engine != null) EnginePill(engine: a.engine!),
            const SizedBox(width: DexSpace.sm),
            Text(a.toolId, style: DexType.mono(color: DexColors.textDim)),
            const SizedBox(width: DexSpace.sm),
            Expanded(
              child: Text(
                a.goalLabel ?? '',
                style: DexType.mono(color: DexColors.textFaint),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: DexSpace.sm),
            Text(durationLabel, style: DexType.caption(color: DexColors.textFaint)),
            const SizedBox(width: DexSpace.sm),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: badgeColor.withValues(alpha: 0.15),
                borderRadius: DexRadius.rsm,
              ),
              child: Text(badgeText, style: DexType.caption(color: badgeColor)),
            ),
          ],
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.only(bottom: DexSpace.md),
      padding: const EdgeInsets.all(DexSpace.lg),
      decoration: BoxDecoration(
        color: DexColors.surface,
        borderRadius: DexRadius.rmd,
        border: Border.all(
          color: a.state == ToolActivityState.running
              ? DexColors.accent.withValues(alpha: 0.5)
              : DexColors.border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row: engine pill · tool friendly name · state badge
          // (duration is folded into the badge text for running state; for
          // completed runs the badge shows just "done" and we surface
          // duration in the divider text below).
          Row(
            children: [
              if (a.engine != null) ...[
                EnginePill(engine: a.engine!),
                const SizedBox(width: 6),
              ],
              Expanded(
                child: Text(
                  a.displayName,
                  style: DexType.label(color: DexColors.text),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 4),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                decoration: BoxDecoration(
                  color: badgeColor.withValues(alpha: 0.15),
                  borderRadius: DexRadius.rsm,
                  border: Border.all(color: badgeColor.withValues(alpha: 0.4)),
                ),
                child: Text(
                  badgeText,
                  style: DexType.caption(color: badgeColor),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(durationLabel, style: DexType.caption(color: DexColors.textFaint)),
          ),
          const Divider(height: DexSpace.lg + 4),
          // Args block (mono, key/value pairs)
          Text(
            a.toolId,
            style: DexType.mono(color: DexColors.textDim),
          ),
          if (a.args != null) ..._argLines(a.args!),
          // Output / summary block
          if (a.summary != null && a.summary!.isNotEmpty) ...[
            const SizedBox(height: DexSpace.md),
            Text(
              a.summary!,
              style: DexType.body(color: DexColors.text),
            ),
          ],
          if (a.outputLines.isNotEmpty) ...[
            const SizedBox(height: DexSpace.sm),
            Container(
              padding: const EdgeInsets.all(DexSpace.sm),
              decoration: BoxDecoration(
                color: DexColors.surface2,
                borderRadius: DexRadius.rsm,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: a.outputLines
                    .map((line) => Padding(
                          padding: const EdgeInsets.symmetric(vertical: 1),
                          child: Text(
                            line,
                            style: DexType.mono(color: DexColors.textDim),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ))
                    .toList(growable: false),
              ),
            ),
          ],
          if (a.state == ToolActivityState.running && a.outputLines.isEmpty) ...[
            const SizedBox(height: DexSpace.sm),
            Text(
              '... waiting for output',
              style: DexType.mono(color: DexColors.textFaint),
            ),
          ],
        ],
      ),
    );
  }

  List<Widget> _argLines(Map<String, dynamic> args) {
    final keys = args.keys.toList(growable: false);
    // Prefer the most-useful keys at the top.
    const priority = [
      'goal', 'command', 'cmd', 'request', 'app_hint', 'url',
      'url_hint', 'path', 'file', 'query', 'text', 'message',
      'name', 'agent',
    ];
    keys.sort((a, b) {
      final ai = priority.indexOf(a);
      final bi = priority.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai.compareTo(bi);
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.compareTo(b);
    });
    return keys.take(6).map<Widget>((k) {
      final v = args[k];
      final value = v == null ? '' : v.toString();
      final clipped =
          value.length > 160 ? '${value.substring(0, 159)}…' : value;
      return Padding(
        padding: const EdgeInsets.only(left: DexSpace.md, top: 2),
        child: Text.rich(
          TextSpan(
            children: [
              TextSpan(text: '$k: ', style: DexType.mono(color: DexColors.textFaint)),
              TextSpan(text: clipped, style: DexType.mono(color: DexColors.textDim)),
            ],
          ),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
      );
    }).toList(growable: false);
  }

  (Color, String) _badge(ToolActivity a) {
    switch (a.state) {
      case ToolActivityState.running:
        return (DexColors.accent, 'running');
      case ToolActivityState.done:
        return (DexColors.stateApprove, 'done');
      case ToolActivityState.failed:
        return (DexColors.stateError, 'failed');
      case ToolActivityState.aborted:
        return (DexColors.stateAwaiting, 'aborted');
    }
  }

  String _formatDuration(Duration d) {
    if (d.inMinutes >= 1) return '${d.inMinutes}m ${d.inSeconds % 60}s';
    return '${d.inSeconds}s';
  }
}
