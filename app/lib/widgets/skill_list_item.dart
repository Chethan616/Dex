// One skill in the left-rail "skills" list. Plain, scannable.

import 'package:flutter/material.dart';

import '../core/models/skill.dart';
import '../theme/tokens.dart';

class SkillListItem extends StatelessWidget {
  const SkillListItem({super.key, required this.skill});
  final Skill skill;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DexSpace.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            String.fromCharCode(0x2022),
            style: DexType.label(
              color: skill.enabled ? DexColors.text : DexColors.textFaint,
            ),
          ),
          const SizedBox(width: DexSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  skill.name,
                  style: DexType.label(
                    color: skill.enabled ? DexColors.text : DexColors.textFaint,
                  ),
                ),
                if (skill.description.isNotEmpty)
                  Text(
                    skill.description,
                    style: DexType.caption(color: DexColors.textDim),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
