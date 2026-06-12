// The chat composer. Used in EmptyHome (centered, large) and ChatView
// (docked bottom, full-width). Acrylic surface with the + menu, the mode
// pill, vision and voice buttons, and a send affordance.

import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import 'package:super_drag_and_drop/super_drag_and_drop.dart';

import '../../core/prompt_history.dart';
import '../../core/send_options.dart';
import '../../theme/tokens.dart';
import '../living_background.dart';
import '../refractive_edge.dart';
import 'add_menu.dart';
import 'attachments.dart';
import 'composer_mode.dart';
import 'mode_menu.dart';

class DexComposer extends StatefulWidget {
  const DexComposer({
    super.key,
    required this.onSubmit,
    this.onStop,
    this.isBusy = false,
    this.hint = 'Message Dex',
    this.autofocus = true,
    this.onVision,
    this.onVoice,
    this.onAddAction,
  });

  final ValueChanged<String> onSubmit;
  final VoidCallback? onStop;
  final bool isBusy;
  final String hint;
  final bool autofocus;
  final VoidCallback? onVision;
  final VoidCallback? onVoice;
  final ValueChanged<ComposerAddAction>? onAddAction;

  @override
  State<DexComposer> createState() => _DexComposerState();
}

class _DexComposerState extends State<DexComposer> {
  late final TextEditingController _ctrl;
  late final FocusNode _focus;
  ComposerMode _mode = ComposerMode.smart;
  bool _hasText = false;

  // Shell-style prompt recall. -1 = live input; 0+ = offset back into
  // PromptHistory (0 = most recent). _draft stashes whatever the user had
  // typed before they started browsing history so arrow-down returns it.
  int _historyIndex = -1;
  String _historyDraft = '';
  bool _applyingHistory = false;

  // Attachments ride along with the next submitted prompt. The chip
  // strip above the input shows them; submit/clear empties the list.
  final List<AttachedItem> _attachments = <AttachedItem>[];

