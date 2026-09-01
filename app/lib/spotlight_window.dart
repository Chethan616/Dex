// The Spotlight sub-window. Spawned via desktop_multi_window from the
// main Dex window when the user hits the global Ctrl+K while Dex is
// unfocused. Renders the same composer-style summon panel that the
// in-app SpotlightOverlay used to, but as a real borderless Windows
// overlay sitting on top of whatever the user is currently doing.
//
// IPC: when the user submits, the panel invokes the
// `dex.spotlight` WindowMethodChannel's `sendPrompt` method. The main
// window has the handler registered (see main.dart) and forwards the
// prompt into ConversationStore.sendHumanMessage.

import 'dart:async';
import 'dart:io';

import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_lucide/flutter_lucide.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';
import 'package:window_manager/window_manager.dart';

import 'package:super_drag_and_drop/super_drag_and_drop.dart';

import 'core/prompt_history.dart';
import 'main.dart' show DexScrollBehavior, dexSpotlightChannel;
import 'theme/motion.dart';
import 'theme/theme.dart';
import 'theme/tokens.dart';
import 'widgets/composer/attachments.dart';
import 'widgets/menu_glass.dart';

/// Default suggestions surfaced under the overlay's input. Same shape
/// as the in-app SpotlightOverlay had so users recognise the surface.
const List<String> _suggestions = <String>[
  'Open this file',
  'Summarise this tab',
  'Take a screenshot',
  'Send an email',
];

/// Boot the spotlight sub-window. Sets up the borderless always-on-top
/// chrome, then runs the MaterialApp.
Future<void> runSpotlightWindow(WindowController self) async {
  // Style the sub-window before showing it: borderless (no titlebar),
  // transparent background so the acrylic card reads as glass, sized
  // to the overlay's content + always-on-top + centered. Wrapped in
  // try/catch because window_manager calls from a sub-window can throw
  // on the very first frame on some Windows versions; we'd rather show
  // a slightly-chromed window than fail to summon at all.
  try {
    await windowManager.ensureInitialized();
    const opts = WindowOptions(
      size: Size(720, 420),
      backgroundColor: Colors.transparent,
      skipTaskbar: true,
      titleBarStyle: TitleBarStyle.hidden,
      alwaysOnTop: true,
    );
    await windowManager.waitUntilReadyToShow(opts, () async {
      await windowManager.setAsFrameless();
      await windowManager.setAlwaysOnTop(true);
      await windowManager.center();
      await windowManager.show();
      await windowManager.focus();
    });
  } catch (e, st) {
    // Fallback: still show whatever the OS handed us. Logged so the
    // first-frame-on-Windows-11 corner case doesn't go silent.
    debugPrint('[dex] spotlight window styling failed: $e\n$st');
  }

  runApp(SpotlightWindowApp(controller: self));
}

class SpotlightWindowApp extends StatelessWidget {
  const SpotlightWindowApp({super.key, required this.controller});
  final WindowController controller;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Dex Spotlight',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.dark,
      theme: buildDexLightTheme(),
      darkTheme: buildDexDarkTheme(),
      scrollBehavior: const DexScrollBehavior(),
      home: SpotlightScreen(controller: controller),
    );
  }
}

class SpotlightScreen extends StatefulWidget {
  const SpotlightScreen({super.key, required this.controller});
  final WindowController controller;

  @override
  State<SpotlightScreen> createState() => _SpotlightScreenState();
}

class _SpotlightScreenState extends State<SpotlightScreen> {
  late final TextEditingController _ctrl;
  late final FocusNode _focus;
  bool _submitting = false;

  // Attachments collected via Ctrl+V paste, drop onto the panel, or
  // tapping the + circle. Rendered as a chip strip above the input.
  // The IPC payload back to the main window stays text-only for now;
  // attachment paths get serialised into the prompt prefix until the
  // gateway has a real attachments protocol.
  final List<AttachedItem> _attachments = <AttachedItem>[];

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

  // Shell-style recall for the spotlight's single-line input. The
  // spotlight runs in its own Flutter engine, so this PromptHistory is
  // a separate per-overlay buffer from the main composer's.
  int _historyIndex = -1;
  String _historyDraft = '';

