// Agent prose -- sans, full width, no bubble.

import 'package:flutter/material.dart';

import '../core/models/message.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';

class _ThinkingDots extends StatefulWidget {
  const _ThinkingDots();
  @override
  State<_ThinkingDots> createState() => _ThinkingDotsState();
}

class _ThinkingDotsState extends State<_ThinkingDots>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c;
  @override
  void initState() {
    super.initState();
    _c = AnimationController(vsync: this, duration: DexMotion.breathing)
      ..repeat(reverse: true);
  }
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }
  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    return AnimatedBuilder(
      animation: _c,
      builder: (_, _) {
        final t = reduce ? 1.0 : 0.45 + 0.55 * _c.value;
        return Row(
          children: [
            Opacity(
              opacity: t,
              child: Text('thinking', style: DexType.body(color: DexColors.textDim)),
            ),
            const SizedBox(width: 4),
            Opacity(
              opacity: t,
              child: Text('...', style: DexType.mono(color: DexColors.textDim)),
            ),
          ],
        );
      },
    );
  }
}

class MessageAgentProse extends StatelessWidget {
  const MessageAgentProse({super.key, required this.message});
  final Message message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DexSpace.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Dex', style: DexType.caption(color: DexColors.textFaint)),
          const SizedBox(height: 2),
          if ((message.text ?? '').isEmpty && message.streaming)
            const _ThinkingDots()
          else
            AnimatedSwitcher(
              duration: DexMotion.respecting(context, DexMotion.fast),
              child: Text(
                (message.text ?? ''),
                key: ValueKey<int>((message.text ?? '').length),
                style: DexType.body(color: DexColors.text),
              ),
            ),
        ],
      ),
    );
  }
}
