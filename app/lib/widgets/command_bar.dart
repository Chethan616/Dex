// Floating command bar -- pinned bottom-center of the conversation. Blurred
// surface (one of the two permitted BackdropFilter uses in the app), mono
// input, Enter sends, Ctrl+K focuses from anywhere.

import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/tokens.dart';

class CommandBar extends StatefulWidget {
  const CommandBar({super.key, required this.onSubmit});

  final ValueChanged<String> onSubmit;

  @override
  State<CommandBar> createState() => _CommandBarState();
}

class _CommandBarState extends State<CommandBar> {
  late final TextEditingController _ctrl;
  late final FocusNode _focus;

  @override
  void initState() {
    super.initState();
    _ctrl = TextEditingController();
    _focus = FocusNode();
    // Auto-focus on app start so the user can just type.
    WidgetsBinding.instance.addPostFrameCallback((_) => _focus.requestFocus());
  }

  @override
  void dispose() {
    _ctrl.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _submit() {
    final t = _ctrl.text.trim();
    if (t.isEmpty) return;
    widget.onSubmit(t);
    _ctrl.clear();
    _focus.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    return Shortcuts(
      shortcuts: <ShortcutActivator, Intent>{
        LogicalKeySet(LogicalKeyboardKey.control, LogicalKeyboardKey.keyK):
            const _FocusCommandBarIntent(),
        LogicalKeySet(LogicalKeyboardKey.meta, LogicalKeyboardKey.keyK):
            const _FocusCommandBarIntent(),
      },
      child: Actions(
        actions: <Type, Action<Intent>>{
          _FocusCommandBarIntent: CallbackAction<_FocusCommandBarIntent>(
            onInvoke: (_) {
              _focus.requestFocus();
              return null;
            },
          ),
        },
        child: ClipRRect(
          borderRadius: DexRadius.rmd,
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
            child: Container(
              decoration: BoxDecoration(
                color: DexColors.surface2.withValues(alpha: 0.85),
                borderRadius: DexRadius.rmd,
                border: Border.all(color: DexColors.border),
                boxShadow: DexElevation.floating,
              ),
              padding: const EdgeInsets.symmetric(
                horizontal: DexSpace.md, vertical: DexSpace.sm,
              ),
              child: Row(
                children: [
                  Text('>', style: DexType.mono(color: DexColors.textDim)),
                  const SizedBox(width: DexSpace.sm),
                  Expanded(
                    child: KeyboardListener(
                      focusNode: FocusNode(skipTraversal: true),
                      onKeyEvent: (e) {
                        if (e is KeyDownEvent &&
                            e.logicalKey == LogicalKeyboardKey.enter &&
                            !HardwareKeyboard.instance.isShiftPressed) {
                          _submit();
                        }
                      },
                      child: TextField(
                        controller: _ctrl,
                        focusNode: _focus,
                        style: DexType.mono(color: DexColors.text),
                        decoration: InputDecoration(
                          isCollapsed: true,
                          border: InputBorder.none,
                          enabledBorder: InputBorder.none,
                          focusedBorder: InputBorder.none,
                          filled: false,
                          hintText: 'type a command... (Ctrl+K to focus)',
                          hintStyle: DexType.mono(color: DexColors.textFaint),
                        ),
                        textInputAction: TextInputAction.send,
                        onSubmitted: (_) => _submit(),
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.send_rounded, size: 16),
                    onPressed: _submit,
                    tooltip: 'Send (Enter)',
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _FocusCommandBarIntent extends Intent {
  const _FocusCommandBarIntent();
}
