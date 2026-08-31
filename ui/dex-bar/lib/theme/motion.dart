import 'package:flutter/material.dart';
import 'package:motor/motor.dart';

/// How Dex moves.
///
/// Three springs, and one rule: **bounce on arrival, never on dismissal.**
///
/// Overshoot reads as eagerness when something appears and as indecision when
/// something leaves — a card that wobbles on its way out looks like the app
/// changed its mind. The same asymmetry is why buttons use [response] and not
/// [arrival]: a control that springs past its target when pressed reads as lag,
/// not as personality, because the eye is watching for the acknowledgement and
/// the overshoot delays it.
///
/// Springs rather than curves because a spring can be interrupted. Cards in the
/// step stream arrive while earlier ones are still settling; a duration-based
/// curve restarted mid-flight jumps, where a spring picks up the current
/// velocity and carries on.
class DexMotion {
  const DexMotion._();

  /// Things appearing: cards, splash rows, screens, menus.
  ///
  /// Material 3 Expressive's spatial spring — a real overshoot, tuned by people
  /// who measured it, rather than a bounce number picked because it looked fun
  /// in isolation.
  static const Motion arrival =
      MaterialSpringMotion.expressiveSpatialDefault();

  /// The same, hurried — for small things and for lists where several arrive
  /// at once and a slow settle would read as sluggishness.
  static const Motion arrivalFast = MaterialSpringMotion.expressiveSpatialFast();

  /// Controls responding: buttons, toggles, chips, focus rings.
  ///
  /// No overshoot. This is the acknowledgement of a press and it must land the
  /// instant the finger does.
  static const Motion response =
      MaterialSpringMotion.standardEffectsFast();

  /// Things leaving. Flat and quick — see the rule above.
  static const Motion exit = Motion.curved(
    Duration(milliseconds: 140),
    Curves.easeInCubic,
  );

  /// Layout settling: window growth, panel resize, rail expansion.
  ///
  /// Spatial but restrained. Large areas overshooting is nausea, not delight;
  /// the bigger the moving thing, the less it should bounce.
  static const Motion layout =
      MaterialSpringMotion.standardSpatialDefault();

  /// What all of the above collapse to when the owner has asked the OS for
  /// reduced motion.
  ///
  /// Not zero. An instant swap loses the causal link between the click and the
  /// change, which is the one thing the animation was carrying. A short fade
  /// keeps that and removes the movement.
  static const Motion reduced = Motion.curved(
    Duration(milliseconds: 90),
    Curves.linear,
  );

  /// Resolve a motion against the viewer's accessibility settings.
  ///
  /// Every animation in Dex goes through here. A bouncy interface that ignores
  /// `disableAnimations` is not playful to the person who turned it on — it is
  /// just an app that will not stop moving.
  static Motion of(BuildContext context, Motion motion) =>
      MediaQuery.maybeDisableAnimationsOf(context) ?? false ? reduced : motion;

  /// Legacy duration tokens, for the handful of places still using
  /// AnimatedContainer and friends.
  static const Duration fast = Duration(milliseconds: 120);
  static const Duration medium = Duration(milliseconds: 220);
  static const Duration slow = Duration(milliseconds: 380);

  static Duration durationOf(BuildContext context, Duration duration) =>
      MediaQuery.maybeDisableAnimationsOf(context) ?? false
          ? const Duration(milliseconds: 90)
          : duration;
}

/// Fade and rise into place.
///
/// The house entrance animation: used by the splash rows, the step stream, the
/// settings cards and the navigation destinations, so that arriving looks the
/// same everywhere in the app. [delay] staggers a list — small, because a
/// stagger long enough to notice consciously is a stagger that has become a
/// wait.
class DexEntrance extends StatefulWidget {
  const DexEntrance({
    super.key,
    required this.child,
    this.delay = Duration.zero,
    this.offset = 12,
  });

  final Widget child;
  final Duration delay;

  /// How far below its resting place the child begins, in logical pixels.
  final double offset;

  @override
  State<DexEntrance> createState() => _DexEntranceState();
}

class _DexEntranceState extends State<DexEntrance> {
  bool _in = false;

  @override
  void initState() {
    super.initState();
    if (widget.delay == Duration.zero) {
      // Still a frame later: setting it synchronously means the first build
      // already has the final value and nothing animates.
      WidgetsBinding.instance.addPostFrameCallback((_) => _enter());
    } else {
      Future<void>.delayed(widget.delay, _enter);
    }
  }

  void _enter() {
    if (mounted) setState(() => _in = true);
  }

  @override
  Widget build(BuildContext context) {
    final motion = DexMotion.of(context, DexMotion.arrival);
    return SingleMotionBuilder(
      value: _in ? 1 : 0,
      motion: motion,
      builder: (context, t, child) => Opacity(
        // The spring overshoots past 1; opacity would throw.
        opacity: t.clamp(0.0, 1.0),
        child: Transform.translate(
          offset: Offset(0, (1 - t) * widget.offset),
          child: child,
        ),
      ),
      child: widget.child,
    );
  }
}

/// Grows very slightly while pressed, and springs back on release.
///
/// Uses [DexMotion.response], so it does not overshoot: the point is to
/// acknowledge the press, and a control that keeps moving after the finger
/// lifts reads as unresponsive rather than lively.
class DexPressable extends StatefulWidget {
  const DexPressable({
    super.key,
    required this.child,
    this.pressedScale = 0.96,
    this.enabled = true,
  });

  final Widget child;
  final double pressedScale;
  final bool enabled;

  @override
  State<DexPressable> createState() => _DexPressableState();
}

class _DexPressableState extends State<DexPressable> {
  bool _down = false;

  void _set(bool value) {
    if (!widget.enabled || value == _down) return;
    setState(() => _down = value);
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      onPointerDown: (_) => _set(true),
      onPointerUp: (_) => _set(false),
      onPointerCancel: (_) => _set(false),
      child: SingleMotionBuilder(
        value: _down ? widget.pressedScale : 1.0,
        motion: DexMotion.of(context, DexMotion.response),
        builder: (context, scale, child) =>
            Transform.scale(scale: scale, child: child),
        child: widget.child,
      ),
    );
  }
}