  void _recallPrev() {
    final h = PromptHistory.instance.entries;
    if (h.isEmpty || _historyIndex >= h.length - 1) return;
    if (_historyIndex < 0) _historyDraft = _ctrl.text;
    _historyIndex += 1;
    _applyRecall(h[h.length - 1 - _historyIndex]);
  }

  void _recallNext() {
    if (_historyIndex < 0) return;
    _historyIndex -= 1;
    final h = PromptHistory.instance.entries;
    _applyRecall(
      _historyIndex < 0 ? _historyDraft : h[h.length - 1 - _historyIndex],
    );
  }

  void _applyRecall(String text) {
    _ctrl.value = TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
  }

  Future<void> _submit([String? text]) async {
    final t = (text ?? _ctrl.text).trim();
    if (t.isEmpty && _attachments.isEmpty) return;
    if (_submitting) return;
    PromptHistory.instance.push(t);
    _historyIndex = -1;
    setState(() => _submitting = true);
    // Serialise attachments into a prompt prefix until the gateway
    // has a structured attachments protocol. File URIs are passed
    // verbatim; pasted text/image attachments are summarised.
    final prefix = _attachments.isEmpty
        ? ''
        : '${_attachments.map(_formatAttachment).join('\n')}\n';
    final payload = '$prefix$t';
    const channel = WindowMethodChannel(dexSpotlightChannel);
    try {
      await channel.invokeMethod<void>('sendPrompt', payload);
    } catch (e, st) {
      // Even if IPC failed, still close the window -- the user expects
      // dismissal on submit. Logging so a real failure shows up.
      debugPrint('[dex] spotlight sendPrompt failed: $e\n$st');
    }
    await _dismiss();
  }

  String _formatAttachment(AttachedItem a) {
    return switch (a.kind) {
      AttachmentKind.file => '[attached file: ${a.fileUri ?? a.name}]',
      AttachmentKind.image => '[attached image: ${a.name}]',
      AttachmentKind.text => '[attached text: ${a.text ?? ""}]',
    };
  }

  void _addAttachments(List<AttachedItem> items) {
    if (items.isEmpty || !mounted) return;
    setState(() => _attachments.addAll(items));
  }

  void _removeAttachment(String id) {
    setState(() => _attachments.removeWhere((a) => a.id == id));
  }

