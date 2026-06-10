// LivingBackground — the wallpaper "breathes."
//
// Wraps the home shell in a Stack whose bottom layer is a
// continuously-animated radial gradient. The glow drifts slowly
// around its bottom-center anchor (~14s loop), and a separate
// keystroke pulse momentarily brightens the gradient when the user
// types. Together they give the app the same "calm but alive"
// quality Apple's lock-screen Materials and macOS Dynamic Wallpapers
// do.
//
// Performance: one AnimationController, one CustomPainter that draws
// the radial gradient straight onto a Rect. Cheap. The pulse rides
// on a second short-lived controller so a fast typist doesn't queue
// up a backlog of restarts.
//
// API:
//   LivingBackground(child: HomeBody())       // anywhere in the tree
//   LivingBackground.of(context)?.pulse()     // from any descendant
//                                              // (composer key listener,
//                                              // spotlight overlay, etc.)

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/tokens.dart';

class LivingBackground extends StatefulWidget {
  const LivingBackground({super.key, required this.child});
  final Widget child;

  /// Reach the nearest [LivingBackground] from any descendant. Returns
  /// null if the widget isn't above in the tree (e.g. in tests that
  /// don't mount the home shell). Callers use this to fire pulses on
  /// keystroke / submission events.
  static LivingBackgroundController? of(BuildContext context) {
    final inh = context
        .dependOnInheritedWidgetOfExactType<_LivingBackgroundScope>();
    return inh?.controller;
  }

  @override
  State<LivingBackground> createState() => _LivingBackgroundState();
}

class _LivingBackgroundState extends State<LivingBackground>
    with TickerProviderStateMixin {
  late final AnimationController _drift;
  late final AnimationController _pulse;
  late final LivingBackgroundController _controller;

  @override
  void initState() {
    super.initState();
    // ~14s loop -- slow enough that the eye reads it as ambient
    // rather than animated. Most users won't consciously notice the
    // drift, they'll just feel the room is alive.
    _drift = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 14),
    )..repeat();

    // Pulse rides on its own 600ms controller; pulse() restarts it
    // from zero, so rapid typing reads as a steady soft brightening
    // rather than queued flickers.
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );

    _controller = LivingBackgroundController._(
      onPulse: (intensity) {
        _pulse.value = intensity.clamp(0.0, 1.0);
        _pulse.animateTo(0.0,
            duration: const Duration(milliseconds: 600),
            curve: Curves.easeOutCubic);
      },
    );
  }

  @override
  void dispose() {
    _drift.dispose();
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return _LivingBackgroundScope(
      controller: _controller,
      child: Stack(
        fit: StackFit.expand,
        children: [
          // The animated fog itself. RepaintBoundary keeps the
          // animation from invalidating siblings on every tick.
          RepaintBoundary(
            child: AnimatedBuilder(
              animation: Listenable.merge(<Listenable>[_drift, _pulse]),
              builder: (_, _) {
                return CustomPaint(
                  painter: _FogPainter(
                    t: _drift.value,
                    pulse: _pulse.value,
                  ),
                );
              },
            ),
          ),
          widget.child,
        ],
      ),
    );
  }
}

class LivingBackgroundController {
  LivingBackgroundController._({required this.onPulse});
  final void Function(double intensity) onPulse;

  /// Briefly brightens the fog. Intensity is 0..1 (default 0.4 for a
  /// keystroke, 0.8 for a submission / state change).
  void pulse([double intensity = 0.4]) => onPulse(intensity);
}

class _LivingBackgroundScope extends InheritedWidget {
  const _LivingBackgroundScope({
    required this.controller,
    required super.child,
  });

  final LivingBackgroundController controller;

  @override
  bool updateShouldNotify(_LivingBackgroundScope old) =>
      controller != old.controller;
}

class _FogPainter extends CustomPainter {
  _FogPainter({required this.t, required this.pulse});

  /// 0..1 loop position from the drift controller.
  final double t;

  /// 0..1 pulse intensity, decays after each keystroke.
  final double pulse;

  @override
  void paint(Canvas canvas, Size size) {
    // Drift the gradient's centre in a small ellipse around the
    // base anchor (centre-bottom of screen, just past the edge).
    // 0.08 horizontal swing, 0.04 vertical -- enough motion to read
    // as alive when you stare at it, subtle enough you forget it's
    // moving when you don't.
    final theta = t * 2 * math.pi;
    final cx = math.sin(theta) * 0.08;
    final cy = 1.30 + math.cos(theta * 0.7) * 0.04;

    // Pulse boosts the inner color stop's alpha, so each keystroke
    // makes the sky-blue heart of the fog flare for ~600ms.
    final innerBoost = 0.15 * pulse;

    final gradient = RadialGradient(
      center: Alignment(cx, cy),
      radius: 1.5,
      colors: <Color>[
        Color.lerp(
          const Color(0xFF4F8CFF),
          const Color(0xFFA9C8FF),
          innerBoost.clamp(0.0, 1.0),
        )!,
        const Color(0xFF1F3580),
        const Color(0xFF0A1235),
        const Color(0xFF040A1A),
      ],
      stops: const <double>[0.0, 0.3, 0.65, 1.0],
    );

    final rect = Offset.zero & size;
    final paint = Paint()..shader = gradient.createShader(rect);
    canvas.drawRect(rect, paint);
  }

  @override
  bool shouldRepaint(_FogPainter old) =>
      old.t != t || old.pulse != pulse;
}

/// A const reference to the static bg fallback used when LivingBackground
/// isn't in the tree (tests, secondary windows). Mirrors the colours of
/// the animated fog at its base position so the visual identity stays
/// consistent. Exposed via the tokens module already as DexSurface.bgGradient.
const RadialGradient kStaticFog = DexSurface.bgGradient;
