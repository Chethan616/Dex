// Composer reasoning-mode options. The Smart pill in DexComposer cycles
// through these via ModeMenu. Mode is currently a UI-only signal; future
// gateway frames will route the choice through to the brain.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

enum ComposerMode { fast, smart, deeper, study, search }

extension ComposerModeX on ComposerMode {
  String get label => switch (this) {
        ComposerMode.fast => 'Fast',
        ComposerMode.smart => 'Smart',
        ComposerMode.deeper => 'Think deeper',
        ComposerMode.study => 'Study and learn',
        ComposerMode.search => 'Search',
      };

  String get description => switch (this) {
        ComposerMode.fast => 'Instant replies — skips deep thinking',
        ComposerMode.smart => 'Thinks deeply or quickly based on the task',
        ComposerMode.deeper => 'Better for more complex topics',
        ComposerMode.study => 'Guided learning and quizzes',
        ComposerMode.search => 'Answers with enhanced references',
      };

  IconData get icon => switch (this) {
        ComposerMode.fast => LucideIcons.zap,
        ComposerMode.smart => LucideIcons.sparkles,
        ComposerMode.deeper => LucideIcons.brain,
        ComposerMode.study => LucideIcons.graduation_cap,
        ComposerMode.search => LucideIcons.globe,
      };
}
