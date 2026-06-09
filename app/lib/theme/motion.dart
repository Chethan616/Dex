// Motion budget from design.md section 8. Sparse, meaningful, respects
// prefers-reduced-motion. All animations in the app should pull their
// duration and curve from this file.

import 'package:flutter/widgets.dart';

class DexMotion {
  const DexMotion._();

  // Standard durations.
  static const Duration fast = Duration(milliseconds: 120);   // new message / step
  static const Duration medium = Duration(milliseconds: 160); // state cross-fade on status pill
  static const Duration slow = Duration(milliseconds: 220);   // approval sheet rise (mobile)
  static const Duration breathing = Duration(milliseconds: 1200); // thinking pulse

  // Expressive / Apple-leaning durations for hover, press, entry. Longer
  // than the base ladder so the easing has room to read.
  static const Duration hover = Duration(milliseconds: 180);
  static const Duration press = Duration(milliseconds: 110);
  static const Duration entry = Duration(milliseconds: 420);

  // Standard curves.
  static const Curve easeOut = Curves.easeOutCubic;
  static const Curve easeInOut = Curves.easeInOutCubic;

  // Expressive curves -- light spring on press/hover, soft overshoot on
  // entry. Used by SuggestionChip, NavRail rows, FadeInUp.
  static const Curve spring = Curves.easeOutBack;
  static const Curve gentle = Curves.fastOutSlowIn;
  static const Curve expressiveEntry = Curves.easeOutCubic;

  // Stagger between successive action steps + home-section entries.
  static const Duration stepStagger = Duration(milliseconds: 40);
  static const Duration entryStagger = Duration(milliseconds: 70);

  /// Returns [d] if motion is allowed by the platform, or Duration.zero if
  /// the user has requested reduced motion. Use this everywhere a tween or
  /// AnimatedSwitcher runs.
  static Duration respecting(BuildContext context, Duration d) {
    final reduce = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    return reduce ? Duration.zero : d;
  }

  /// Same idea for curves -- a reduced-motion curve collapses to linear so
  /// any tween snaps without bounce.
  static Curve respectingCurve(BuildContext context, Curve c) {
    final reduce = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    return reduce ? Curves.linear : c;
  }
}
