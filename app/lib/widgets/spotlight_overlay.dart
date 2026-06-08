// v1.2 Phase 11 — Spotlight-style summon overlay.
//
// Triggered by the global Ctrl+K hotkey registered in main.dart. Renders
// a centered, blurred, mono-input modal that submits straight into the
// existing ConversationStore.sendHumanMessage path. If the main window
// is hidden in the tray, the call also restores it so the streamed reply
// is visible.
//
// Uses the second of the two BackdropFilter budgets in the app
// (the floating command bar in the main window is the other; they cannot
// be on screen together because Spotlight steals modal focus while open).

import 'dart:async';
import 'dart:io';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/state/conversation_store.dart';
import '../platform/win/tray.dart';
import '../theme/tokens.dart';

class SpotlightOverlay extends StatefulWidget {
  const SpotlightOverlay._({required this.store});

  final ConversationStore store;

  /// Show the spotlight overlay. Returns the route's future so the
  /// global-hotkey handler can await it if it cares. Idempotent — if
  /// the overlay is already up, the call is a no-op.
  ///
  /// On Windows the call also restores the main window if it's hidden
  /// in the tray, so the streamed reply lands somewhere visible. The
  /// restore is fire-and-forget so the dialog can mount immediately
  /// (it would otherwise force a BuildContext across an async gap).
  static Future<void> show(BuildContext context, ConversationStore store) {
    if (_visible) return Future<void>.value();
    _visible = true;
    if (Platform.isWindows) {
      // Fire-and-forget so we don't span the BuildContext across an
      // await. Window restoration races the dialog mount, which is
      // fine -- both are cheap and idempotent.
      // ignore: discarded_futures
      DexTray.instance.showWindow();
    }
    return showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Dismiss Dex Spotlight',
      barrierColor: Colors.black.withValues(alpha: 0.32),
      transitionDuration: const Duration(milliseconds: 120),
      pageBuilder: (ctx, _, _) => SpotlightOverlay._(store: store),
      transitionBuilder: (ctx, anim, _, child) {
        // Slight rise + fade in. Reduced-motion users get instant.
        final reduce = MediaQuery.of(ctx).disableAnimations;
        if (reduce) return child;
        final offset = Tween<Offset>(
          begin: const Offset(0, 0.04),
          end: Offset.zero,
        ).animate(CurvedAnimation(parent: anim, curve: Curves.easeOutCubic));
        return FadeTransition(
          opacity: anim,
          child: SlideTransition(position: offset, child: child),
        );
      },
    ).whenComplete(() => _visible = false);
  }

  static bool _visible = false;

  @override
  State<SpotlightOverlay> createState() => _SpotlightOverlayState();
}

class _SpotlightOverlayState extends State<SpotlightOverlay> {
  late final TextEditingController _ctrl;
  late final FocusNode _focus;

  @override
  void initState() {
    super.initState();
    _ctrl = TextEditingController();
    _focus = FocusNode();
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
    widget.store.sendHumanMessage(t);
    Navigator.of(context).maybePop();
  }

  void _dismiss() {
    Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    return Shortcuts(
      shortcuts: const <ShortcutActivator, Intent>{
        SingleActivator(LogicalKeyboardKey.escape): _DismissIntent(),
      },
      child: Actions(
        actions: <Type, Action<Intent>>{
          _DismissIntent: CallbackAction<_DismissIntent>(
            onInvoke: (_) {
              _dismiss();
              return null;
            },
          ),
        },
        child: SafeArea(
          child: Padding(
            // Spotlight sits in the upper third, like macOS Spotlight, so
            // it doesn't collide with a centered modal habit on Windows.
            padding: const EdgeInsets.only(top: 96),
            child: Align(
              alignment: Alignment.topCenter,
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 560),
                child: ClipRRect(
                  borderRadius: DexRadius.rmd,
                  child: BackdropFilter(
                    filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
                    child: Container(
                      decoration: BoxDecoration(
                        color: DexColors.surface2.withValues(alpha: 0.92),
                        borderRadius: DexRadius.rmd,
                        border: Border.all(color: DexColors.border),
                        boxShadow: DexElevation.floating,
                      ),
                      padding: const EdgeInsets.symmetric(
                        horizontal: DexSpace.lg,
                        vertical: DexSpace.md,
                      ),
                      child: Row(
                        children: [
                          Text(
                            '>',
                            style: DexType.mono(color: DexColors.textDim),
                          ),
                          const SizedBox(width: DexSpace.md),
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
                                  hintText: 'command Dex...',
                                  hintStyle: DexType.mono(
                                    color: DexColors.textFaint,
                                  ),
                                ),
                                textInputAction: TextInputAction.send,
                                onSubmitted: (_) => _submit(),
                              ),
                            ),
                          ),
                          Text(
                            'esc',
                            style: DexType.label(color: DexColors.textFaint),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DismissIntent extends Intent {
  const _DismissIntent();
}
