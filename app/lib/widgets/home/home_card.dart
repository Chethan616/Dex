// Shared "card" container used by the empty-home recent-files and
// recent-chats panels. Real liquid-glass surface (DexGlass), header row,
// slot for rows.

import 'package:flutter/material.dart';

import '../../theme/tokens.dart';
import '../dex_glass.dart';

class HomeCard extends StatelessWidget {
  const HomeCard({
    super.key,
    required this.icon,
    required this.title,
    this.trailing,
    required this.child,
  });

  final IconData icon;
  final String title;
  final Widget? trailing;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DexGlass(
      radius: 14,
      padding: const EdgeInsets.all(DexSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Icon(icon, size: 14, color: DexColors.textDim),
              const SizedBox(width: DexSpace.sm),
              Expanded(
                child: Text(title,
                    style: DexType.label(color: DexColors.text)),
              ),
              if (trailing != null) trailing!,
            ],
          ),
          const SizedBox(height: DexSpace.sm),
          child,
        ],
      ),
    );
  }
}
