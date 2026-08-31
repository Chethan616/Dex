import 'package:flutter/material.dart';

import 'palette.dart';
import 'type.dart';

export 'palette.dart' show DexPalette, contrastRatio;
export 'type.dart' show DexType;

/// Spacing, radius, motion, layout and the resolved [DexPalette].
///
/// Widgets never name a colour literal and never name a font size — both
/// resolve through here, so a design change is a change to two files rather
/// than to ninety call sites.
@immutable
class DexTokens extends ThemeExtension<DexTokens> {
  const DexTokens(this.palette);

  final DexPalette palette;

  // Surfaces and text, forwarded so existing call sites read unchanged.
  Color get bg => palette.bg;
  Color get surface => palette.surface;
  Color get surfaceRaised => palette.surfaceRaised;
  Color get border => palette.border;
  Color get borderStrong => palette.borderStrong;
  Color get text => palette.text;
  Color get textMuted => palette.textMuted;
  Color get textFaint => palette.textFaint;
  Color get accent => palette.accent;
  Color get accentMuted => palette.accentMuted;
  Color get shadow => palette.shadow;
  Color get focusRing => palette.focusRing;

  // The six tones.
  Color get neutral => palette.neutral;
  Color get info => palette.info;
  Color get warn => palette.warn;
  Color get attention => palette.attention;
  Color get positive => palette.positive;
  Color get negative => palette.negative;

  /// Event type → tone.
  ///
  /// Eleven types, six tones. `thinking` and `routing` share `neutral` because
  /// they are Dex narrating itself rather than reporting a state — giving them
  /// their own hues implied a distinction that does not exist, and spent two of
  /// the ten colours a reader has to learn.
  Color eventColor(String type) => switch (type) {
        'thinking' || 'routing' => neutral,
        'planning' || 'dispatching' || 'executing' => info,
        'selecting' || 'retrying' => warn,
        'awaiting' || 'cancelled' => attention,
        'done' => positive,
        'failed' => negative,
        _ => neutral,
      };

  /// Confirmation tier → tone. Lower tier means higher consequence.
  Color tierColor(int tier) => switch (tier) {
        1 => negative,
        2 => warn,
        3 => attention,
        _ => positive,
      };

  /// Icon and word for an event type, so the step stream can lead with a glyph
  /// instead of spending 148px on a right-aligned text gutter.
  static IconData eventGlyph(String type) => switch (type) {
        'done' => Icons.check_rounded,
        'failed' => Icons.close_rounded,
        'awaiting' => Icons.pan_tool_alt_outlined,
        'cancelled' => Icons.block_rounded,
        'retrying' => Icons.refresh_rounded,
        'executing' => Icons.play_arrow_rounded,
        'dispatching' => Icons.send_rounded,
        'planning' || 'selecting' => Icons.chevron_right_rounded,
        _ => Icons.more_horiz_rounded,
      };

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

  /// One row and its padding. The old 92 was a 16px input inside 76px of
  /// chrome — a launcher should be mostly the thing you type into.
  static const barRestHeight = 56.0;

  /// Ceiling only. The bar measures its own content and asks for that,
  /// clamped into [barRestHeight, barMaxHeight]; it no longer opens to a fixed
  /// 560 and pads the gap with an empty Spacer.
  static const barMaxHeight = 620.0;

  static const missionWidth = 1080.0;
  static const missionHeight = 780.0;

  static const dark = DexTokens(DexPalette.dark);
  static const light = DexTokens(DexPalette.light);

  @override
  DexTokens copyWith({DexPalette? palette}) => DexTokens(palette ?? this.palette);

  @override
  DexTokens lerp(ThemeExtension<DexTokens>? other, double t) {
    if (other is! DexTokens) return this;
    return DexTokens(palette.lerpTo(other.palette, t));
  }
}

extension DexThemeContext on BuildContext {
  DexTokens get dex => Theme.of(this).extension<DexTokens>()!;
}

ThemeData buildDexTheme(Brightness brightness) {
  final tokens = brightness == Brightness.dark ? DexTokens.dark : DexTokens.light;
  final p = tokens.palette;

  return ThemeData(
    brightness: brightness,
    scaffoldBackgroundColor: Colors.transparent,
    fontFamily: DexType.sansFamily,
    colorScheme: ColorScheme.fromSeed(
      seedColor: p.accent,
      brightness: brightness,
      surface: p.surface,
    ),
    extensions: [tokens],
    splashFactory: NoSplash.splashFactory,
    highlightColor: Colors.transparent,
    // Focus is drawn by each primitive as an explicit ring; Material's own
    // overlay would sit under our borders and read as a smudge.
    focusColor: Colors.transparent,
    hoverColor: Colors.transparent,
    tooltipTheme: TooltipThemeData(
      textStyle: DexType.caption(color: p.text),
      decoration: BoxDecoration(
        color: p.surfaceRaised,
        borderRadius: BorderRadius.circular(DexTokens.radiusSm),
        border: Border.all(color: p.border),
      ),
      waitDuration: const Duration(milliseconds: 500),
    ),
    // One tab style for Mission Control and the Library panel. They had
    // different indicator colours, indicator sizes and label styles.
    tabBarTheme: TabBarThemeData(
      labelStyle: DexType.label(strong: true),
      unselectedLabelStyle: DexType.label(),
      labelColor: p.text,
      unselectedLabelColor: p.textMuted,
      indicatorColor: p.accent,
      indicatorSize: TabBarIndicatorSize.label,
      dividerColor: p.border,
      overlayColor: WidgetStateProperty.all(Colors.transparent),
    ),
  );
}
