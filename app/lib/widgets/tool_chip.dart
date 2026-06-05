// Tool chip -- a Gemini-style inline announcement of "Claude picked tool X".
// Rendered in the conversation flow immediately before the agent's prose
// stream so the reader sees the routing decision live.
//
// Styling pulls entirely from theme tokens (tokens.dart) and respects
// MediaQuery.disableAnimations. No BackdropFilter -- that budget is spent
// elsewhere (command bar, approval sheet).

import 'package:flutter/material.dart';

import '../core/models/engine.dart';
import '../core/models/message.dart';
import '../core/tool_registry.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';

class ToolChip extends StatelessWidget {
  const ToolChip({super.key, required this.message});
  final Message message;

  @override
  Widget build(BuildContext context) {
    final desc = descriptorFor(message.toolId ?? 'unknown');
    final state = message.chipState ?? ToolChipState.running;
    final (color, label) = _styleFor(state);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DexSpace.xs),
      child: AnimatedContainer(
        duration: DexMotion.respecting(context, DexMotion.medium),
        curve: DexMotion.respectingCurve(context, DexMotion.easeOut),
        decoration: BoxDecoration(
          color: DexColors.surface,
          borderRadius: DexRadius.rsm,
          border: Border.all(color: color.withValues(alpha: 0.5)),
        ),
        padding: const EdgeInsets.symmetric(
          horizontal: DexSpace.md, vertical: 6,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(desc.icon, size: 14, color: color),
            const SizedBox(width: DexSpace.sm),
            Text(
              desc.friendlyName,
              style: DexType.label(color: color),
              semanticsLabel: 'tool: ${desc.friendlyName} -- $label',
            ),
            const SizedBox(width: DexSpace.sm),
            Text(
              String.fromCharCode(0x00B7), // middle dot
              style: DexType.label(color: DexColors.textFaint),
            ),
            const SizedBox(width: DexSpace.sm),
            Flexible(
              child: Text(
                message.toolGoal ?? '',
                style: DexType.mono(color: DexColors.textDim),
                overflow: TextOverflow.ellipsis,
                maxLines: 1,
              ),
            ),
            if (message.engine != null) ...[
              const SizedBox(width: DexSpace.sm),
              EnginePill(engine: message.engine!),
            ],
            const SizedBox(width: DexSpace.sm),
            _StateGlyph(state: state, color: color),
          ],
        ),
      ),
    );
  }

  (Color, String) _styleFor(ToolChipState s) {
    switch (s) {
      case ToolChipState.running:
        return (DexColors.stateActing, 'running');
      case ToolChipState.done:
        return (DexColors.textDim, 'done');
      case ToolChipState.failed:
        return (DexColors.stateError, 'failed');
      case ToolChipState.denied:
        return (DexColors.stateAwaiting, 'denied');
    }
  }
}

class _StateGlyph extends StatelessWidget {
  const _StateGlyph({required this.state, required this.color});
  final ToolChipState state;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final glyph = switch (state) {
      ToolChipState.running => '...',
      ToolChipState.done    => 'OK',
      ToolChipState.failed  => 'X',
      ToolChipState.denied  => '-',
    };
    return Text(glyph, style: DexType.mono(color: color));
  }
}

/// Compact pill that displays the orchestrator engine routing this call.
/// Reused by the inline tool chip and the Live panel's running-engine card.
class EnginePill extends StatelessWidget {
  const EnginePill({super.key, required this.engine, this.dense = true});
  final EngineId engine;
  /// When false, renders a larger version with both icon + label visible
  /// — used in the Live panel where horizontal space is generous.
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final desc = descriptorForEngine(engine);
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: dense ? 6 : DexSpace.sm,
        vertical: dense ? 2 : 4,
      ),
      decoration: BoxDecoration(
        color: desc.color.withValues(alpha: 0.12),
        borderRadius: DexRadius.rsm,
        border: Border.all(color: desc.color.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(desc.icon, size: dense ? 10 : 14, color: desc.color),
          const SizedBox(width: 4),
          Text(
            desc.label,
            style: DexType.mono(color: desc.color),
            semanticsLabel: 'engine: ${desc.label}',
          ),
        ],
      ),
    );
  }
}
