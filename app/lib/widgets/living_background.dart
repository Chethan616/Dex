// LivingBackground — the wallpaper "breathes."
//
// Wraps the home shell in a Stack whose bottom layer is a set of
// three independently-drifting radial fog blobs over a deep navy
// base — the same trick macOS lock-screen wallpapers use. Every
// periodic term completes an INTEGER number of cycles per master
// loop, so the 60s wrap is mathematically seamless (no snap), while
// distinct cycle counts + phases per blob keep the composite from
// ever reading as a loop.
//
// The fog also "breathes" on its own: each blob's brightness + size
// ride two superimposed sine swells (~8.6s and ~15s), phase-staggered
// per blob, so the glow wanders in and out the way clouds do instead
// of strobing in lockstep. A separate pulse controller momentarily
// brightens the blobs on message-send and while the agent is acting.
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
import 'menu_glass.dart';

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

  // Repaint throttle: the drift + pulse controllers tick at vsync (60fps),
  // but the fog is a 60s loop so 30fps is visually identical — and every
  // glass surface in the app re-composites its BackdropFilter whenever the
  // fog repaints, so halving the fog's frame rate roughly halves that
  // app-wide cost. The painter still reads the live controller values, so
  // motion stays smooth; we just paint half as often.
  final _FogRepaint _repaint = _FogRepaint();
  int _lastPaintMs = 0;

  // Repaint once when the last menu closes so the fog resumes crisply.
  void _onMenuCount() {
    if (mounted && kGlassMenuOpenCount.value == 0) _repaint.bump();
  }

  void _onTick() {
    // Freeze the fog entirely while a glass menu is open so its morph gets
    // the whole frame budget (the slow drift is imperceptible meanwhile).
    if (kGlassMenuOpenCount.value > 0) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    if (now - _lastPaintMs >= 32) {
      _lastPaintMs = now;
      _repaint.bump();
    }
  }

  @override
  void initState() {
    super.initState();
    // 60s master loop. Every sine in the painter completes integer
    // cycles per loop, so the wrap at t=1.0 -> 0.0 is seamless --
    // the old 22s loop used fractional cycle counts and visibly
    // snapped to a new position on every wrap.
    _drift = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 60),
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

    _drift.addListener(_onTick);
    _pulse.addListener(_onTick);
    kGlassMenuOpenCount.addListener(_onMenuCount);

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
    _drift.removeListener(_onTick);
    _pulse.removeListener(_onTick);
    kGlassMenuOpenCount.removeListener(_onMenuCount);
    _repaint.dispose();
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
              // Driven by the 30fps throttle, not the raw vsync controllers.
              animation: _repaint,
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

/// A tiny notifier the fog repaints listen to. Bumped by the state's frame
/// throttle (~30fps) rather than the raw 60fps controllers, so the fog —
/// and every glass BackdropFilter that samples it — re-composites half as
/// often with no visible change to the slow drift.
class _FogRepaint extends ChangeNotifier {
  void bump() => notifyListeners();
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

// Drift periods are integer cycles per 60s master loop -- seamless
// wrap -- with distinct counts + phases per blob so the trio never
// reads as one synchronized ellipse.
const List<_FogBlob> _kBlobs = <_FogBlob>[
  // Big, bright primary — anchored at bottom CENTER, slow 30s sway.
  _FogBlob(
    anchorX: 0.0, anchorY: 1.15,
    ampX: 0.30, ampY: 0.14,
    periodX: 2.0, periodY: 1.0,
    phase: 0.0,
    radius: 1.35,
    color: Color(0xFF4F8CFF),
    alpha: 0.55,
  ),
  // Mid-tone secondary — counter-drifts just right of centre.
  _FogBlob(
    anchorX: 0.35, anchorY: 1.25,
    ampX: 0.28, ampY: 0.18,
    periodX: 3.0, periodY: 2.0,
    phase: 2.1,
    radius: 1.15,
    color: Color(0xFF2E5BC4),
    alpha: 0.50,
  ),
  // Deep tertiary — balances from just left of centre, one majestic
  // 60s horizontal pass.
  _FogBlob(
    anchorX: -0.35, anchorY: 1.05,
    ampX: 0.26, ampY: 0.24,
    periodX: 1.0, periodY: 3.0,
    phase: 4.2,
    radius: 1.5,
    color: Color(0xFF1F3580),
    alpha: 0.60,
  ),
];

/// Breathing swell frequencies, in integer cycles per 60s loop so the
/// wrap stays seamless. 7 cycles ≈ 8.6s (a calm resting breath) plus a
/// slower 4-cycle ≈ 15s under-swell; the two superimposed drift in and
/// out of phase, so the breath wanders instead of ticking.
const double _kBreathCyclesA = 7.0;
const double _kBreathCyclesB = 4.0;

/// How much the breath swells brightness (fraction of base alpha).
/// Kept gentle -- size + brightness moving TOGETHER is what reads as
/// breathing; a big alpha swing alone reads as flicker.
const double _kBreathDepth = 0.12;

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
      // Continuous breathing, per blob: two superimposed sine swells
      // whose phases are staggered by the blob's own phase, so the
      // three glows inhale at slightly different moments -- clouds,
      // not a synchronized strobe. Range is 0..1 (0.5 ± 0.3 ± 0.2).
      final breath = 0.5 +
          0.30 * math.sin(theta * _kBreathCyclesA + blob.phase) +
          0.20 * math.sin(theta * _kBreathCyclesB + blob.phase * 1.7 + 0.9);

      // Sine drift on each axis with the blob's own frequency +
      // phase. Amplitudes are large (0.3-0.55 of a half-screen) so
      // motion reads as flow, not frame-stepping.
      final cx =
          blob.anchorX + math.sin(theta * blob.periodX + blob.phase) * blob.ampX;
      final cy =
          blob.anchorY + math.cos(theta * blob.periodY + blob.phase) * blob.ampY;

      // Pulse flares each blob's heart: brighter colour + a touch
      // more alpha while a message sends / the agent acts. The
      // baseline alpha rides the breath swell so the fog visibly
      // inhales/exhales even with no input at all.
      final flare = (pulse * 0.35).clamp(0.0, 1.0);
      final heart = Color.lerp(blob.color, const Color(0xFFA9C8FF), flare)!;
      final a = (blob.alpha *
              (1.0 - _kBreathDepth / 2 + _kBreathDepth * breath) *
              (1.0 + pulse * 0.30))
          .clamp(0.0, 1.0);

      final gradient = RadialGradient(
        center: Alignment(cx, cy),
        // The blob swells slightly on the inhale — size + brightness
        // moving together is what reads as "breathing".
        radius: blob.radius * (1.0 + 0.06 * breath),
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
