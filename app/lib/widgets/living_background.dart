// LivingBackground — the wallpaper "breathes."
//
// Wraps the home shell in a Stack whose bottom layer is a set of
// three independently-drifting radial fog blobs over a deep navy
// base — the same trick macOS lock-screen wallpapers use. Each blob
// has its own anchor, drift amplitude, and incommensurate periods,
// so the composite pattern never visibly repeats and the eye reads
// continuous fluid motion rather than a looping ellipse.
//
// A separate pulse controller momentarily brightens the blobs on
// message-send and while the agent is acting (plus a softer
// keystroke pulse from the composer).
//
// Performance: one AnimationController for drift, one CustomPainter
// that draws three radial gradients onto the same Rect with additive
// blending. The pulse rides on a second short-lived controller so a
// fast typist doesn't queue up a backlog of restarts.
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
  const LivingBackground({
    super.key,
    required this.child,
    this.activity,
    this.isActive,
  });

  final Widget child;

  /// Optional external activity signal (e.g. the ConversationStore).
  /// When [isActive] flips false -> true on a notification, the fog
  /// fires a strong pulse -- so the wallpaper visibly "wakes up"
  /// whenever the agent starts acting.
  final Listenable? activity;
  final bool Function()? isActive;

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
  bool _wasActive = false;

  @override
  void initState() {
    super.initState();
    // ~22s master loop. Each blob multiplies this by its own
    // incommensurate factors, so the composite never visibly
    // repeats -- it just keeps flowing.
    _drift = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 22),
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

    _wasActive = widget.isActive?.call() ?? false;
    widget.activity?.addListener(_onActivity);
  }

  void _onActivity() {
    final active = widget.isActive?.call() ?? false;
    if (active && !_wasActive) {
      _controller.pulse(0.8);
    }
    _wasActive = active;
  }

  @override
  void didUpdateWidget(LivingBackground old) {
    super.didUpdateWidget(old);
    if (old.activity != widget.activity) {
      old.activity?.removeListener(_onActivity);
      widget.activity?.addListener(_onActivity);
      _wasActive = widget.isActive?.call() ?? false;
    }
  }

  @override
  void dispose() {
    widget.activity?.removeListener(_onActivity);
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

/// One drifting fog blob. Anchor is the rest position (Alignment
/// space, so 1.0 = screen edge), ampX/ampY the drift swing, and the
/// period multipliers + phase keep each blob on its own clock so the
/// three never sync up into a visible loop.
class _FogBlob {
  const _FogBlob({
    required this.anchorX,
    required this.anchorY,
    required this.ampX,
    required this.ampY,
    required this.periodX,
    required this.periodY,
    required this.phase,
    required this.radius,
    required this.color,
    required this.alpha,
  });

  final double anchorX;
  final double anchorY;
  final double ampX;
  final double ampY;
  final double periodX; // cycles per master loop (incommensurate)
  final double periodY;
  final double phase;
  final double radius; // in Alignment units (1.0 ≈ half the screen)
  final Color color;
  final double alpha; // base opacity of the blob's heart
}

const List<_FogBlob> _kBlobs = <_FogBlob>[
  // Big, bright primary — sweeps along the bottom edge.
  _FogBlob(
    anchorX: -0.35, anchorY: 1.15,
    ampX: 0.55, ampY: 0.18,
    periodX: 1.0, periodY: 0.63,
    phase: 0.0,
    radius: 1.35,
    color: Color(0xFF4F8CFF),
    alpha: 0.55,
  ),
  // Mid-tone secondary — counter-drifts from the right.
  _FogBlob(
    anchorX: 0.55, anchorY: 1.25,
    ampX: 0.42, ampY: 0.22,
    periodX: 0.71, periodY: 1.13,
    phase: 2.1,
    radius: 1.15,
    color: Color(0xFF2E5BC4),
    alpha: 0.50,
  ),
  // Deep tertiary — slow vertical breath near centre.
  _FogBlob(
    anchorX: 0.10, anchorY: 1.05,
    ampX: 0.30, ampY: 0.30,
    periodX: 0.47, periodY: 0.89,
    phase: 4.2,
    radius: 1.5,
    color: Color(0xFF1F3580),
    alpha: 0.60,
  ),
];

class _FogPainter extends CustomPainter {
  _FogPainter({required this.t, required this.pulse});

  /// 0..1 loop position from the drift controller.
  final double t;

  /// 0..1 pulse intensity, decays after each trigger.
  final double pulse;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;

    // Deep navy base — the night sky the fog lives on.
    canvas.drawRect(rect, Paint()..color = const Color(0xFF040A1A));

    final theta = t * 2 * math.pi;

    for (final blob in _kBlobs) {
      // Sine drift on each axis with the blob's own frequency +
      // phase. Amplitudes are large (0.3-0.55 of a half-screen) so
      // motion reads as flow, not frame-stepping.
      final cx =
          blob.anchorX + math.sin(theta * blob.periodX + blob.phase) * blob.ampX;
      final cy =
          blob.anchorY + math.cos(theta * blob.periodY + blob.phase) * blob.ampY;

      // Pulse flares each blob's heart: brighter colour + a touch
      // more alpha while a message sends / the agent acts.
      final flare = (pulse * 0.35).clamp(0.0, 1.0);
      final heart = Color.lerp(blob.color, const Color(0xFFA9C8FF), flare)!;
      final a = (blob.alpha * (1.0 + pulse * 0.30)).clamp(0.0, 1.0);

      final gradient = RadialGradient(
        center: Alignment(cx, cy),
        radius: blob.radius,
        colors: <Color>[
          heart.withValues(alpha: a),
          blob.color.withValues(alpha: a * 0.45),
          blob.color.withValues(alpha: 0.0),
        ],
        stops: const <double>[0.0, 0.45, 1.0],
      );

      // Additive blending so overlapping blobs brighten each other
      // the way real light does — this is what makes it feel fluid.
      final paint = Paint()
        ..shader = gradient.createShader(rect)
        ..blendMode = BlendMode.plus;
      canvas.drawRect(rect, paint);
    }
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
