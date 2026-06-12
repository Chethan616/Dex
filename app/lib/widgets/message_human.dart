// Human message -- right-aligned rounded bubble. The bubble carries the
// speaker signal; we drop the "you" caption to match the cleaner chat
// surface introduced with the redesign.

import 'package:flutter/material.dart';

import '../core/models/message.dart';
import '../theme/tokens.dart';

class MessageHuman extends StatelessWidget {
  const MessageHuman({super.key, required this.message});
  final Message message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DexSpace.sm),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: DexSpace.lg, vertical: DexSpace.md,
              ),
              decoration: BoxDecoration(
                color: DexColors.surface2,
                borderRadius: const BorderRadius.only(
                  topLeft: DexRadius.xl,
                  topRight: DexRadius.xl,
                  bottomLeft: DexRadius.xl,
                  bottomRight: DexRadius.sm,
                ),
                border: Border.all(color: DexColors.border),
              ),
              child: Text(
                message.text ?? '',
                style: DexType.body(color: DexColors.text),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
