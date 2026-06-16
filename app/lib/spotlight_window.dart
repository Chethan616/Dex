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
import 'theme/theme.dart';
import 'theme/tokens.dart';
import 'widgets/composer/attachments.dart';
import 'widgets/dex_glass.dart';
import 'widgets/glass_badge_button.dart';
import 'widgets/home/suggestion_chip.dart';

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
      size: Size(640, 360),
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
              alignment: const Alignment(0, -0.55),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  AttachmentStrip(
                    items: _attachments,
                    onRemove: _removeAttachment,
                  ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Flexible(
                        // Neutral frosted liquid glass — the previous overlay
                        // look, no blue accent / glow. DexGlass carries the
                        // frost + soft shadow; RepaintBoundary isolates the
                        // caret so it can't re-dirty the backdrop each tick.
                        child: DexGlass(
                          radius: 28,
                          padding: const EdgeInsets.fromLTRB(
                            DexSpace.lg, DexSpace.md, DexSpace.lg, DexSpace.md,
                          ),
                          child: RepaintBoundary(
                              child: Row(
                                  children: [
                                    const Icon(LucideIcons.search,
                                        size: 20, color: DexColors.textDim),
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
                      // Trailing + badge — tapping it opens the liquid-glass
                      // GlassMenu (teardrop morph) with the attach actions,
                      // the overlay you had before.
                      const SizedBox(width: 12),
                      GlassMenu(
                        quality: GlassQuality.premium,
                        menuWidth: 240,
                        selectionColor:
                            DexColors.accent.withValues(alpha: 0.28),
                        triggerBuilder: (context, toggle) => GlassBadgeButton(
                          icon: LucideIcons.plus,
                          onTap: toggle,
                          size: 52,
                        ),
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

class _SpotlightPasteIntent extends Intent {
  const _SpotlightPasteIntent();
}
