// SecretField — the one masked-input used everywhere a credential is
// typed (onboarding key step, Settings → Secrets, login password).
//
// Professional details that the ad-hoc fields lacked:
//   - focus ring: accent border + soft glow, animated (matches the
//     connectors search field so the whole app speaks one language)
//   - the reveal toggle is a proper hover target (circular hover wash,
//     pointer cursor, tooltip), not a bare icon
//   - obscured text uses a round bullet at mono metrics so keys don't
//     jump width when revealed

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../theme/tokens.dart';

class SecretField extends StatefulWidget {
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
  State<SecretField> createState() => _SecretFieldState();
}

class _SecretFieldState extends State<SecretField> {
  final FocusNode _focus = FocusNode();
  late bool _obscured = widget.obscureByDefault;

  @override
  void initState() {
    super.initState();
    _focus.addListener(_onFocus);
  }

  void _onFocus() => setState(() {});

  @override
  void dispose() {
    _focus.removeListener(_onFocus);
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final focused = _focus.hasFocus;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      curve: Curves.easeOut,
      height: 44,
      padding: const EdgeInsets.only(left: DexSpace.md, right: DexSpace.xs),
      decoration: BoxDecoration(
        color: focused
            ? DexColors.surface2.withValues(alpha: 0.7)
            : DexColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: focused
              ? DexColors.accent.withValues(alpha: 0.65)
              : DexColors.border,
        ),
        boxShadow: focused
            ? <BoxShadow>[
                BoxShadow(
                  color: DexColors.accent.withValues(alpha: 0.12),
                  blurRadius: 12,
                  spreadRadius: 1,
                ),
              ]
            : const <BoxShadow>[],
      ),
      child: Row(
        children: [
          Icon(widget.icon,
              size: 15,
              color: focused ? DexColors.accent : DexColors.textFaint),
          const SizedBox(width: DexSpace.sm),
          Expanded(
            child: TextField(
              controller: widget.controller,
              focusNode: _focus,
              obscureText: _obscured,
              obscuringCharacter: '•',
              style: DexType.mono(color: DexColors.text),
              cursorColor: DexColors.accent,
              onSubmitted: widget.onSubmitted,
              decoration: InputDecoration(
                isDense: true,
                border: InputBorder.none,
                hintText: widget.hint,
                hintStyle: DexType.mono(color: DexColors.textFaint),
              ),
            ),
          ),
          Tooltip(
            message: _obscured ? 'Show' : 'Hide',
            child: InkResponse(
              radius: 16,
              onTap: () => setState(() => _obscured = !_obscured),
              mouseCursor: SystemMouseCursors.click,
              child: Container(
                width: 32,
                height: 32,
                alignment: Alignment.center,
                child: Icon(
                  _obscured ? LucideIcons.eye : LucideIcons.eye_off,
                  size: 15,
                  color: DexColors.textDim,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
