// Calm sine-wave painter behind the voice mode "I'm listening" surface.
// Two overlapping waves drift slowly; reduced motion freezes them.

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../theme/tokens.dart';

class AnimatedWaveBackground extends StatefulWidget {
  const AnimatedWaveBackground({super.key});
  @override
  State<AnimatedWaveBackground> createState() => _AnimatedWaveBackgroundState();
}

class _AnimatedWaveBackgroundState extends State<AnimatedWaveBackground>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 8),
    )..repeat();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    return AnimatedBuilder(
      animation: _ctrl,
      builder: (_, _) => CustomPaint(
        size: Size.infinite,
        painter: _WavePainter(t: reduce ? 0 : _ctrl.value),
      ),
    );
  }
}

class _WavePainter extends CustomPainter {
  _WavePainter({required this.t});
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    final bg = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: <Color>[
          Color(0xFF0B0C0E),
          Color(0xFF14181F),
          Color(0xFF1C2330),
        ],
      ).createShader(Offset.zero & size);
    canvas.drawRect(Offset.zero & size, bg);

    _drawWave(canvas, size,
        amplitude: 24,
        frequency: 1.3,
        phase: t * 2 * math.pi,
        baseline: 0.52,
        color: DexColors.accent.withValues(alpha: 0.07));
    _drawWave(canvas, size,
        amplitude: 16,
        frequency: 2.1,
        phase: t * 2 * math.pi + math.pi / 2,
        baseline: 0.6,
        color: DexColors.accent.withValues(alpha: 0.05));
  }

  void _drawWave(
    Canvas canvas,
    Size size, {
    required double amplitude,
    required double frequency,
    required double phase,
    required double baseline,
    required Color color,
  }) {
    final path = Path()..moveTo(0, size.height);
    const segments = 80;
    for (var i = 0; i <= segments; i++) {
      final x = size.width * (i / segments);
      final y = size.height * baseline +
          amplitude * math.sin(frequency * (i / segments) * 2 * math.pi + phase);
      if (i == 0) {
        path.lineTo(0, y);
      } else {
        path.lineTo(x, y);
      }
    }
    path.lineTo(size.width, size.height);
    path.close();
    canvas.drawPath(path, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_WavePainter old) => old.t != t;
}