  final GlobalKey _addKey = GlobalKey();
  final GlobalKey _modeKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    _ctrl = TextEditingController();
    _ctrl.addListener(_onText);
    _focus = FocusNode();
    if (widget.autofocus) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _focus.requestFocus());
    }
  }

  @override
  void dispose() {
    _ctrl.removeListener(_onText);
    _ctrl.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _onText() {
    final has = _ctrl.text.trim().isNotEmpty;
    if (has != _hasText) setState(() => _hasText = has);
    // A manual edit ends history browsing -- the recalled prompt becomes
    // the live draft (guard skips the programmatic recall writes).
    if (!_applyingHistory) _historyIndex = -1;
    // No per-keystroke fog pulse: rapid typing read as flicker. The
    // fog breathes continuously on its own (see LivingBackground);
    // only submission fires a flare.
  }

  void _submit() {
    final t = _ctrl.text.trim();
    if (t.isEmpty && _attachments.isEmpty) return;
    // Stronger flare on submission than on a keystroke -- the fog
    // visibly "answers" the send.
    LivingBackground.of(context)?.pulse(0.8);
    PromptHistory.instance.push(t);
    _historyIndex = -1;
    // Map the mode pill onto real chat.send params (see SendOptions).
    switch (_mode) {
      case ComposerMode.fast:
        SendOptions.fastMode = true;
        SendOptions.thinking = 'off';
        break;
      case ComposerMode.deeper:
        SendOptions.fastMode = null;
        SendOptions.thinking = 'high';
        break;
      case ComposerMode.smart:
      case ComposerMode.study:
      case ComposerMode.search:
        SendOptions.clear();
        break;
    }
    widget.onSubmit(t);
    _ctrl.clear();
    if (_attachments.isNotEmpty) {
      setState(_attachments.clear);
    }
    _focus.requestFocus();
  }

  // ---- shell-style history recall (up/down arrows) ----

  void _recallPrev() {
    final sel = _ctrl.selection;
    // Only when the caret sits at the very start (or the field is empty):
    // inside multi-line text, arrow-up must keep navigating lines.
    final atStart =
        _ctrl.text.isEmpty || (sel.isCollapsed && sel.baseOffset <= 0);
    if (!atStart) return;
    final h = PromptHistory.instance.entries;
    if (h.isEmpty || _historyIndex >= h.length - 1) return;
    if (_historyIndex < 0) _historyDraft = _ctrl.text;
    _historyIndex += 1;
    _applyHistoryText(h[h.length - 1 - _historyIndex]);
  }

  void _recallNext() {
    if (_historyIndex < 0) return;
    final sel = _ctrl.selection;
    final atEnd = sel.isCollapsed && sel.baseOffset >= _ctrl.text.length;
    if (!atEnd) return;
    _historyIndex -= 1;
    final h = PromptHistory.instance.entries;
    _applyHistoryText(
      _historyIndex < 0 ? _historyDraft : h[h.length - 1 - _historyIndex],
    );
  }

  void _applyHistoryText(String text) {
    _applyingHistory = true;
    _ctrl.value = TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
    _applyingHistory = false;
  }

  void _addAttachments(List<AttachedItem> items) {
    if (items.isEmpty || !mounted) return;
    setState(() => _attachments.addAll(items));
  }

  void _removeAttachment(String id) {
    setState(() => _attachments.removeWhere((a) => a.id == id));
  }

  Future<void> _pasteFromClipboard() async {
    // Ctrl+V intercept: if the clipboard has rich content (image / file
    // / long text), capture it as an attachment. Plain short text falls
    // through to the default TextField paste so it still lands in the
    // input buffer.
    final items = await extractClipboardItems();
    if (items.isNotEmpty) {
      _addAttachments(items);
    } else {
      // Fall through to native paste for plain short text.
      _focus.requestFocus();
    }
  }

  Future<void> _openAdd() async {
    final ctx = _addKey.currentContext;
    if (ctx == null) return;
    final box = ctx.findRenderObject() as RenderBox?;
    if (box == null) return;
    final trigger = box.localToGlobal(Offset.zero) & box.size;
    final picked = await AddMenu.show(context: context, trigger: trigger);
    if (picked != null) widget.onAddAction?.call(picked);
  }

  Future<void> _openMode() async {
    final ctx = _modeKey.currentContext;
    if (ctx == null) return;
    final box = ctx.findRenderObject() as RenderBox?;
    if (box == null) return;
    final trigger = box.localToGlobal(Offset.zero) & box.size;
    final picked = await ModeMenu.show(
      context: context, trigger: trigger, current: _mode,
    );
    if (picked != null && mounted) setState(() => _mode = picked);
  }

  @override
  Widget build(BuildContext context) {
    return DropRegion(
      formats: kAcceptedDropFormats,
      hitTestBehavior: HitTestBehavior.opaque,
      onDropOver: (event) async {
        // Accept the drop -- super_drag_and_drop wants us to declare
        // intent here so the OS shows the right "copy" cursor over
        // the composer pill.
        return DropOperation.copy;
      },
      onPerformDrop: (event) async {
        final items = await extractDroppedItems(event);
        _addAttachments(items);
      },
      child: Shortcuts(
        shortcuts: const <ShortcutActivator, Intent>{
          SingleActivator(LogicalKeyboardKey.keyK, control: true):
              _FocusComposerIntent(),
          SingleActivator(LogicalKeyboardKey.keyK, meta: true):
              _FocusComposerIntent(),
          // Ctrl+V / Cmd+V → rich paste path. If the clipboard holds
          // an image / file / long text we capture it as an attachment;
          // short plain text falls through to the default TextField
          // paste so the user can still paste short snippets normally.
          SingleActivator(LogicalKeyboardKey.keyV, control: true):
              _PasteIntent(),
          SingleActivator(LogicalKeyboardKey.keyV, meta: true):
              _PasteIntent(),
        },
        child: Actions(
          actions: <Type, Action<Intent>>{
            _FocusComposerIntent:
                CallbackAction<_FocusComposerIntent>(onInvoke: (_) {
              _focus.requestFocus();
              return null;
            }),
            _PasteIntent: CallbackAction<_PasteIntent>(onInvoke: (_) {
              _pasteFromClipboard();
              return null;
            }),
          },
          child: DecoratedBox(
          // Shadow lives on the OUTER box so it isn't clipped by the
          // rounded-rect mask -- the previous structure had the shadow
          // on the Container _inside_ ClipRRect, which silently
          // swallowed the lift.
          decoration: const BoxDecoration(
            borderRadius: DexRadius.rxl,
            boxShadow: DexSurface.glossyShadow,
          ),
          child: RefractiveEdge(
            radius: DexRadius.rxl,
            child: BackdropFilter(
              filter: ImageFilter.blur(
                sigmaX: DexSurface.blurSigma,
                sigmaY: DexSurface.blurSigma,
              ),
              child: Container(
                decoration: BoxDecoration(
                  gradient: DexSurface.glossyGradient(),
                ),
                padding: const EdgeInsets.fromLTRB(
                  DexSpace.lg, DexSpace.md, DexSpace.md, DexSpace.sm,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    AttachmentStrip(
                      items: _attachments,
                      onRemove: _removeAttachment,
                    ),
                    _Input(
                      controller: _ctrl,
                      focusNode: _focus,
                      hint: widget.hint,
                      onSubmit: _submit,
                      onHistoryPrev: _recallPrev,
                      onHistoryNext: _recallNext,
                    ),
                    const SizedBox(height: DexSpace.sm),
                    _Toolbar(
                      addKey: _addKey,
                      modeKey: _modeKey,
                      mode: _mode,
                      isBusy: widget.isBusy,
                      hasText: _hasText,
                      onAdd: _openAdd,
                      onMode: _openMode,
                      onVision: widget.onVision,
                      onVoice: widget.onVoice,
                      onStop: widget.onStop,
                      onSubmit: _submit,
                    ),
                  ],
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

class _Input extends StatelessWidget {
  const _Input({
    required this.controller,
    required this.focusNode,
    required this.hint,
    required this.onSubmit,
    this.onHistoryPrev,
    this.onHistoryNext,
  });
  final TextEditingController controller;
  final FocusNode focusNode;
  final String hint;
  final VoidCallback onSubmit;
  final VoidCallback? onHistoryPrev;
  final VoidCallback? onHistoryNext;

  @override
  Widget build(BuildContext context) {
    return KeyboardListener(
      focusNode: FocusNode(skipTraversal: true),
      onKeyEvent: (e) {
        if (e is! KeyDownEvent) return;
        if (e.logicalKey == LogicalKeyboardKey.enter &&
            !HardwareKeyboard.instance.isShiftPressed) {
          onSubmit();
        } else if (e.logicalKey == LogicalKeyboardKey.arrowUp) {
          onHistoryPrev?.call();
        } else if (e.logicalKey == LogicalKeyboardKey.arrowDown) {
          onHistoryNext?.call();
        }
      },
      child: TextField(
        controller: controller,
        focusNode: focusNode,
        maxLines: 6,
        minLines: 1,
        style: DexType.body(color: DexColors.text),
        decoration: InputDecoration(
          isCollapsed: true,
          contentPadding: const EdgeInsets.symmetric(vertical: DexSpace.sm),
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          filled: false,
          hintText: hint,
          hintStyle: DexType.body(color: DexColors.textFaint),
        ),
        textInputAction: TextInputAction.newline,
      ),
    );
  }
}

class _Toolbar extends StatelessWidget {
  const _Toolbar({
    required this.addKey,
    required this.modeKey,
    required this.mode,
    required this.isBusy,
    required this.hasText,
    required this.onAdd,
    required this.onMode,
    required this.onVision,
    required this.onVoice,
    required this.onStop,
    required this.onSubmit,
  });

  final GlobalKey addKey;
  final GlobalKey modeKey;
  final ComposerMode mode;
  final bool isBusy;
  final bool hasText;
  final VoidCallback onAdd;
  final VoidCallback onMode;
  final VoidCallback? onVision;
  final VoidCallback? onVoice;
  final VoidCallback? onStop;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _RoundIconButton(
          key: addKey,
          icon: LucideIcons.plus,
          tooltip: 'Add files, image, research...',
          onTap: onAdd,
        ),
        const SizedBox(width: DexSpace.sm),
        _ModePill(key: modeKey, mode: mode, onTap: onMode),
        const Spacer(),
        if (onVision != null)
          _RoundIconButton(
            icon: LucideIcons.glasses,
            tooltip: 'Share screen with Dex',
            onTap: onVision,
          ),
        if (onVoice != null) ...[
          const SizedBox(width: DexSpace.xs),
          _RoundIconButton(
            icon: LucideIcons.mic,
            tooltip: 'Talk to Dex',
            onTap: onVoice,
          ),
        ],
        const SizedBox(width: DexSpace.xs),
        if (isBusy && onStop != null)
          _RoundIconButton(
            icon: LucideIcons.square,
            tooltip: 'Stop',
            tint: DexColors.stateError,
            onTap: onStop,
          )
        else
          _SendButton(enabled: hasText, onTap: onSubmit),
      ],
    );
  }
}

class _RoundIconButton extends StatelessWidget {
  const _RoundIconButton({
    super.key,
    required this.icon,
    required this.tooltip,
    required this.onTap,
    this.tint,
  });
  final IconData icon;
  final String tooltip;
  final VoidCallback? onTap;
  final Color? tint;

  @override
  Widget build(BuildContext context) {
    final color = tint ?? DexColors.textDim;
    return MouseRegion(
      cursor: onTap != null
          ? SystemMouseCursors.click
          : SystemMouseCursors.basic,
      child: Tooltip(
        message: tooltip,
        child: InkResponse(
          onTap: onTap,
          radius: 20,
          child: Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: DexColors.surface.withValues(alpha: 0.4),
              shape: BoxShape.circle,
              border: Border.all(color: DexColors.border),
            ),
            child: Icon(icon, size: 18, color: color),
          ),
        ),
      ),
    );
  }
}

class _SendButton extends StatelessWidget {
  const _SendButton({required this.enabled, required this.onTap});
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: enabled ? SystemMouseCursors.click : SystemMouseCursors.basic,
      child: Tooltip(
        message: 'Send (Enter)',
        child: InkResponse(
          onTap: enabled ? onTap : null,
          radius: 20,
          child: Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: enabled ? DexColors.accent : DexColors.surface,
              shape: BoxShape.circle,
              border: Border.all(
                color: enabled ? DexColors.accent : DexColors.border,
              ),
            ),
            child: Icon(
              LucideIcons.arrow_up,
              size: 18,
              color: enabled ? DexColors.bg : DexColors.textFaint,
            ),
          ),
        ),
      ),
    );
  }
}

class _ModePill extends StatelessWidget {
  const _ModePill({super.key, required this.mode, required this.onTap});
  final ComposerMode mode;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: InkWell(
        onTap: onTap,
        borderRadius: DexRadius.rpill,
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: DexSpace.md, vertical: 6,
          ),
          decoration: BoxDecoration(
            color: DexColors.surface.withValues(alpha: 0.4),
            borderRadius: DexRadius.rpill,
            border: Border.all(color: DexColors.border),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(mode.icon, size: 14, color: DexColors.textDim),
              const SizedBox(width: DexSpace.xs),
              Text(mode.label, style: DexType.label(color: DexColors.text)),
              const SizedBox(width: 2),
              const Icon(LucideIcons.chevron_down,
                  size: 14, color: DexColors.textDim),
            ],
          ),
        ),
      ),
    );
  }
}

class _FocusComposerIntent extends Intent {
  const _FocusComposerIntent();
}

class _PasteIntent extends Intent {
  const _PasteIntent();
}