  Future<void> _pasteFromClipboard() async {
    // Rich content (image / file) becomes an attachment chip.
    final items = await extractClipboardItems();
    if (items.isNotEmpty) {
      _addAttachments(items);
      return;
    }
    // Plain text: the Ctrl+V Shortcut intercepts the default TextField
    // paste, so insert the clipboard text at the caret ourselves —
    // otherwise text paste silently does nothing in the overlay.
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text;
    if (text == null || text.isEmpty) return;
    final sel = _ctrl.selection;
    final start = sel.isValid ? sel.start : _ctrl.text.length;
    final end = sel.isValid ? sel.end : _ctrl.text.length;
    final next = _ctrl.text.replaceRange(start, end, text);
    _ctrl.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: start + text.length),
    );
  }

  Future<void> _dismiss() async {
    if (Platform.isWindows) {
      try {
        await windowManager.close();
      } catch (e) {
        // If close fails, hide so the panel at least disappears.
        await windowManager.hide();
      }
    }
  }

  void _onAttach() {
    // Tap the + circle → behaves like a paste: capture whatever is
    // on the clipboard and add it as an attachment chip. The full
    // file-picker path lands in v1.3.
    _pasteFromClipboard();
  }

  @override
  Widget build(BuildContext context) {
    return DropRegion(
      formats: kAcceptedDropFormats,
      hitTestBehavior: HitTestBehavior.opaque,
      onDropOver: (event) async => DropOperation.copy,
      onPerformDrop: (event) async {
        final items = await extractDroppedItems(event);
        _addAttachments(items);
      },
      child: Material(
        type: MaterialType.transparency,
        child: Shortcuts(
          shortcuts: const <ShortcutActivator, Intent>{
            SingleActivator(LogicalKeyboardKey.escape): _DismissIntent(),
            SingleActivator(LogicalKeyboardKey.keyV, control: true):
                _SpotlightPasteIntent(),
            SingleActivator(LogicalKeyboardKey.keyV, meta: true):
                _SpotlightPasteIntent(),
          },
          child: Actions(
            actions: <Type, Action<Intent>>{
              _DismissIntent: CallbackAction<_DismissIntent>(
                onInvoke: (_) {
                  _dismiss();
                  return null;
                },
              ),
              _SpotlightPasteIntent:
                  CallbackAction<_SpotlightPasteIntent>(onInvoke: (_) {
                _pasteFromClipboard();
                return null;
              }),
            },
            child: Padding(
            padding: const EdgeInsets.all(DexSpace.lg),
            // Move the overlay up ~25% so it sits in the top-third of
            // the window like macOS Spotlight rather than dead-center.
            // Less visually heavy, and leaves room for suggestion chips
            // to ripple in beneath without crowding.
            child: Align(
              alignment: const Alignment(0, -0.48),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _SpotlightOverlayHeader(submitting: _submitting),
                  const SizedBox(height: DexSpace.sm),
                  AttachmentStrip(
                    items: _attachments,
                    onRemove: _removeAttachment,
                  ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Flexible(
                        child: GlassContainer(
                          // Rich premium liquid glass for the ask pill — the
                          // overlay floats over a static desktop, so the full
                          // refraction + glow read cleanly without flicker.
                          useOwnLayer: true,
                          quality: GlassQuality.minimal,
                          shape: const LiquidRoundedSuperellipse(
                            borderRadius: 28,
                          ),
                          settings: const LiquidGlassSettings(
                            glassColor: kDexMenuTint,
                            blur: 18,
                            thickness: 18,
                            glowIntensity: 0.4,
                          ),
                          padding: const EdgeInsets.fromLTRB(
                            DexSpace.lg, DexSpace.md, DexSpace.lg, DexSpace.md,
                          ),
                          child: RepaintBoundary(
                              child: Row(
                                  children: [
                                    const Icon(LucideIcons.search,
                                        size: 20, color: DexColors.accent),
                                    const SizedBox(width: DexSpace.md),
                                    Expanded(
                                      child: KeyboardListener(
                                        focusNode: FocusNode(skipTraversal: true),
                                        onKeyEvent: (e) {
                                          if (e is! KeyDownEvent) return;
                                          if (e.logicalKey == LogicalKeyboardKey.enter &&
                                              !HardwareKeyboard.instance.isShiftPressed) {
                                            _submit();
                                          } else if (e.logicalKey ==
                                              LogicalKeyboardKey.arrowUp) {
                                            _recallPrev();
                                          } else if (e.logicalKey ==
                                              LogicalKeyboardKey.arrowDown) {
                                            _recallNext();
                                          }
                                        },
                                        child: TextField(
                                          controller: _ctrl,
                                          focusNode: _focus,
                                          enabled: !_submitting,
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
                                    const _SpotlightKeycap(label: 'esc'),
                                  ],
                                ),
                            ),
                          ),
                      ),
                      // Trailing + badge — tapping it opens the liquid-glass
                      // GlassMenu (teardrop morph) with the attach actions,
                      // the overlay you had before.
                      const SizedBox(width: 12),
                      FogAwareGlassMenu(
                        quality: GlassQuality.minimal,
                        menuWidth: 240,
                        settings: kDexMenuGlass,
                        triggerBuilder: (context, toggle) =>
                            _SpotlightAddButton(onTap: toggle),
                        items: [
                          GlassMenuItem(
                            title: 'Paste from clipboard',
                            icon: const Icon(LucideIcons.clipboard),
                            onTap: _pasteFromClipboard,
                          ),
                          GlassMenuItem(
                            title: 'Attach image or file',
                            icon: const Icon(LucideIcons.paperclip),
                            onTap: _onAttach,
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: DexSpace.md),
                  Wrap(
                    alignment: WrapAlignment.center,
                    spacing: DexSpace.sm,
                    runSpacing: DexSpace.sm,
                    children: _suggestions
                        .map((s) =>
                            _SpotlightSuggestionChip(
                                label: s, onTap: () => _submit(s)))
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

class _SpotlightOverlayHeader extends StatelessWidget {
  const _SpotlightOverlayHeader({required this.submitting});
  final bool submitting;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 620,
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: DexSpace.md,
              vertical: DexSpace.xs,
            ),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  kDexMenuAccentSurface,
                  kDexMenuTint.withValues(alpha: 0.82),
                ],
              ),
              borderRadius: DexRadius.rpill,
              border: Border.all(color: kDexMenuAccentBorder),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  LucideIcons.sparkles,
                  size: 14,
                  color: DexColors.accent,
                ),
                const SizedBox(width: DexSpace.xs),
                Text('Dex', style: DexType.label(color: DexColors.text)),
                const SizedBox(width: DexSpace.xs),
                Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: submitting
                        ? DexColors.stateThinking
                        : DexColors.accent,
                    shape: BoxShape.circle,
                  ),
                ),
              ],
            ),
          ),
          const Spacer(),
        ],
      ),
    );
  }
}

class _SpotlightAddButton extends StatefulWidget {
  const _SpotlightAddButton({required this.onTap});
  final VoidCallback onTap;

  @override
  State<_SpotlightAddButton> createState() => _SpotlightAddButtonState();
}

class _SpotlightAddButtonState extends State<_SpotlightAddButton> {
  bool _hovered = false;
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final active = _hovered || _pressed;
    final scale = _pressed ? 0.96 : (_hovered ? 1.04 : 1.0);
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() {
        _hovered = false;
        _pressed = false;
      }),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: widget.onTap,
        onTapDown: (_) => setState(() => _pressed = true),
        onTapUp: (_) => setState(() => _pressed = false),
        onTapCancel: () => setState(() => _pressed = false),
        child: AnimatedScale(
          scale: scale,
          duration: DexMotion.respecting(context, DexMotion.press),
          curve: DexMotion.respectingCurve(context, DexMotion.easeOut),
          child: AnimatedContainer(
            duration: DexMotion.respecting(context, DexMotion.hover),
            curve: DexMotion.respectingCurve(context, DexMotion.dampened),
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  active
                      ? kDexMenuAccentSurfaceHover
                      : kDexMenuAccentSurface,
                  kDexMenuTint,
                ],
              ),
              border: Border.all(
                color: active
                    ? kDexMenuAccentBorderHover
                    : kDexMenuAccentBorder,
              ),
              boxShadow: [
                BoxShadow(
                  color: DexColors.accent.withValues(alpha: active ? 0.28 : 0.16),
                  blurRadius: active ? 24 : 18,
                  spreadRadius: -7,
                  offset: const Offset(0, 10),
                ),
              ],
            ),
            child: const Icon(
              LucideIcons.plus,
              size: 20,
              color: DexColors.accent,
            ),
          ),
        ),
      ),
    );
  }
}

