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
/// State colours are held in a deliberately narrow contrast band — dark all
/// within 0.04 of 7.9:1, light within 0.05 of 6.0:1 — so the step stream reads
/// as one texture. An earlier palette spanned 7.6–10.9, which is why amber
/// steps shouted and blue ones receded when they carry exactly the same weight
/// of meaning.
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

  /// Playful, and measured.
  ///
  /// The surfaces carry a violet cast rather than being neutral grey — the
  /// cheapest way to stop a dark UI reading as a terminal. The five state tones
  /// are sky, amber, magenta, mint and coral: saturated enough to feel like
  /// they are enjoying themselves, and all placed within 0.04 of 7.9:1 on
  /// surfaceRaised so no one of them shouts louder than the rest.
  ///
  /// None of these were picked by eye. Each hue was chosen for character, then
  /// its lightness solved for the target ratio, then checked against all three
  /// surfaces. Picking by eye is how the old light palette shipped textFaint at
  /// 2.6:1 and nobody noticed.
  static const dark = DexPalette(
    bg: Color(0xFF0B0A10),
    surface: Color(0xFF141220),
    surfaceRaised: Color(0xFF1D1A2B),
    border: Color(0xFF2C2840),
    borderStrong: Color(0xFF454063),
    text: Color(0xFFF1F0F6),          // 15.0:1
    textMuted: Color(0xFF9F99AF),     //  6.2:1
    textFaint: Color(0xFF8F8A9F),     //  5.1:1
    accent: Color(0xFFBA9EFC),        //  7.6:1  violet
    accentMuted: Color(0xFF2B2450),
    neutral: Color(0xFF9F99AF),       //  6.2:1  narration, deliberately dimmer
    info: Color(0xFF60B9F8),          //  7.9:1  sky
    warn: Color(0xFFECA220),          //  7.9:1  amber
    attention: Color(0xFFF58EDB),     //  7.9:1  magenta
    positive: Color(0xFF20C98B),      //  7.9:1  mint
    negative: Color(0xFFFC948B),      //  7.9:1  coral
    shadow: Color(0x99000000),
    focusRing: Color(0xFFBA9EFC),
  );

  /// The same hues, solved against surfaceRaised.
  ///
  /// surfaceRaised is the *darkest* of the three light surfaces, which makes it
  /// the binding constraint for dark text — not white, which is the intuitive
  /// guess and the wrong one. Tuning against white first produced a textFaint
  /// that cleared 4.9:1 on white and failed at 4.37:1 on the surface it is
  /// actually used on.
  static const light = DexPalette(
    bg: Color(0xFFFCFBFF),
    surface: Color(0xFFFFFFFF),
    surfaceRaised: Color(0xFFF3F0FB),
    border: Color(0xFFE6E1F3),
    borderStrong: Color(0xFFC7BFDD),
    text: Color(0xFF201930),          // 15.0:1
    textMuted: Color(0xFF5A526D),     //  6.5:1
    textFaint: Color(0xFF6C637F),     //  5.0:1
    accent: Color(0xFF7039EF),        //  5.3:1  violet
    accentMuted: Color(0xFFE6DDFD),
    neutral: Color(0xFF5A526D),       //  6.5:1
    info: Color(0xFF0C5F9A),          //  6.0:1
    warn: Color(0xFF864E00),          //  6.0:1
    attention: Color(0xFFA81884),     //  6.0:1
    positive: Color(0xFF026944),      //  6.0:1
    negative: Color(0xFFB22013),      //  6.0:1
    shadow: Color(0x22150033),
    focusRing: Color(0xFF7039EF),
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
