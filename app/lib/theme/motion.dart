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

  // Dialog presentation -- more deliberate than menu hover, so dampened
  // motion can decelerate smoothly without feeling rushed.
  static const Duration dialog = Duration(milliseconds: 260);

  // Standard curves.
  static const Curve easeOut = Curves.easeOutCubic;
  static const Curve easeInOut = Curves.easeInOutCubic;

  // Expressive curves -- light spring on press/hover, soft overshoot on
  // entry. Used by SuggestionChip, NavRail rows, FadeInUp.
  static const Curve spring = Curves.easeOutBack;
  static const Curve gentle = Curves.fastOutSlowIn;
  static const Curve expressiveEntry = Curves.easeOutCubic;

  // Dampened decelerate -- Material 3's "emphasized decelerate" cubic.
  // Smooth fast-start / soft-finish without any overshoot, the kind of
  // motion iOS sheets use. Right for dialogs and dropdowns where a
  // spring's overshoot would feel jittery rather than confident.
  static const Curve dampened = Cubic(0.22, 1.0, 0.36, 1.0);

  // Emphasized accelerate -- mirror curve for dismissals so they feel
  // quick to start and decisive on the way out.
  static const Curve emphasizedAccelerate = Cubic(0.3, 0.0, 0.8, 0.15);

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

  /// A beautiful, premium, buttery-smooth transition for dialogs.
  /// Combination of: FadeTransition + ScaleTransition (0.95 -> 1.0) + SlideTransition (vertical).
  static Widget buildDialogTransition(
      BuildContext context, Animation<double> animation, Widget child) {
    if (MediaQuery.of(context).disableAnimations) return child;
    final eased = CurvedAnimation(parent: animation, curve: dampened);
    return FadeTransition(
      opacity: eased,
      child: ScaleTransition(
        scale: Tween<double>(begin: 0.95, end: 1.0).animate(eased),
        child: SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(0.0, 0.04),
            end: Offset.zero,
          ).animate(eased),
          child: child,
        ),
      ),
    );
  }
}