class _SpotlightSuggestionChip extends StatelessWidget {
  const _SpotlightSuggestionChip({
    required this.label,
    required this.onTap,
  });

  final String label;
  final VoidCallback onTap;

  IconData get _icon {
    return switch (label) {
      'Open this file' => LucideIcons.file_search,
      'Summarise this tab' => LucideIcons.panel_top,
      'Take a screenshot' => LucideIcons.scan,
      'Send an email' => LucideIcons.send,
      _ => LucideIcons.sparkles,
    };
  }

  @override
  Widget build(BuildContext context) {
    // Real liquid-glass chip — squash/stretch jelly + glow on press come for
    // free from GlassChip (which composes GlassButton). Premium quality is
    // fine here: the overlay floats over a static desktop, no drifting fog.
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GlassChip(
        label: label,
        onTap: onTap,
        icon: Icon(_icon, color: DexColors.accent),
        iconColor: DexColors.accent,
        labelStyle: DexType.label(color: DexColors.text),
        useOwnLayer: true,
        quality: GlassQuality.minimal,
        settings: kDexChipGlass,
      ),
    );
  }
}

class _SpotlightKeycap extends StatelessWidget {
  const _SpotlightKeycap({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DexSpace.sm,
        vertical: 3,
      ),
      decoration: BoxDecoration(
        color: kDexMenuTint.withValues(alpha: 0.74),
        borderRadius: DexRadius.rsm,
        border: Border.all(color: kDexMenuAccentBorder),
      ),
      child: Text(
        label,
        style: DexType.caption(color: DexColors.accent),
      ),
    );
  }
}

class _DismissIntent extends Intent {
  const _DismissIntent();
}

class _SpotlightPasteIntent extends Intent {
  const _SpotlightPasteIntent();
}
