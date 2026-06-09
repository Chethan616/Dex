// Design tokens for Dex -- the SINGLE SOURCE OF TRUTH for color, type,
// space, radius. Section 2-4 of D:\project1\design.md.
//
// Rule: no hard-coded hex or px elsewhere in the codebase. Reference these
// constants from every widget, theme builder, and screen.

import 'package:flutter/material.dart';

// =============================================================================
// 1. COLOR -- dark-first base; light mirror lives in DexColorsLight below.
// =============================================================================

class DexColors {
  const DexColors._();

  // base -- dark, unambiguously cool. Aligned with DexSurface.bgGradient
  // so panels and the background read as one neutral family even under
  // Windows Night Light.
  static const Color bg = Color(0xFF0A0C10);
  static const Color surface = Color(0xFF13161B);
  static const Color surface2 = Color(0xFF181C22);
  static const Color border = Color(0xFF272B33);

  // text -- off-white through cool gray. No warm sand bias; chat copy
  // reads as a premium dark-mode product rather than a beach theme.
  static const Color text = Color(0xFFE6E8EC);      // off-white
  static const Color textDim = Color(0xFF9CA1AB);   // cool mid-gray
  static const Color textFaint = Color(0xFF646973); // cool deep gray

  // accent -- subtle cool blue used for primary buttons + focus rings.
  // Sparse usage: engine pills + chips carry semantic color on their own.
  static const Color accent = Color(0xFF6EA8FE);
  static const Color accentQuiet = Color(0xFF1A2030);

  // agent state -- semantic, NOT decorative
  static const Color stateIdle = Color(0xFF646973);      // cool gray (== textFaint)
  static const Color stateThinking = Color(0xFFB58CFF);  // violet pulse
  static const Color stateActing = Color(0xFF6EA8FE);    // cool blue (== accent)
  static const Color stateApprove = Color(0xFF3DD68C);   // green
  static const Color stateAwaiting = Color(0xFFFFB454);  // amber (only warm hit -- semantic urgency)
  static const Color stateError = Color(0xFFFF6B6B);     // red

  // Map an AgentState enum value to its token color.
  // Callers should also pair the color with a glyph and word -- never signal
  // by color alone (a11y rule in design.md section 9).
  static Color forAgentState(DexAgentStateToken state) {
    switch (state) {
      case DexAgentStateToken.idle:
        return stateIdle;
      case DexAgentStateToken.thinking:
        return stateThinking;
      case DexAgentStateToken.acting:
        return stateActing;
      case DexAgentStateToken.awaiting:
        return stateAwaiting;
      case DexAgentStateToken.error:
        return stateError;
    }
  }
}

// Light theme mirrors the same tokens. v1 ships dark by default; the light
// palette exists so the Theme can flip via prefersDark / a future toggle
// without touching any widget code.
class DexColorsLight {
  const DexColorsLight._();

  // Light mirror -- sand tones on warm-cream bg (was off-white on cool gray).
  static const Color bg = Color(0xFFFAF6EE);
  static const Color surface = Color(0xFFFFFCF5);
  static const Color surface2 = Color(0xFFF1EADD);
  static const Color border = Color(0xFFD9CFB9);

  static const Color text = Color(0xFF332A1B);     // deep sand-brown
  static const Color textDim = Color(0xFF6E5F44);  // mid sand
  static const Color textFaint = Color(0xFFA89882); // pale sand

  static const Color accent = Color(0xFFB07A38);   // warmer sand for light bg
  static const Color accentQuiet = Color(0xFFF1E3CC);

  // State colors keep the same hue family on light bg.
  static const Color stateIdle = Color(0xFFA89882);
  static const Color stateThinking = Color(0xFF8A5BE6);
  static const Color stateActing = Color(0xFFB07A38);
  static const Color stateApprove = Color(0xFF1FA86E);
  static const Color stateAwaiting = Color(0xFFC58A30);
  static const Color stateError = Color(0xFFD64545);
}

// =============================================================================
// 2. SPACE -- 8pt grid. Default gutter 16; section rhythm 24.
// =============================================================================

class DexSpace {
  const DexSpace._();
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;   // default gutter
  static const double xl = 24;   // section rhythm
  static const double xxl = 32;
  static const double xxxl = 48;
}

// =============================================================================
// 3. RADIUS
// =============================================================================

class DexRadius {
  const DexRadius._();
  static const Radius sm = Radius.circular(6);    // chips, inputs
  static const Radius md = Radius.circular(10);   // cards
  static const Radius lg = Radius.circular(16);   // sheets, modals
  static const Radius xl = Radius.circular(20);   // composer pill, bubbles
  static const Radius pill = Radius.circular(999); // suggestion chips, mode pills
  static const BorderRadius rsm = BorderRadius.all(sm);
  static const BorderRadius rmd = BorderRadius.all(md);
  static const BorderRadius rlg = BorderRadius.all(lg);
  static const BorderRadius rxl = BorderRadius.all(xl);
  static const BorderRadius rpill = BorderRadius.all(pill);
}

// =============================================================================
//    SURFACE -- gradient + acrylic alphas for the Copilot-style shell.
// =============================================================================

class DexSurface {
  const DexSurface._();

