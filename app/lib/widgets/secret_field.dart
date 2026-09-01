// SecretField — the one masked-input used everywhere a credential is
// typed (onboarding key step, Settings → Secrets, login password).
//
// This is now the package's real GlassPasswordField (own glass layer,
// lock glyph, built-in reveal toggle, iOS-26 press physics) behind the
// same constructor the rest of the app already calls, so every key /
// password field across onboarding, login, Settings → Secrets and the
// model picker speaks one liquid-glass language. The legacy `icon` /
// `obscureByDefault` params are accepted for source-compat but the glass
// field manages its own lock icon + reveal toggle.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

import '../theme/tokens.dart';

class SecretField extends StatelessWidget {
  const SecretField({
    super.key,
    required this.controller,
    required this.hint,
    this.icon = LucideIcons.key_round,
    this.obscureByDefault = true,
    this.onSubmitted,
  });

  final TextEditingController controller;
  final String hint;
  final IconData icon;
  final bool obscureByDefault;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    return GlassPasswordField(
      controller: controller,
      placeholder: hint,
      onSubmitted: onSubmitted,
      useOwnLayer: true,
      glowColor: DexColors.accent,
      textStyle: DexType.mono(color: DexColors.text),
      placeholderStyle: DexType.mono(color: DexColors.textDim),
    );
  }
}
