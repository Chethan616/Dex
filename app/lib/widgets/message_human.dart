// Human message -- right-aligned, no decorative bubble. Speaker separation
// comes from space + a small label, per design.md section 7.

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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text('you', style: DexType.caption(color: DexColors.textFaint)),
          const SizedBox(height: 2),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: Text(
              message.text ?? '',
              textAlign: TextAlign.right,
              style: DexType.body(color: DexColors.text),
            ),
          ),
        ],
      ),
    );
  }
}
