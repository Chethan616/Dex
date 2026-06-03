// The persistent status pill -- dot + word answering "what is Dex doing?"
// at a glance. Lives in the conversation header. Cross-fades color in
// DexMotion.medium when the state changes (motion section of design.md).

import 'package:flutter/material.dart';

import '../core/models/agent_state.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';

class AgentStatusPill extends StatelessWidget {
  const AgentStatusPill({super.key, required this.state});

  final AgentState state;

  @override
  Widget build(BuildContext context) {
    final color = DexColors.forAgentState(state.token);
    return AnimatedContainer(
      duration: DexMotion.respecting(context, DexMotion.medium),
      curve: DexMotion.respectingCurve(context, DexMotion.easeOut),
      padding: const EdgeInsets.symmetric(
        horizontal: DexSpace.md, vertical: 6,
      ),
      decoration: BoxDecoration(
        color: DexColors.surface2,
        borderRadius: DexRadius.rsm,
        border: Border.all(color: DexColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _PulseDot(color: color, breathing: state == AgentState.thinking),
          const SizedBox(width: DexSpace.sm),
          Text(
            state.word,
            style: DexType.label(color: DexColors.textDim),
            semanticsLabel: 'agent state: ${state.word}',
          ),
        ],
      ),
    );
  }
}

class _PulseDot extends StatefulWidget {
  const _PulseDot({required this.color, required this.breathing});
  final Color color;
  final bool breathing;
  @override
  State<_PulseDot> createState() => _PulseDotState();
}

class _PulseDotState extends State<_PulseDot> with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;
  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: DexMotion.breathing,
    )..repeat(reverse: true);
  }
  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }
  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    return AnimatedBuilder(
      animation: _ctrl,
      builder: (_, _) {
        final opacity = (widget.breathing && !reduce)
            ? 0.5 + 0.5 * _ctrl.value
            : 1.0;
        return Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: widget.color.withValues(alpha: opacity),
            shape: BoxShape.circle,
          ),
        );
      },
    );
  }
}
