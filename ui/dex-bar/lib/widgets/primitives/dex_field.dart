import 'package:flutter/material.dart';

import '../../theme/tokens.dart';

/// One text field. The save-suggestion name box, the history search and the
/// workflow argument boxes each carried their own `InputDecoration`, with three
/// different paddings and two different hint styles.
class DexField extends StatelessWidget {
  const DexField({
    super.key,
    required this.controller,
    required this.hint,
    this.mono = false,
    this.width,
    this.prefix,
    this.onChanged,
    this.onSubmitted,
    this.autofocus = false,
  });

  final TextEditingController controller;
  final String hint;

  /// Mono when the value is a machine token — a workflow name, an argument.
  final bool mono;
  final double? width;
  final IconData? prefix;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final style = mono ? DexType.codeSm(color: t.text) : DexType.body(color: t.text);
    final hintStyle =
        mono ? DexType.codeSm(color: t.textFaint) : DexType.body(color: t.textFaint);

    final field = TextField(
      controller: controller,
      style: style,
      autofocus: autofocus,
      cursorColor: t.accent,
      cursorWidth: 2,
      onChanged: onChanged,
      onSubmitted: onSubmitted,
      decoration: InputDecoration(
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 9, vertical: 8),
        hintText: hint,
        hintStyle: hintStyle,
        prefixIcon: prefix == null
            ? null
            : Icon(prefix, size: 15, color: t.textFaint),
        prefixIconConstraints:
            const BoxConstraints(minWidth: 30, minHeight: 0),
        filled: true,
        fillColor: t.surface,
        border: _border(t.border),
        enabledBorder: _border(t.border),
        focusedBorder: _border(t.accent.withValues(alpha: 0.7), width: 1.5),
      ),
    );

    return width == null ? field : SizedBox(width: width, child: field);
  }

  OutlineInputBorder _border(Color color, {double width = 1}) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(DexTokens.radiusSm),
        borderSide: BorderSide(color: color, width: width),
      );
}
