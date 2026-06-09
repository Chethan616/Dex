// Composer reasoning-mode options. The Smart pill in DexComposer cycles
// through these via ModeMenu. Mode is currently a UI-only signal; future
// gateway frames will route the choice through to the brain.

import 'package:flutter/material.dart';

enum ComposerMode { smart, deeper, study, search }

extension ComposerModeX on ComposerMode {
  String get label => switch (this) {
        ComposerMode.smart => 'Smart',
        ComposerMode.deeper => 'Think deeper',
        ComposerMode.study => 'Study and learn',
        ComposerMode.search => 'Search',
      };

  String get description => switch (this) {
        ComposerMode.smart => 'Thinks deeply or quickly based on the task',
        ComposerMode.deeper => 'Better for more complex topics',
        ComposerMode.study => 'Guided learning and quizzes',
        ComposerMode.search => 'Answers with enhanced references',
      };

  IconData get icon => switch (this) {
        ComposerMode.smart => Icons.auto_awesome_rounded,
        ComposerMode.deeper => Icons.psychology_alt_rounded,
        ComposerMode.study => Icons.school_rounded,
        ComposerMode.search => Icons.travel_explore_rounded,
      };
}
