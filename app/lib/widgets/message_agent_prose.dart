// Agent prose -- sans, full width, no bubble.

import 'package:flutter/material.dart';

import '../core/models/message.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';

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
          AnimatedSwitcher(
            duration: DexMotion.respecting(context, DexMotion.fast),
            child: Text(
              (message.text ?? '').isEmpty && message.streaming
                  ? '...'
                  : (message.text ?? ''),
              key: ValueKey<int>((message.text ?? '').length),
              style: DexType.body(color: DexColors.text),
            ),
          ),
        ],
      ),
    );
  }
}
