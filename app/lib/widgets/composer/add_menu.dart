// The + button menu on the composer. Lists attach/generate/research-style
// actions. v1 dispatches selections to a single callback; the wiring to
// real flows lands in follow-up PRs.
//
// Routes through GlossyMenu so the popup gets the same glassy gradient
// + edge highlight + spring entry as the composer it sits on.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../theme/tokens.dart';
import '../glossy_menu.dart';

enum ComposerAddAction {
  files,
  generateImage,
  deepResearch,
  podcast,
  quiz,
  screenshot,
  connectors,
}

extension ComposerAddActionX on ComposerAddAction {
  String get label => switch (this) {
        ComposerAddAction.files => 'Add images or files',
        ComposerAddAction.generateImage => 'Generate image',
        ComposerAddAction.deepResearch => 'Start deep research',
        ComposerAddAction.podcast => 'Create a podcast',
        ComposerAddAction.quiz => 'Take a quiz',
        ComposerAddAction.screenshot => 'Take screenshot',
        ComposerAddAction.connectors => 'Use connectors',
      };

  IconData get icon => switch (this) {
        ComposerAddAction.files => LucideIcons.paperclip,
        ComposerAddAction.generateImage => LucideIcons.image,
        ComposerAddAction.deepResearch => LucideIcons.globe,
        ComposerAddAction.podcast => LucideIcons.headphones,
        ComposerAddAction.quiz => LucideIcons.circle_question_mark,
        ComposerAddAction.screenshot => LucideIcons.crop,
        ComposerAddAction.connectors => LucideIcons.puzzle,
      };

  String? get badge => switch (this) {
        ComposerAddAction.deepResearch => '5 remaining',
        ComposerAddAction.podcast => '3 remaining',
        _ => null,
      };

  bool get hasSubmenu => this == ComposerAddAction.connectors;
}

class AddMenu {
  static Future<ComposerAddAction?> show({
    required BuildContext context,
    required Offset anchor,
  }) {
    return GlossyMenu.show<ComposerAddAction>(
      context: context,
      anchor: anchor,
      width: 280,
      entries: <GlossyMenuEntry<ComposerAddAction>>[
        for (final a in ComposerAddAction.values)
          GlossyMenuItem<ComposerAddAction>(
            value: a,
            child: _AddRow(action: a),
          ),
      ],
    );
  }
}

class _AddRow extends StatelessWidget {
  const _AddRow({required this.action});
  final ComposerAddAction action;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(action.icon, size: 16, color: DexColors.textDim),
        const SizedBox(width: DexSpace.md),
        Expanded(
          child: Text(action.label,
              style: DexType.label(color: DexColors.text)),
        ),
        if (action.badge != null) ...[
          const SizedBox(width: DexSpace.sm),
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: DexSpace.sm, vertical: 2,
            ),
            decoration: BoxDecoration(
              color: DexColors.accentQuiet,
              borderRadius: DexRadius.rpill,
            ),
            child: Text(action.badge!,
                style: DexType.caption(color: DexColors.accent)),
          ),
        ],
        if (action.hasSubmenu)
          const Icon(LucideIcons.chevron_right,
              size: 16, color: DexColors.textFaint),
      ],
    );
  }
}
