// Spotlight summon overlay (Ctrl+K). Restyled to share the Copilot-inspired
// composer language: rounded acrylic card, suggestion chips beneath the
// input, instant submit -> ConversationStore.

import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../core/state/conversation_store.dart';
import '../theme/tokens.dart';
import 'home/suggestion_chip.dart';

class SpotlightOverlay extends StatefulWidget {
  const SpotlightOverlay._({required this.store});

  final ConversationStore store;

  static const List<String> _suggestions = <String>[
    'Open this file',
    'Summarise this tab',
    'Take a screenshot',
    'Send an email',
  ];

  static Future<void> show(BuildContext context, ConversationStore store) {
    if (_visible) return Future<void>.value();
    _visible = true;
    // NOTE: deliberately no DexTray.showWindow() here. A summon that
    // forces the main window to the foreground is not what the user
    // wants -- they want a passive overlay that floats over whatever
    // they're already doing. A truly global Spotlight (one that renders
    // even when the main window is hidden) needs a separate borderless
    // floating window via desktop_multi_window; until that lands, the
    // overlay only renders when the Flutter window is already mounted.
    return showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Dismiss Dex Spotlight',
      barrierColor: Colors.black.withValues(alpha: 0.32),
      transitionDuration: const Duration(milliseconds: 120),
      pageBuilder: (ctx, _, _) => SpotlightOverlay._(store: store),
      transitionBuilder: (ctx, anim, _, child) {
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

  void _submit([String? text]) {
    final t = (text ?? _ctrl.text).trim();
    if (t.isEmpty) return;
    widget.store.sendHumanMessage(t);
    Navigator.of(context).maybePop();
  }

  void _dismiss() => Navigator.of(context).maybePop();

  @override
  Widget build(BuildContext context) {
    // Material(type: MaterialType.transparency) is REQUIRED because
    // showGeneralDialog's pageBuilder doesn't wrap the page in a
    // Material ancestor, and our TextField + InkResponse descendants
    // throw "No Material widget found" without one. Transparency means
    // we don't get a solid background -- our acrylic Container does
    // the surface work.
    return Material(
      type: MaterialType.transparency,
      child: Shortcuts(
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
          // Alignment(0, -0.55) keeps the panel about a third from the
          // top regardless of window size -- closer to macOS Spotlight's
          // "above-center" feel than a fixed pixel offset would be.
          child: SafeArea(
            child: Align(
              alignment: const Alignment(0, -0.55),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 640),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ClipRRect(
                      borderRadius: DexRadius.rxl,
                      child: BackdropFilter(
                        filter: ImageFilter.blur(
                          sigmaX: DexSurface.blurSigma,
                          sigmaY: DexSurface.blurSigma,
                        ),
                        child: Container(
                          decoration: BoxDecoration(
                            gradient: DexSurface.glossyGradient(),
                            borderRadius: DexRadius.rxl,
                            border: DexSurface.glossyBorder(),
                            boxShadow: DexSurface.glossyShadow,
                          ),
                          padding: const EdgeInsets.fromLTRB(
                            DexSpace.lg, DexSpace.md, DexSpace.lg, DexSpace.md,
                          ),
                          child: Row(
                            children: [
                              const Icon(LucideIcons.search,
                                  size: 20, color: DexColors.textDim),
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
                                    style: DexType.body(color: DexColors.text),
                                    decoration: InputDecoration(
                                      isCollapsed: true,
                                      border: InputBorder.none,
                                      enabledBorder: InputBorder.none,
                                      focusedBorder: InputBorder.none,
                                      filled: false,
                                      hintText: 'Ask Dex anything...',
                                      hintStyle: DexType.body(
                                        color: DexColors.textFaint,
                                      ),
                                    ),
                                    textInputAction: TextInputAction.send,
                                    onSubmitted: (_) => _submit(),
                                  ),
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: DexSpace.sm, vertical: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: DexColors.surface,
                                  borderRadius: DexRadius.rsm,
                                  border: Border.all(color: DexColors.border),
                                ),
                                child: Text(
                                  'esc',
                                  style: DexType.caption(color: DexColors.textFaint),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: DexSpace.md),
                    Wrap(
                      alignment: WrapAlignment.center,
                      spacing: DexSpace.sm,
                      runSpacing: DexSpace.sm,
                      children: SpotlightOverlay._suggestions
                          .map((s) =>
                              SuggestionChip(label: s, onTap: () => _submit(s)))
                          .toList(growable: false),
                    ),
                  ],
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
