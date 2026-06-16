// The chat composer. Used in EmptyHome (centered, large) and ChatView
// (docked bottom, full-width). Acrylic surface with the + menu, the mode
// pill, vision and voice buttons, and a send affordance.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_lucide/flutter_lucide.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

import 'package:super_drag_and_drop/super_drag_and_drop.dart';

import '../../core/prompt_history.dart';
import '../../core/send_options.dart';
import '../../theme/tokens.dart';
import '../dex_glass.dart';
import '../living_background.dart';
import 'add_menu.dart';
import 'attachments.dart';
import 'composer_mode.dart';
import 'slash_commands.dart';

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
    this.onClear,
  });

  final ValueChanged<String> onSubmit;
  final VoidCallback? onStop;
  final bool isBusy;
  final String hint;
  final bool autofocus;
  final VoidCallback? onVision;
  final VoidCallback? onVoice;
  final ValueChanged<ComposerAddAction>? onAddAction;

  /// Clears the current conversation (used by the /clear slash command).
  final VoidCallback? onClear;

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

  // Slash palette: visible while the user is typing a command NAME
  // (`/` with no space yet). `_slashToken` is the text after the slash.
  String? _slashToken;

  void _onText() {
    final has = _ctrl.text.trim().isNotEmpty;
    final text = _ctrl.text;
    final token = (text.startsWith('/') && !text.contains(' '))
        ? text.substring(1)
        : null;
    if (has != _hasText || token != _slashToken) {
      setState(() {
        _hasText = has;
        _slashToken = token;
      });
    }
    // A manual edit ends history browsing -- the recalled prompt becomes
    // the live draft (guard skips the programmatic recall writes).
    if (!_applyingHistory) _historyIndex = -1;
    // No per-keystroke fog pulse: rapid typing read as flicker. The
    // fog breathes continuously on its own (see LivingBackground);
    // only submission fires a flare.
  }

  /// Run a palette pick: commands with args get `/name ` written so the
  /// user can add args; arg-less commands run immediately.
  Future<void> _runCommand(SlashCommand cmd) async {
    if (cmd.argsHint.isNotEmpty) {
      _applyHistoryText('/${cmd.name} ');
      setState(() => _slashToken = null);
      _focus.requestFocus();
      return;
    }
    _ctrl.clear();
    setState(() => _slashToken = null);
    await SlashCommands.handle(_slashCtx(), '/${cmd.name}');
  }

  SlashContext _slashCtx() => SlashContext(
        context: context,
        sendMessage: widget.onSubmit,
        onStop: widget.onStop,
        onClear: widget.onClear,
      );

  Future<void> _submit() async {
    final t = _ctrl.text.trim();
    if (t.isEmpty && _attachments.isEmpty) return;
    // Slash commands run locally and never reach the agent.
    if (SlashCommands.looksLikeCommand(t)) {
      _ctrl.clear();
      setState(() => _slashToken = null);
      await SlashCommands.handle(_slashCtx(), t);
      _focus.requestFocus();
      return;
    }
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
    // Rich content (image / file) becomes an attachment chip.
    final items = await extractClipboardItems();
    if (items.isNotEmpty) {
      _addAttachments(items);
      return;
    }
    // Plain text: the Ctrl+V Shortcut intercepts the default TextField
    // paste, so insert the clipboard text at the caret ourselves.
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text;
    if (text == null || text.isEmpty) {
      _focus.requestFocus();
      return;
    }
    final sel = _ctrl.selection;
    final start = sel.isValid ? sel.start : _ctrl.text.length;
    final end = sel.isValid ? sel.end : _ctrl.text.length;
    final next = _ctrl.text.replaceRange(start, end, text);
    _ctrl.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: start + text.length),
    );
    _focus.requestFocus();
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
          child: DexGlass(
            radius: 28,
            // Flicker-free clear-crystal glass: rim:false swaps the package's
            // animated specular edge (the "flickering edge light") for a baked
            // static sheen, and the clear white tint matches the toolbar + and
            // mode pill so it reads as bright crystal, not a grey panel.
            rim: false,
            tint: const Color.fromRGBO(255, 255, 255, 0.10),
            padding: const EdgeInsets.fromLTRB(
              DexSpace.lg, DexSpace.md, DexSpace.md, DexSpace.sm,
            ),
            child: RepaintBoundary(
              child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AttachmentStrip(
                  items: _attachments,
                  onRemove: _removeAttachment,
                ),
                if (_slashToken != null)
                  _SlashPalette(
                    token: _slashToken!,
                    onPick: _runCommand,
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
                  mode: _mode,
                  isBusy: widget.isBusy,
                  hasText: _hasText,
                  onAddAction: widget.onAddAction,
                  onModeSelected: (m) => setState(() => _mode = m),
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
    required this.mode,
    required this.isBusy,
    required this.hasText,
    required this.onAddAction,
    required this.onModeSelected,
    required this.onVision,
    required this.onVoice,
    required this.onStop,
    required this.onSubmit,
  });

  final ComposerMode mode;
  final bool isBusy;
  final bool hasText;
  final ValueChanged<ComposerAddAction>? onAddAction;
  final ValueChanged<ComposerMode> onModeSelected;
  final VoidCallback? onVision;
  final VoidCallback? onVoice;
  final VoidCallback? onStop;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        GlassMenu(
          quality: GlassQuality.premium,
          menuWidth: 264,
          selectionColor: DexColors.accent.withValues(alpha: 0.28),
          triggerBuilder: (context, toggle) => _RoundIconButton(
            icon: LucideIcons.plus,
            onTap: toggle,
          ),
          items: [
            for (final a in ComposerAddAction.values)
              GlassMenuItem(
                title: a.label,
                icon: Icon(a.icon),
                onTap: () => onAddAction?.call(a),
              ),
          ],
        ),
        const SizedBox(width: DexSpace.sm),
        GlassMenu(
          quality: GlassQuality.premium,
          menuWidth: 280,
          selectionColor: DexColors.accent.withValues(alpha: 0.28),
          triggerBuilder: (context, toggle) =>
              _ModePill(mode: mode, onTap: toggle),
          items: [
            for (final m in ComposerMode.values)
              GlassMenuItem(
                title: m.label,
                // Accent selection pill on the active mode — the accent-on-
                // open look of the voice-settings Language dropdown.
                isSelected: m == mode,
                icon: Icon(
                  m.icon,
                  color: m == mode ? DexColors.accent : DexColors.textDim,
                ),
                onTap: () => onModeSelected(m),
              ),
          ],
        ),
        const Spacer(),
        if (onVision != null)
          _RoundIconButton(
            icon: LucideIcons.glasses,
            onTap: onVision,
          ),
        if (onVoice != null) ...[
          const SizedBox(width: DexSpace.xs),
          _RoundIconButton(
            icon: LucideIcons.mic,
            onTap: onVoice,
          ),
        ],
        const SizedBox(width: DexSpace.xs),
        if (isBusy && onStop != null)
          _RoundIconButton(
            icon: LucideIcons.square,
            tint: DexColors.stateError,
            onTap: onStop,
          )
        else
          _SendButton(enabled: hasText, onTap: onSubmit),
      ],
    );
  }
}