  // Background gradient -- cool dark-gray fade for the home wallpaper.
  // Blue-biased stops keep the surface unambiguously cool even under
  // Windows Night Light, so the page never reads warm/amber.
  static const LinearGradient bgGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: <Color>[
      Color(0xFF0A0C10),
      Color(0xFF101319),
      Color(0xFF161A21),
    ],
    stops: <double>[0.0, 0.55, 1.0],
  );

  static const LinearGradient bgGradientLight = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: <Color>[
      Color(0xFFFAF6EE),
      Color(0xFFF4ECDB),
      Color(0xFFE9DDC2),
    ],
    stops: <double>[0.0, 0.55, 1.0],
  );

  // Acrylic alpha applied to surface2 for floating panels (composer,
  // popup menus, spotlight overlay, settings cards). Pair with a
  // BackdropFilter blur of 14 to read as Fluent acrylic.
  static const double acrylicAlpha = 0.82;
  static const double acrylicAlphaQuiet = 0.66;
  static const double blurSigma = 14;
}

// =============================================================================
// 4. TYPE -- 1.250 major-third scale, 16px base.
// =============================================================================

// Font family names. Match the families declared in pubspec.yaml.
// If the .ttf files are missing, Flutter falls back to TextStyle.fontFamilyFallback.
const String dexFontSans = 'Geist';
const String dexFontMono = 'GeistMono';

// System fallbacks if Geist isn't shipped. Cross-platform stack.
const List<String> dexFontSansFallback = <String>[
  'Segoe UI',
  'system-ui',
  '-apple-system',
  'Roboto',
  'Helvetica Neue',
  'Arial',
  'sans-serif',
];
const List<String> dexFontMonoFallback = <String>[
  'Cascadia Code',
  'Consolas',
  'Menlo',
  'Monaco',
  'Courier New',
  'monospace',
];

class DexType {
  const DexType._();

  // Helper to build text styles consistently.
  static TextStyle _sans({
    required double size,
    required double height,
    required FontWeight weight,
    double letterSpacing = 0,
    Color? color,
  }) => TextStyle(
        fontFamily: dexFontSans,
        fontFamilyFallback: dexFontSansFallback,
        fontSize: size,
        height: height / size,
        fontWeight: weight,
        letterSpacing: letterSpacing,
        color: color,
      );

  static TextStyle _mono({
    required double size,
    required double height,
    required FontWeight weight,
    Color? color,
  }) => TextStyle(
        fontFamily: dexFontMono,
        fontFamilyFallback: dexFontMonoFallback,
        fontSize: size,
        height: height / size,
        fontWeight: weight,
        color: color,
      );

  // 1.250 major-third scale, 16 base.
  static TextStyle display({Color? color}) => _sans(
        size: 31, height: 38, weight: FontWeight.w600,
        letterSpacing: -0.31, color: color,
      );
  static TextStyle title({Color? color}) => _sans(
        size: 25, height: 32, weight: FontWeight.w600,
        letterSpacing: -0.25, color: color,
      );
  static TextStyle heading({Color? color}) => _sans(
        size: 20, height: 28, weight: FontWeight.w500,
        color: color,
      );
  static TextStyle body({Color? color}) => _sans(
        size: 16, height: 24, weight: FontWeight.w400,
        color: color,
      );
  static TextStyle label({Color? color}) => _sans(
        size: 14, height: 20, weight: FontWeight.w500,
        color: color,
      );
  static TextStyle caption({Color? color}) => _sans(
        size: 12, height: 16, weight: FontWeight.w400,
        color: color,
      );

  // Mono gets the agent's words; sans gets the human's.
  static TextStyle mono({Color? color}) => _mono(
        size: 14, height: 22, weight: FontWeight.w400,
        color: color,
      );
}

// =============================================================================
// 5. ELEVATION -- one real shadow, used twice (command bar, approval sheet).
// =============================================================================

class DexElevation {
  const DexElevation._();

  // The one elevated shadow. Cheap to render, calm to read.
  static const List<BoxShadow> floating = <BoxShadow>[
    BoxShadow(
      color: Color(0x66000000),
      blurRadius: 16,
      offset: Offset(0, 4),
      spreadRadius: 0,
    ),
  ];
}

// =============================================================================
// 6. AGENT STATE -- enum lives in core/models/agent_state.dart. We export
//    a "token" mirror here so this file is the only file that ever maps a
//    state to a color/glyph/word.
// =============================================================================

enum DexAgentStateToken { idle, thinking, acting, awaiting, error }

class DexStateGlyph {
  const DexStateGlyph._();

  // Pair each state with its short glyph (for the status pill / action step
  // leading marker) and word (for screen readers and visual users alike).
  static String glyph(DexAgentStateToken s) {
    switch (s) {
      case DexAgentStateToken.idle:      return String.fromCharCode(0x25CB); // unicode hollow circle
      case DexAgentStateToken.thinking:  return String.fromCharCode(0x29FF); // ⧿ -- but rendered as breathing dot
      case DexAgentStateToken.acting:    return String.fromCharCode(0x25CF); // filled circle
      case DexAgentStateToken.awaiting:  return String.fromCharCode(0x25B2); // up triangle -- "your move"
      case DexAgentStateToken.error:     return String.fromCharCode(0x2715); // multiplication x
    }
  }

  static String word(DexAgentStateToken s) {
    switch (s) {
      case DexAgentStateToken.idle:      return 'idle';
      case DexAgentStateToken.thinking:  return 'thinking';
      case DexAgentStateToken.acting:    return 'acting';
      case DexAgentStateToken.awaiting:  return 'awaiting';
      case DexAgentStateToken.error:     return 'error';
    }
  }
}

// Action-step glyphs used by the mono step lines in the conversation.
class DexStepGlyph {
  const DexStepGlyph._();
  static const String queued  = '>';   // ASCII safe fallback; visual line shows curly arrow
  static const String running = '...'; // animated 3-dot via opacity pulse in widget
  static const String done    = 'OK';
  static const String failed  = 'X';
}
