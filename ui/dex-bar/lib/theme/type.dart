import 'package:flutter/material.dart';

/// Dex's type ramp: nine roles, and no way to ask for a size.
///
/// The previous version exposed `sans(size: …)` / `mono(size: …)`, and the app
/// ended up with thirteen distinct sizes — 9.5, 10, 10.5, 11, 11.5, 12, 12.5,
/// 13, 14, 15, 16, 19 — chosen independently at ninety call sites.
/// `sans(size: 11.5)` became the most common style in the app while meaning
/// nothing at all.
///
/// Removing the parameter is the fix. A convention that a widget *should* use
/// the scale is a convention that decays the first time someone is in a hurry;
/// a role that cannot express "12.5, but just here" cannot decay. If a new
/// design genuinely needs a tenth role, it gets added here, once, with a name.
///
/// Geist and Geist Mono are bundled in `fonts/` as variable faces, so weight is
/// a real axis instance rather than a synthetic smear — hence [FontVariation]
/// alongside [FontWeight] on every style.
class DexType {
  DexType._();

  static const sansFamily = 'Geist';
  static const monoFamily = 'GeistMono';

  /// Digits that do not change width. Without this the confirmation countdown
  /// and the elapsed clock reflow on every tick, which reads as the panel
  /// twitching rather than as time passing.
  static const _tabular = <FontFeature>[FontFeature.tabularFigures()];

  // ── sans ──────────────────────────────────────────────────────────────────

  /// Mission Control's title, and the large numbers in Usage.
  static TextStyle display({Color? color, bool strong = false}) => _style(
        family: sansFamily, size: 20, weight: strong ? 700 : 600,
        height: 1.20, tracking: -0.2, color: color, features: _tabular,
      );

  /// Panel headers, a plan's intent line.
  static TextStyle title({Color? color, bool strong = false}) => _style(
        family: sansFamily, size: 15, weight: strong ? 700 : 600,
        height: 1.30, tracking: -0.1, color: color,
      );

  /// The command input, and the prompt echoed back above a running task.
  static TextStyle prompt({Color? color, bool strong = false}) => _style(
        family: sansFamily, size: 16, weight: strong ? 500 : 400,
        height: 1.35, tracking: 0, color: color,
      );

  /// Descriptions, blurbs, empty states — anything Dex says in prose.
  static TextStyle body({Color? color, bool strong = false}) => _style(
        family: sansFamily, size: 13, weight: strong ? 500 : 400,
        height: 1.45, tracking: 0, color: color,
      );

  /// Buttons, tabs, tile names.
  static TextStyle label({Color? color, bool strong = false}) => _style(
        family: sansFamily, size: 12, weight: strong ? 600 : 500,
        height: 1.30, tracking: 0, color: color,
      );

  /// Secondary meta that sits beside something more important.
  static TextStyle caption({Color? color, bool strong = false}) => _style(
        family: sansFamily, size: 11, weight: strong ? 500 : 400,
        height: 1.35, tracking: 0.1, color: color,
      );

  // ── mono ──────────────────────────────────────────────────────────────────
  //
  // Mono means "a machine produced this": step messages, action names, params,
  // evidence, ids. It is never used for prose Dex wrote for the owner to read.

  /// Step-stream messages, action signatures, params, evidence bodies.
  static TextStyle code({Color? color, bool strong = false}) => _style(
        family: monoFamily, size: 12.5, weight: strong ? 500 : 400,
        height: 1.55, tracking: 0, color: color, features: _tabular,
      );

  /// Step ids, versions, timestamps, counts.
  static TextStyle codeSm({Color? color, bool strong = false}) => _style(
        family: monoFamily, size: 11, weight: strong ? 500 : 400,
        height: 1.45, tracking: 0, color: color, features: _tabular,
      );

  /// Uppercase status words only: TIER 2, COMPLETED, VERIFIED.
  static TextStyle tag({Color? color, bool strong = false}) => _style(
        family: monoFamily, size: 10, weight: strong ? 700 : 600,
        height: 1.0, tracking: 0.6, color: color, features: _tabular,
      );

  /// Every role, for the ramp test to enumerate.
  static Map<String, TextStyle Function()> get roles => {
        'display': display, 'title': title, 'prompt': prompt, 'body': body,
        'label': label, 'caption': caption, 'code': code, 'codeSm': codeSm,
        'tag': tag,
      };

  static TextStyle _style({
    required String family,
    required double size,
    required double weight,
    required double height,
    required double tracking,
    Color? color,
    List<FontFeature>? features,
  }) =>
      TextStyle(
        fontFamily: family,
        fontSize: size,
        height: height,
        letterSpacing: tracking,
        color: color,
        fontWeight: _weight(weight),
        fontVariations: [FontVariation('wght', weight)],
        fontFeatures: features,
        // Geist's own line metrics are tight and asymmetric; distributing the
        // leading evenly is what makes a single line sit centred in a row
        // instead of riding high in it.
        leadingDistribution: TextLeadingDistribution.even,
      );

  static FontWeight _weight(double w) => switch (w.round()) {
        <= 400 => FontWeight.w400,
        500 => FontWeight.w500,
        600 => FontWeight.w600,
        _ => FontWeight.w700,
      };
}
