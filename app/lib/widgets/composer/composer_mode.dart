// How hard Dex should think about the next request.
//
// This used to be five options that did nothing — its own comment said so:
// "Mode is currently a UI-only signal". Two of them, "Study and learn" and
// "Search", described OpenClaw features Dex does not have, so they could never
// be made real without inventing capabilities. An option that cannot work is
// worse than one that is absent: it is a promise the owner discovers is false.
//
// What is left maps onto the three Claude models the brain can actually run,
// and switching one takes effect on the very next request.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

enum ComposerMode { fast, smart, deeper }

extension ComposerModeX on ComposerMode {
  String get label => switch (this) {
        ComposerMode.fast => 'Fast',
        ComposerMode.smart => 'Smart',
        ComposerMode.deeper => 'Think deeper',
      };

  String get description => switch (this) {
        ComposerMode.fast => 'Haiku — enough for most automation',
        ComposerMode.smart => 'Sonnet — better on long, multi-step tasks',
        ComposerMode.deeper => 'Opus — for plans that keep coming out wrong',
      };

  /// The model this asks the brain to use. These are Claude Code aliases;
  /// with an API-key provider selected the mode is ignored, because Groq and
  /// Gemini have one model each and switching would mean nothing.
  String get model => switch (this) {
        ComposerMode.fast => 'haiku',
        ComposerMode.smart => 'sonnet',
        ComposerMode.deeper => 'opus',
      };

  IconData get icon => switch (this) {
        ComposerMode.fast => LucideIcons.zap,
        ComposerMode.smart => LucideIcons.sparkles,
        ComposerMode.deeper => LucideIcons.brain,
      };
}
