import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Every colour Dex renders, and the contrast ratio it was chosen for.
///
/// The ratios in the comments are not decoration — `test/theme_test.dart`
/// recomputes them and fails the build if any token drops below 4.5:1 against a
/// surface it can actually land on. That test exists because the previous light
/// palette shipped `textFaint` at **2.6:1**, used on 10px labels, and nothing
/// caught it: it was picked by eye, and by eye it looked fine.
///
/// State colours are held in a deliberately narrow contrast band (dark
/// 7.6–8.3, light 5.4–7.2) so the step stream reads as one texture. The old
/// palette spanned 7.6–10.9, which is why amber steps shouted and blue ones
/// receded when they carry exactly the same weight of meaning.
@immutable
class DexPalette {
  const DexPalette({
    required this.bg,
    required this.surface,
    required this.surfaceRaised,
    required this.border,
    required this.borderStrong,
    required this.text,
    required this.textMuted,
    required this.textFaint,
    required this.accent,
    required this.accentMuted,
    required this.neutral,
    required this.info,
    required this.warn,
    required this.attention,
    required this.positive,
    required this.negative,
    required this.shadow,
    required this.focusRing,
  });

  final Color bg;
  final Color surface;
  final Color surfaceRaised;
  final Color border;
  final Color borderStrong;

  final Color text;
  final Color textMuted;
  final Color textFaint;

  final Color accent;
  final Color accentMuted;

  /// The six semantic tones. Every event type and every confirmation tier
  /// resolves to one of these — there are no other colours in the app.
  final Color neutral;
  final Color info;
  final Color warn;
  final Color attention;
  final Color positive;
  final Color negative;

  final Color shadow;
  final Color focusRing;

  /// Surfaces text can be drawn on, for the contrast test to sweep.
  List<Color> get surfaces => [bg, surface, surfaceRaised];

  /// Tokens that render as text, for the same sweep.
  Map<String, Color> get foregrounds => {
        'text': text,
        'textMuted': textMuted,
        'textFaint': textFaint,
        'accent': accent,
        'neutral': neutral,
        'info': info,
        'warn': warn,
        'attention': attention,
        'positive': positive,
        'negative': negative,
      };

  static const dark = DexPalette(
    bg: Color(0xFF0A0A0B),
    surface: Color(0xFF121214),
    surfaceRaised: Color(0xFF1A1A1E),
    border: Color(0xFF26262C),
    borderStrong: Color(0xFF3A3A43),
    text: Color(0xFFEDEDEF),          // 14.8:1
    textMuted: Color(0xFF9A9AA4),     //  6.2:1
    textFaint: Color(0xFF8A8A94),     //  5.1:1  (was 5A5A63 — 2.9:1)
    accent: Color(0xFF8CA4FF),        //  7.3:1
    accentMuted: Color(0xFF232B4C),
    neutral: Color(0xFF9A9AA4),       //  6.2:1  narration, deliberately dimmer
    info: Color(0xFF8AACF9),          //  7.7:1
    warn: Color(0xFFDCA85E),          //  8.1:1
    attention: Color(0xFFC79BEE),     //  7.7:1
    positive: Color(0xFF4FC98C),      //  8.3:1
    negative: Color(0xFFFF8A80),      //  7.6:1
    shadow: Color(0x99000000),
    focusRing: Color(0xFF8CA4FF),
  );

  static const light = DexPalette(
    bg: Color(0xFFFBFBFC),
    surface: Color(0xFFFFFFFF),
    surfaceRaised: Color(0xFFF4F4F6),
    border: Color(0xFFE1E1E6),
    borderStrong: Color(0xFFC4C4CE),
    text: Color(0xFF121215),          // 17.0:1
    textMuted: Color(0xFF55555F),     //  6.7:1
    textFaint: Color(0xFF6B6B76),     //  4.8:1  (was 95959F — 2.6:1)
    accent: Color(0xFF3B5BDB),        //  5.2:1
    accentMuted: Color(0xFFDDE3FB),
    neutral: Color(0xFF55555F),       //  6.7:1
    info: Color(0xFF2F53C4),          //  6.1:1
    warn: Color(0xFF8A5A00),          //  5.4:1
    attention: Color(0xFF7A3EB4),     //  6.0:1
    positive: Color(0xFF10704A),      //  5.6:1
    negative: Color(0xFFB3271C),      //  5.9:1
    shadow: Color(0x22000000),
    focusRing: Color(0xFF3B5BDB),
  );

  DexPalette lerpTo(DexPalette other, double t) => DexPalette(
        bg: Color.lerp(bg, other.bg, t)!,
        surface: Color.lerp(surface, other.surface, t)!,
        surfaceRaised: Color.lerp(surfaceRaised, other.surfaceRaised, t)!,
        border: Color.lerp(border, other.border, t)!,
        borderStrong: Color.lerp(borderStrong, other.borderStrong, t)!,
        text: Color.lerp(text, other.text, t)!,
        textMuted: Color.lerp(textMuted, other.textMuted, t)!,
        textFaint: Color.lerp(textFaint, other.textFaint, t)!,
        accent: Color.lerp(accent, other.accent, t)!,
        accentMuted: Color.lerp(accentMuted, other.accentMuted, t)!,
        neutral: Color.lerp(neutral, other.neutral, t)!,
        info: Color.lerp(info, other.info, t)!,
        warn: Color.lerp(warn, other.warn, t)!,
        attention: Color.lerp(attention, other.attention, t)!,
        positive: Color.lerp(positive, other.positive, t)!,
        negative: Color.lerp(negative, other.negative, t)!,
        shadow: Color.lerp(shadow, other.shadow, t)!,
        focusRing: Color.lerp(focusRing, other.focusRing, t)!,
      );
}

/// Relative luminance contrast, WCAG 2.1. Lives here rather than in the test so
/// the ratios documented above and the ratios asserted are produced by the same
/// code — a comment that can drift from its check is worth nothing.
double contrastRatio(Color a, Color b) {
  final la = _luminance(a);
  final lb = _luminance(b);
  final hi = la > lb ? la : lb;
  final lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

double _luminance(Color c) =>
    0.2126 * _channel(c.r) + 0.7152 * _channel(c.g) + 0.0722 * _channel(c.b);

/// [v] is already 0..1 — Flutter's Color components are doubles.
double _channel(double v) =>
    v <= 0.04045 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
