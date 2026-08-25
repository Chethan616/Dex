import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Every colour, radius, duration and text style DEX uses. Nothing in the
/// widget tree hardcodes a colour — it all resolves through [DexTokens].
@immutable
class DexTokens extends ThemeExtension<DexTokens> {
  const DexTokens({
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
    required this.eventColors,
    required this.tierColors,
    required this.shadow,
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

  /// Event-type → prefix colour in the step stream.
  final Map<String, Color> eventColors;

  /// Confirmation tier → chip colour. Lower tier = higher risk = hotter colour.
  final Map<int, Color> tierColors;

  final Color shadow;

  Color eventColor(String type) => eventColors[type] ?? textMuted;
  Color tierColor(int tier) => tierColors[tier] ?? textMuted;

  static const radiusSm = 6.0;
  static const radiusMd = 10.0;
  static const radiusLg = 16.0;

  static const spaceXs = 4.0;
  static const spaceSm = 8.0;
  static const spaceMd = 12.0;
  static const spaceLg = 18.0;
  static const spaceXl = 26.0;

  static const durFast = Duration(milliseconds: 120);
  static const durMed = Duration(milliseconds: 220);
  static const durSlow = Duration(milliseconds: 380);

  static const barWidth = 760.0;
  static const barRestHeight = 92.0;
  static const barActiveHeight = 560.0;
  static const missionWidth = 1080.0;
  static const missionHeight = 780.0;

  static final DexTokens dark = DexTokens(
    bg: const Color(0xFF0A0A0B),
    surface: const Color(0xFF121214),
    surfaceRaised: const Color(0xFF1A1A1E),
    border: const Color(0xFF232328),
    borderStrong: const Color(0xFF33333A),
    text: const Color(0xFFEDEDEF),
    textMuted: const Color(0xFF8B8B94),
    textFaint: const Color(0xFF5A5A63),
    accent: const Color(0xFF6E8EFF),
    accentMuted: const Color(0xFF2A3358),
    shadow: const Color(0x99000000),
    eventColors: const {
      'thinking': Color(0xFF8B8B94),
      'routing': Color(0xFF8B8B94),
      'planning': Color(0xFF6ECBF5),
      'selecting': Color(0xFFF2C97D),
      'executing': Color(0xFF7AA2F7),
      'retrying': Color(0xFFFFAE6B),
      'awaiting': Color(0xFFC792EA),
      'cancelled': Color(0xFFB08CD6),
      'done': Color(0xFF5FD79A),
      'failed': Color(0xFFFF7B72),
    },
    tierColors: const {
      1: Color(0xFFFF7B72),
      2: Color(0xFFFFAE6B),
      3: Color(0xFFF2C97D),
      4: Color(0xFF5FD79A),
    },
  );

  static final DexTokens light = DexTokens(
    bg: const Color(0xFFFBFBFC),
    surface: const Color(0xFFFFFFFF),
    surfaceRaised: const Color(0xFFF4F4F6),
    border: const Color(0xFFE3E3E7),
    borderStrong: const Color(0xFFCFCFD6),
    text: const Color(0xFF121215),
    textMuted: const Color(0xFF63636D),
    textFaint: const Color(0xFF95959F),
    accent: const Color(0xFF3B5BDB),
    accentMuted: const Color(0xFFDDE3FB),
    shadow: const Color(0x22000000),
    eventColors: const {
      'thinking': Color(0xFF63636D),
      'routing': Color(0xFF63636D),
      'planning': Color(0xFF0B7285),
      'selecting': Color(0xFF9A6A00),
      'executing': Color(0xFF2F53C4),
      'retrying': Color(0xFFB35309),
      'awaiting': Color(0xFF7A3EAF),
      'cancelled': Color(0xFF7A3EAF),
      'done': Color(0xFF148452),
      'failed': Color(0xFFC33025),
    },
    tierColors: const {
      1: Color(0xFFC33025),
      2: Color(0xFFB35309),
      3: Color(0xFF9A6A00),
      4: Color(0xFF148452),
    },
  );

  @override
  DexTokens copyWith({
    Color? bg,
    Color? surface,
    Color? surfaceRaised,
    Color? border,
    Color? borderStrong,
    Color? text,
    Color? textMuted,
    Color? textFaint,
    Color? accent,
    Color? accentMuted,
    Map<String, Color>? eventColors,
    Map<int, Color>? tierColors,
    Color? shadow,
  }) {
    return DexTokens(
      bg: bg ?? this.bg,
      surface: surface ?? this.surface,
      surfaceRaised: surfaceRaised ?? this.surfaceRaised,
      border: border ?? this.border,
      borderStrong: borderStrong ?? this.borderStrong,
      text: text ?? this.text,
      textMuted: textMuted ?? this.textMuted,
      textFaint: textFaint ?? this.textFaint,
      accent: accent ?? this.accent,
      accentMuted: accentMuted ?? this.accentMuted,
      eventColors: eventColors ?? this.eventColors,
      tierColors: tierColors ?? this.tierColors,
      shadow: shadow ?? this.shadow,
    );
  }

  @override
  DexTokens lerp(ThemeExtension<DexTokens>? other, double t) {
    if (other is! DexTokens) return this;
    return DexTokens(
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
      eventColors: t < 0.5 ? eventColors : other.eventColors,
      tierColors: t < 0.5 ? tierColors : other.tierColors,
      shadow: Color.lerp(shadow, other.shadow, t)!,
    );
  }
}

extension DexThemeContext on BuildContext {
  DexTokens get dex => Theme.of(this).extension<DexTokens>()!;
}

/// Geist for prose, Geist Mono for anything the machine produced.
class DexType {
  static TextStyle sans({
    double size = 14,
    FontWeight weight = FontWeight.w400,
    Color? color,
    double? height,
    double? spacing,
  }) =>
      GoogleFonts.geist(
        fontSize: size,
        fontWeight: weight,
        color: color,
        height: height,
        letterSpacing: spacing,
      );

  static TextStyle mono({
    double size = 12.5,
    FontWeight weight = FontWeight.w400,
    Color? color,
    double? height,
    double? spacing,
  }) =>
      GoogleFonts.geistMono(
        fontSize: size,
        fontWeight: weight,
        color: color,
        height: height ?? 1.5,
        letterSpacing: spacing,
      );
}

ThemeData buildDexTheme(Brightness brightness) {
  final tokens = brightness == Brightness.dark ? DexTokens.dark : DexTokens.light;
  return ThemeData(
    brightness: brightness,
    scaffoldBackgroundColor: Colors.transparent,
    colorScheme: ColorScheme.fromSeed(
      seedColor: tokens.accent,
      brightness: brightness,
      surface: tokens.surface,
    ),
    extensions: [tokens],
    splashFactory: NoSplash.splashFactory,
    highlightColor: Colors.transparent,
  );
}
