import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:m3e_buttons/m3e_buttons.dart';

import '../core/supervisor/supervisor.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';

/// What Dex shows while it starts itself.
///
/// It narrates because there is genuinely something to narrate. Five processes
/// come up in a fixed order — daemon, app agent, vision, browser, core — and
/// each row here turns green when that service answers a probe, not when a
/// timer expires. Nothing on this screen is decorative progress.
///
/// On a warm start, where everything is already running, the probes answer
/// immediately and the whole thing is over in well under a second. A splash
/// that performs a six-second show it did not need is worse than no splash.
class SplashScreen extends StatefulWidget {
  const SplashScreen({
    super.key,
    required this.supervisor,
    required this.onEnter,
  });

  final Supervisor supervisor;
  final VoidCallback onEnter;

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _drift;
  bool _entered = false;

  @override
  void initState() {
    super.initState();
    _drift = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 14),
    )..repeat();

    widget.supervisor.addListener(_onProgress);
    unawaited(widget.supervisor.boot());
  }

  void _onProgress() {
    if (!mounted || _entered) return;
    setState(() {});
    if (!widget.supervisor.booting && widget.supervisor.ready) {
      // A beat so the last row is visibly green before the screen changes —
      // otherwise the work Dex just did is invisible on a warm start.
      Timer(const Duration(milliseconds: 550), _enter);
    }
  }

  void _enter() {
    if (_entered || !mounted) return;
    _entered = true;
    widget.onEnter();
  }

  @override
  void dispose() {
    widget.supervisor.removeListener(_onProgress);
    _drift.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final supervisor = widget.supervisor;
    final failed = supervisor.steps.any((s) => s.status == BootStatus.failed);
    final settled = !supervisor.booting;

    return Container(
      decoration: BoxDecoration(
        color: t.bg,
        borderRadius: BorderRadius.circular(DexTokens.radiusLg),
        border: Border.all(color: t.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          Positioned.fill(
            child: AnimatedBuilder(
              animation: _drift,
              builder: (context, _) => CustomPaint(
                painter: _AuroraPainter(_drift.value, t.palette),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(34, 40, 34, 28),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _Wordmark(),
                const SizedBox(height: 6),
                Text(
                  'Bringing everything up',
                  style: DexType.body(color: t.textMuted),
                ),
                const SizedBox(height: DexTokens.spaceXl),
                Expanded(
                  child: ListView.separated(
                    padding: EdgeInsets.zero,
                    itemCount: supervisor.steps.length,
                    separatorBuilder: (_, _) =>
                        const SizedBox(height: DexTokens.spaceMd),
                    itemBuilder: (context, i) => DexEntrance(
                      delay: Duration(milliseconds: 60 * i),
                      child: _StepRow(
                        step: supervisor.steps[i],
                        onRetry: () => supervisor.retry(supervisor.steps[i].id),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: DexTokens.spaceLg),
                _Footer(
                  settled: settled,
                  failed: failed,
                  ready: supervisor.ready,
                  onEnter: _enter,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Wordmark extends StatelessWidget {
  const _Wordmark();

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return ShaderMask(
      shaderCallback: (rect) => LinearGradient(
        colors: [t.accent, t.attention, t.info],
      ).createShader(rect),
      child: Text(
        'Dex',
        style: DexType.display(color: Colors.white, strong: true)
            .copyWith(fontSize: 44, letterSpacing: -1.5),
      ),
    );
  }
}

/// One boot step.
///
/// The elapsed time is shown because it is real and because it is the fastest
/// way to see which part of a slow start was slow. It is the only number here.
class _StepRow extends StatelessWidget {
  const _StepRow({required this.step, required this.onRetry});

  final BootStep step;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final tone = switch (step.status) {
      BootStatus.done => t.positive,
      BootStatus.failed => t.negative,
      BootStatus.skipped => t.textFaint,
      BootStatus.running => t.accent,
      BootStatus.pending => t.textFaint,
    };

    final label = switch (step.status) {
      BootStatus.running => step.runningLabel,
      BootStatus.done =>
        step.wasAlreadyUp ? 'Already running' : step.doneLabel,
      BootStatus.skipped => step.detail ?? 'Skipped',
      BootStatus.failed => step.detail ?? 'Could not start',
      BootStatus.pending => 'Waiting',
    };

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: _StatusGlyph(status: step.status, tone: tone),
        ),
        const SizedBox(width: DexTokens.spaceMd),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      step.title,
                      style: DexType.body(
                        color: step.status == BootStatus.pending
                            ? t.textFaint
                            : t.text,
                        strong: step.status == BootStatus.running,
                      ),
                    ),
                  ),
                  if (step.elapsed != null)
                    Text(
                      _brief(step.elapsed!),
                      style: DexType.code(color: t.textFaint),
                    ),
                ],
              ),
              const SizedBox(height: 1),
              AnimatedSwitcher(
                duration: DexMotion.durationOf(context, DexMotion.fast),
                child: Text(
                  label,
                  key: ValueKey(label),
                  style: DexType.caption(color: tone),
                ),
              ),
              if (step.status == BootStatus.failed) ...[
                const SizedBox(height: DexTokens.spaceSm),
                DexPressable(
                  child: M3ETextButton(
                    onPressed: onRetry,
                    child: const Text('Try again'),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  static String _brief(Duration d) => d.inMilliseconds < 1000
      ? '${d.inMilliseconds}ms'
      : '${(d.inMilliseconds / 1000).toStringAsFixed(1)}s';
}

/// The dot at the start of a row: a spinner while working, a mark when settled.
class _StatusGlyph extends StatefulWidget {
  const _StatusGlyph({required this.status, required this.tone});

  final BootStatus status;
  final Color tone;

  @override
  State<_StatusGlyph> createState() => _StatusGlyphState();
}

class _StatusGlyphState extends State<_StatusGlyph>
    with SingleTickerProviderStateMixin {
  late final AnimationController _spin = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat();

  @override
  void dispose() {
    _spin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.status == BootStatus.running) {
      return SizedBox(
        width: 16,
        height: 16,
        child: AnimatedBuilder(
          animation: _spin,
          builder: (context, _) => Transform.rotate(
            angle: _spin.value * 2 * math.pi,
            child: CustomPaint(painter: _ArcPainter(widget.tone)),
          ),
        ),
      );
    }

    final icon = switch (widget.status) {
      BootStatus.done => Icons.check_rounded,
      BootStatus.failed => Icons.priority_high_rounded,
      BootStatus.skipped => Icons.remove_rounded,
      _ => Icons.circle_outlined,
    };

    return SizedBox(
      width: 16,
      height: 16,
      child: DexEntrance(
        offset: 0,
        child: Icon(icon, size: 16, color: widget.tone),
      ),
    );
  }
}

class _ArcPainter extends CustomPainter {
  _ArcPainter(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round
      ..color = color;
    canvas.drawArc(
      Rect.fromLTWH(1, 1, size.width - 2, size.height - 2),
      0,
      math.pi * 1.4,
      false,
      paint,
    );
  }

  @override
  bool shouldRepaint(_ArcPainter old) => old.color != color;
}

class _Footer extends StatelessWidget {
  const _Footer({
    required this.settled,
    required this.failed,
    required this.ready,
    required this.onEnter,
  });

  final bool settled;
  final bool failed;
  final bool ready;
  final VoidCallback onEnter;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;

    if (!settled) {
      return Text(
        'This takes about a minute the first time.',
        style: DexType.caption(color: t.textFaint),
      );
    }

    return Row(
      children: [
        Expanded(
          child: Text(
            failed
                ? 'Dex will open anyway — what failed above will not work.'
                : ready
                    ? 'Everything is up.'
                    : 'Ready.',
            style: DexType.caption(color: failed ? t.warn : t.textMuted),
          ),
        ),
        const SizedBox(width: DexTokens.spaceMd),
        DexPressable(
          child: M3EFilledButton(
            onPressed: onEnter,
            child: Text(failed ? 'Open anyway' : 'Enter Dex'),
          ),
        ),
      ],
    );
  }
}

/// The drifting colour field behind the splash.
///
/// Three soft radial blooms in the accent hues, moving on slightly different
/// periods so the pattern does not visibly repeat. Painted rather than layered
/// as blurred widgets because a BackdropFilter over the whole window costs more
/// than this does, and this screen is on-screen exactly when the machine is
/// busiest starting five other processes.
class _AuroraPainter extends CustomPainter {
  _AuroraPainter(this.t, this.palette);

  final double t;
  final DexPalette palette;

  @override
  void paint(Canvas canvas, Size size) {
    final blooms = [
      (palette.accent, 0.0, 0.62),
      (palette.attention, 0.33, 0.5),
      (palette.info, 0.66, 0.56),
    ];

    for (final (color, phase, radius) in blooms) {
      final angle = (t + phase) * 2 * math.pi;
      final center = Offset(
        size.width * (0.5 + 0.34 * math.cos(angle)),
        size.height * (0.36 + 0.26 * math.sin(angle * 1.3)),
      );
      final r = size.width * radius;
      canvas.drawCircle(
        center,
        r,
        Paint()
          ..shader = RadialGradient(
            colors: [color.withValues(alpha: 0.20), color.withValues(alpha: 0)],
          ).createShader(Rect.fromCircle(center: center, radius: r)),
      );
    }
  }

  @override
  bool shouldRepaint(_AuroraPainter old) => old.t != t;
}