/// Clear-crystal glass toolbar button — the EXACT material of the mode pill
/// (own layer, minimal quality, white-0.10 tint) so +, vision, voice and send
/// read as one set with the mode pill beside them. No tooltip, no glow.
class _GlassToolButton extends StatelessWidget {
  const _GlassToolButton({required this.icon, required this.onTap});
  final Widget icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: onTap != null
          ? SystemMouseCursors.click
          : SystemMouseCursors.basic,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: GlassContainer(
          useOwnLayer: true,
          quality: GlassQuality.minimal,
          shape: const LiquidRoundedSuperellipse(borderRadius: 16),
          settings: const LiquidGlassSettings(
            glassColor: Color.fromRGBO(255, 255, 255, 0.10),
            blur: 8,
            thickness: 10,
          ),
          padding: const EdgeInsets.all(9),
          child: icon,
        ),
      ),
    );
  }
}

class _RoundIconButton extends StatelessWidget {
  const _RoundIconButton({
    required this.icon,
    required this.onTap,
    this.tint,
  });
  final IconData icon;
  final VoidCallback? onTap;
  final Color? tint;

  @override
  Widget build(BuildContext context) {
    return _GlassToolButton(
      onTap: onTap,
      icon: Icon(icon, size: 18, color: tint ?? DexColors.textDim),
    );
  }
}

class _SendButton extends StatelessWidget {
  const _SendButton({required this.enabled, required this.onTap});
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return _GlassToolButton(
      onTap: enabled ? onTap : null,
      icon: Icon(
        LucideIcons.arrow_up,
        size: 18,
        color: enabled ? DexColors.accent : DexColors.textFaint,
      ),
    );
  }
}

class _ModePill extends StatelessWidget {
  const _ModePill({required this.mode, required this.onTap});
  final ComposerMode mode;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // Clear crystal glass pill that matches the round + button (same
    // near-transparent glass, neutral glyphs) instead of a tinted chip.
    // Its backdrop is the composer's static frost, so the rim doesn't
    // shimmer.
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: GlassContainer(
          useOwnLayer: true,
          quality: GlassQuality.minimal,
          shape: const LiquidRoundedSuperellipse(borderRadius: 18),
          settings: const LiquidGlassSettings(
            glassColor: Color.fromRGBO(255, 255, 255, 0.10),
            blur: 8,
            thickness: 10,
          ),
          padding: const EdgeInsets.symmetric(
            horizontal: DexSpace.md, vertical: 6,
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

// Live command palette shown above the input while typing `/name`.
class _SlashPalette extends StatelessWidget {
  const _SlashPalette({required this.token, required this.onPick});
  final String token;
  final ValueChanged<SlashCommand> onPick;

  @override
  Widget build(BuildContext context) {
    final matches = SlashCommands.matching(token);
    if (matches.isEmpty) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(bottom: DexSpace.sm),
      constraints: const BoxConstraints(maxHeight: 220),
      decoration: BoxDecoration(
        color: DexColors.surface.withValues(alpha: 0.6),
        borderRadius: DexRadius.rmd,
        border: Border.all(color: DexColors.border),
      ),
      child: ListView(
        shrinkWrap: true,
        padding: const EdgeInsets.all(DexSpace.xs),
        children: [
          for (final c in matches)
            MouseRegion(
              cursor: SystemMouseCursors.click,
              child: InkWell(
                onTap: () => onPick(c),
                borderRadius: DexRadius.rsm,
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                      horizontal: DexSpace.sm, vertical: DexSpace.sm),
                  child: Row(
                    children: [
                      Icon(c.icon, size: 15, color: DexColors.textDim),
                      const SizedBox(width: DexSpace.sm),
                      Text('/${c.name}',
                          style: DexType.mono(color: DexColors.text)
                              .copyWith(fontSize: 12.5)),
                      if (c.argsHint.isNotEmpty) ...[
                        const SizedBox(width: 6),
                        Text(c.argsHint,
                            style: DexType.caption(color: DexColors.textFaint)),
                      ],
                      const SizedBox(width: DexSpace.md),
                      Expanded(
                        child: Text(c.description,
                            style: DexType.caption(color: DexColors.textDim),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
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
