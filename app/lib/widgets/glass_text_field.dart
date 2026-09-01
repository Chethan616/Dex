// DexGlassField — the shared plain (unmasked) liquid-glass text field, the
// sibling of SecretField (GlassPasswordField). One field type so login,
// onboarding, and memory-add all speak the same glass input language.

import 'package:flutter/material.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

import '../theme/tokens.dart';

class DexGlassField extends StatelessWidget {
  const DexGlassField({
    super.key,
    required this.controller,
    required this.hint,
    this.icon,
    this.keyboardType,
    this.onSubmitted,
  });

  final TextEditingController controller;
  final String hint;
  final IconData? icon;
  final TextInputType? keyboardType;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    return GlassTextField(
      controller: controller,
      placeholder: hint,
      onSubmitted: onSubmitted,
      keyboardType: keyboardType,
      useOwnLayer: true,
      glowColor: DexColors.accent,
      prefixIcon: icon == null
          ? null
          : Icon(icon, size: 18, color: DexColors.textFaint),
      textStyle: DexType.body(color: DexColors.text),
      placeholderStyle: DexType.body(color: DexColors.textDim),
    );
  }
}
