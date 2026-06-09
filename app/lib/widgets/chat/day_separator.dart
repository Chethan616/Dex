// Horizontal day separator inside the chat list (e.g. "Today" with a line).

import 'package:flutter/material.dart';

import '../../theme/tokens.dart';

class DaySeparator extends StatelessWidget {
  const DaySeparator({super.key, required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DexSpace.md),
      child: Row(
        children: [
          Text(label, style: DexType.caption(color: DexColors.textFaint)),
          const SizedBox(width: DexSpace.md),
          const Expanded(child: Divider(height: 1, color: DexColors.border)),
        ],
      ),
    );
  }
}
