// The + button menu on the composer.
//
// It listed seven actions and its own comment said the wiring "lands in
// follow-up PRs". Four of them described a product Dex is not: Generate image,
// Start deep research, Create a podcast, Take a quiz — two of them wearing a
// "5 remaining" quota badge for a quota that does not exist. Selecting any of
// them showed a snackbar with the label of the thing that had not happened.
//
// What is left is what Dex can actually do with something you hand it:
//
//   Add images or files   attach them to the next request; the composer
//                         already reads drops and pastes into the same strip
//   Take screenshot       the browser agent's `screenshot` action
//   Use connectors        Settings -> Connectors, probed live
//
// Routes through GlossyMenu so the popup gets the same glassy gradient, edge
// highlight and spring entry as the composer it sits on.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../theme/tokens.dart';
import '../glossy_menu.dart';

enum ComposerAddAction {
  files,
  screenshot,
  connectors,
}

extension ComposerAddActionX on ComposerAddAction {
  String get label => switch (this) {
        ComposerAddAction.files => 'Add images or files',
        ComposerAddAction.screenshot => 'Take screenshot',
        ComposerAddAction.connectors => 'Use connectors and apps',
      };

  /// One line under the label saying what will happen. The old menu had none,
  /// which is part of how four impossible actions went unnoticed.
  String get hint => switch (this) {
        ComposerAddAction.files => 'Attach them to your next message',
        ComposerAddAction.screenshot => 'Capture the screen and attach it',
        ComposerAddAction.connectors => 'See what Dex can reach right now',
      };

  IconData get icon => switch (this) {
        ComposerAddAction.files => LucideIcons.paperclip,
        ComposerAddAction.screenshot => LucideIcons.crop,
        ComposerAddAction.connectors => LucideIcons.puzzle,
      };
}

class AddMenu {
  static Future<ComposerAddAction?> show({
    required BuildContext context,
    required Rect trigger,
  }) {
    return GlossyMenu.show<ComposerAddAction>(
      context: context,
      trigger: trigger,
      // Same as the mode pill -- drops up from the composer toolbar
      // by default, flips down if the chat is so short the menu
      // wouldn't fit above.
      prefer: MenuDropDirection.up,
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
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Icon(action.icon, size: 16, color: DexColors.textDim),
        ),
        const SizedBox(width: DexSpace.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(action.label, style: DexType.label(color: DexColors.text)),
              const SizedBox(height: 1),
              Text(action.hint,
                  style: DexType.caption(color: DexColors.textFaint)),
            ],
          ),
        ),
      ],
    );
  }
}
