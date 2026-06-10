// Dex ThemeData builders -- one for dark (default), one for light (mirrored).
// Wires the tokens into Flutter's Material 3 ThemeData so widgets that use
// Theme.of(context) without our own helpers still look right.

import 'package:flutter/material.dart';

import 'tokens.dart';

ThemeData buildDexDarkTheme() {
  const scheme = ColorScheme.dark(
    brightness: Brightness.dark,
    primary: DexColors.accent,
    onPrimary: DexColors.bg,
    secondary: DexColors.accentQuiet,
    onSecondary: DexColors.text,
    error: DexColors.stateError,
    onError: DexColors.bg,
    surface: DexColors.surface,
    onSurface: DexColors.text,
  );

  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: scheme,
    scaffoldBackgroundColor: DexColors.bg,
    canvasColor: DexColors.bg,
    dividerColor: DexColors.border,
    splashFactory: NoSplash.splashFactory,
    highlightColor: Colors.transparent,

    fontFamily: dexFontSans,
    fontFamilyFallback: dexFontSansFallback,
    textTheme: TextTheme(
      displayLarge: DexType.display(color: DexColors.text),
      titleLarge: DexType.title(color: DexColors.text),
      headlineSmall: DexType.heading(color: DexColors.text),
      bodyLarge: DexType.body(color: DexColors.text),
      bodyMedium: DexType.body(color: DexColors.text),
      labelLarge: DexType.label(color: DexColors.text),
      labelSmall: DexType.caption(color: DexColors.textDim),
    ),

    iconTheme: const IconThemeData(color: DexColors.textDim, size: 16),

    cardTheme: CardThemeData(
      color: DexColors.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: DexRadius.rmd,
        side: BorderSide(color: DexColors.border, width: 1),
      ),
      margin: EdgeInsets.zero,
    ),

    inputDecorationTheme: InputDecorationTheme(
      isDense: true,
      filled: true,
      fillColor: DexColors.surface2,
      contentPadding: const EdgeInsets.symmetric(
        horizontal: DexSpace.md, vertical: DexSpace.sm,
      ),
      border: OutlineInputBorder(
        borderRadius: DexRadius.rsm,
        borderSide: const BorderSide(color: DexColors.border, width: 1),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: DexRadius.rsm,
        borderSide: const BorderSide(color: DexColors.border, width: 1),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: DexRadius.rsm,
        borderSide: const BorderSide(color: DexColors.accent, width: 1.5),
      ),
      hintStyle: DexType.body(color: DexColors.textFaint),
    ),

    // Every Material button surface emits the OS pointer hand on
    // hover -- the standard Windows desktop affordance the user
    // expected. `enabledMouseCursor` defaults to `defer` on
    // ButtonStyle which falls back to the system default; setting
    // it to `click` opts in to SystemMouseCursors.click without
    // touching the disabled state.
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: DexColors.accent,
        foregroundColor: DexColors.bg,
        elevation: 0,
        padding: const EdgeInsets.symmetric(
          horizontal: DexSpace.lg, vertical: DexSpace.md,
        ),
        shape: const RoundedRectangleBorder(borderRadius: DexRadius.rsm),
        textStyle: DexType.label(),
        enabledMouseCursor: SystemMouseCursors.click,
      ),
    ),

    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: DexColors.textDim,
        padding: const EdgeInsets.symmetric(
          horizontal: DexSpace.lg, vertical: DexSpace.md,
        ),
        shape: const RoundedRectangleBorder(borderRadius: DexRadius.rsm),
        textStyle: DexType.label(),
        enabledMouseCursor: SystemMouseCursors.click,
      ),
    ),

    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: DexColors.text,
        side: const BorderSide(color: DexColors.border),
        padding: const EdgeInsets.symmetric(
          horizontal: DexSpace.lg, vertical: DexSpace.md,
        ),
        shape: const RoundedRectangleBorder(borderRadius: DexRadius.rsm),
        textStyle: DexType.label(),
        enabledMouseCursor: SystemMouseCursors.click,
      ),
    ),

    iconButtonTheme: const IconButtonThemeData(
      style: ButtonStyle(
        mouseCursor: WidgetStatePropertyAll(SystemMouseCursors.click),
      ),
    ),

    dividerTheme: const DividerThemeData(
      color: DexColors.border,
      thickness: 1,
      space: 1,
    ),

    scrollbarTheme: ScrollbarThemeData(
      thumbColor: WidgetStatePropertyAll(DexColors.border),
      thickness: const WidgetStatePropertyAll(6),
      radius: const Radius.circular(3),
    ),

    dialogTheme: DialogThemeData(
      backgroundColor: DexColors.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: DexRadius.rlg,
        side: const BorderSide(color: DexColors.border, width: 1),
      ),
      titleTextStyle: DexType.heading(color: DexColors.text),
      contentTextStyle: DexType.body(color: DexColors.textDim),
    ),

    popupMenuTheme: PopupMenuThemeData(
      color: DexColors.surface2,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: DexRadius.rmd,
        side: const BorderSide(color: DexColors.border, width: 1),
      ),
      textStyle: DexType.label(color: DexColors.text),
    ),

    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: DexColors.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: DexRadius.lg),
        side: const BorderSide(color: DexColors.border, width: 1),
      ),
    ),

    // iOS-style switch: white thumb on a vivid spring-green track when
    // on, soft gray thumb on a muted navy track when off. Green is the
    // universal "active" signal in Apple's design language; pops on
    // the navy gradient without competing with the blue accent that's
    // reserved for primary buttons.
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) return Colors.white;
        return DexColors.textDim;
      }),
      trackColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) return DexColors.stateApprove;
        return DexColors.surface2;
      }),
      trackOutlineColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) return DexColors.stateApprove;
        return DexColors.border;
      }),
      trackOutlineWidth: const WidgetStatePropertyAll(1),
    ),
  );
}

ThemeData buildDexLightTheme() {
  const scheme = ColorScheme.light(
    brightness: Brightness.light,
    primary: DexColorsLight.accent,
    onPrimary: DexColorsLight.bg,
    secondary: DexColorsLight.accentQuiet,
    onSecondary: DexColorsLight.text,
    error: DexColorsLight.stateError,
    onError: DexColorsLight.bg,
    surface: DexColorsLight.surface,
    onSurface: DexColorsLight.text,
  );

  return buildDexDarkTheme().copyWith(
    brightness: Brightness.light,
    colorScheme: scheme,
    scaffoldBackgroundColor: DexColorsLight.bg,
    canvasColor: DexColorsLight.bg,
    dividerColor: DexColorsLight.border,
    cardTheme: CardThemeData(
      color: DexColorsLight.surface,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: DexRadius.rmd,
        side: BorderSide(color: DexColorsLight.border, width: 1),
      ),
      margin: EdgeInsets.zero,
    ),
  );
}
