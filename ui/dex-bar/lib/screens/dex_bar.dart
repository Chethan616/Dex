import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:window_manager/window_manager.dart';

import '../core/gateway_client.dart';
import '../core/theme_controller.dart';
import '../core/window_activity.dart';
import '../core/models.dart';
import '../theme/tokens.dart';
import '../widgets/command_input.dart';
import '../widgets/confirmation_card.dart';
import '../widgets/library_panel.dart';
import '../widgets/primitives/primitives.dart';
import '../widgets/step_stream.dart';
import 'mission_control.dart';

/// The Alt+Space bar. At rest it is one row. It grows downward while a task
/// runs, slides a confirmation card in when approval is needed, and collapses
/// back after the task settles.
class DexBar extends StatefulWidget {
  const DexBar({super.key, required this.client, this.theme});

  final GatewayClient client;
  final ThemeController? theme;

  @override
  State<DexBar> createState() => _DexBarState();
}

/// How long a finished task's result stays on screen before the bar collapses.
const _collapseAfter = Duration(seconds: 6);

/// How much room the step stream may take.
///
/// Two values, because when a confirmation card is up the card is the thing
/// being read and the stream is context. Capping the stream is also what makes
/// the content-measured window height provably bounded: worst case is
/// 56 + 1 + card + [_streamWithCard] + result + suggestion, comfortably under
/// [DexTokens.barMaxHeight], so the bar can never need to clip a card's
/// buttons off the bottom.
const _streamAlone = 440.0;
const _streamWithCard = 170.0;

/// Height change big enough to be a change of state rather than another line
/// of output. Comfortably above one step line (~20px) and well below the
/// smallest state transition (rest to running is ~120px).
const _recentreAt = 80.0;

class _DexBarState extends State<DexBar> {
  final _controller = TextEditingController();
  final _focus = FocusNode();
  final _contentKey = GlobalKey();
  bool _missionControl = false;
  Timer? _collapseTimer;

  GatewayClient get client => widget.client;

  @override
  void initState() {
    super.initState();
    client.addListener(_onClientChanged);
  }

  @override
  void dispose() {
    _collapseTimer?.cancel();
    client.removeListener(_onClientChanged);
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _onClientChanged() {
    if (!mounted) return;
    setState(() {});
    _scheduleCollapse();
  }

  /// A settled task keeps its final line for a beat, then the bar returns to
  /// one row on its own — nothing to dismiss by hand.
  void _scheduleCollapse() {
    final run = client.current;
    final settled = run != null &&
        (run.phase == TaskPhase.done ||
            run.phase == TaskPhase.failed ||
            run.phase == TaskPhase.cancelled);

    if (!settled || _missionControl) {
      _collapseTimer?.cancel();
      _collapseTimer = null;
      return;
    }

    _collapseTimer?.cancel();
    _collapseTimer = Timer(_collapseAfter, () {
      if (!mounted || _missionControl) return;
      if (client.pending.isNotEmpty) return;
      client.clearCurrent();
    });
  }

  /// The workflows / history / usage panel.
  bool _library = false;

  bool get _expanded =>
      _missionControl ||
      _library ||
      client.current != null ||
      client.pending.isNotEmpty ||
      client.connection == CoreConnection.noCore;

  Size? _lastSize;

  /// Fit the window to what is actually on screen.
  ///
  /// The bar used to snap to a fixed 560px the instant a task started, so a
  /// two-line run rendered two lines above a literal `Spacer()`. Nothing below
  /// the input uses `Expanded` any more — every child measures itself — so the
  /// content column's own height is the answer, and asking for it cannot feed
  /// back into it.
  void _fitToContent() {
    if (_missionControl) {
      _applySize(const Size(DexTokens.missionWidth, DexTokens.missionHeight));
      return;
    }
    final box = _contentKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize) return;

    final height = box.size.height
        .ceilToDouble()
        .clamp(DexTokens.barRestHeight, DexTokens.barMaxHeight);
    _applySize(Size(DexTokens.barWidth, height));
  }

  void _applySize(Size size) {
    if (_lastSize == size) return;
    final previous = _lastSize;
    _lastSize = size;

    // window_manager only reports user-driven geometry changes, so mark this
    // one ourselves — once now and once after the animation lands, so the
    // confirmation card's settle clock starts when the window stops moving.
    WindowActivity.markThrough(const Duration(milliseconds: 350));
    // Not animated. The window used to hold two sizes, so a native resize
    // animation was a nice touch between them; now that height tracks content,
    // an animated window lags a content column already laid out at full size,
    // and the difference shows as the last step lines and the result bar
    // sitting below the frame until it catches up. The content has its own
    // entrance animations; the frame should just be the right size.
    windowManager.setSize(size);

    // Re-centre on a step change in size, not on every change.
    //
    // The old bar had two heights and re-centred on both, which was fine.
    // Height now tracks content, so centring on every event would walk the bar
    // up the screen a few pixels at a time while the owner is reading it —
    // `setSize` keeps the top-left anchored, which is the "grows downward" the
    // design asks for.
    //
    // But top-anchored growth alone is wrong too: a bar centred while it was
    // one row tall runs off the bottom of the screen once a confirmation card
    // opens under it, and what falls off is the card's buttons. So a large
    // jump — appearing, a card opening, a task finishing — re-centres and is
    // guaranteed to fit, while line-by-line growth inside a state does not
    // move the window at all.
    final widthChanged = previous == null || previous.width != size.width;
    final stepChange =
        previous != null && (size.height - previous.height).abs() >= _recentreAt;
    if (widthChanged || stepChange) windowManager.center();
  }

  void _submit(String text) {
    client.submit(text);
    _controller.clear();
    _focus.requestFocus();
  }

  void _toggleMissionControl() {
    setState(() => _missionControl = !_missionControl);
  }

  void _dismiss() {
    if (_library) return setState(() => _library = false);
    if (_missionControl) return _toggleMissionControl();
    if (client.current != null &&
        client.current!.phase != TaskPhase.thinking &&
        client.current!.phase != TaskPhase.running) {
      client.clearCurrent();
      return;
    }
    windowManager.hide();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _fitToContent();
    });

    return CallbackShortcuts(
      bindings: {
        const SingleActivator(LogicalKeyboardKey.escape): _dismiss,
        const SingleActivator(LogicalKeyboardKey.keyM, control: true):
            _toggleMissionControl,
      },
      child: Focus(
        autofocus: true,
        child: DragToMoveArea(
          child: Container(
            decoration: BoxDecoration(
              color: t.bg,
              borderRadius: BorderRadius.circular(DexTokens.radiusLg),
              border: Border.all(color: t.border),
              boxShadow: [
                BoxShadow(
                  color: t.shadow,
                  blurRadius: 32,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            clipBehavior: Clip.antiAlias,
            child: _missionControl
                ? MissionControl(
                    client: client,
                    onClose: _toggleMissionControl,
                    theme: widget.theme,
                  )
                : _bar(t),
          ),
        ),
      ),
    );
  }

  Widget _bar(DexTokens t) {
    final run = client.current;
    final live = client.pending.values.toList();
    final streamCap = live.isEmpty ? _streamAlone : _streamWithCard;

    return SingleChildScrollView(
      // Never actually scrolls at the sizes the caps above allow. It is here so
      // that an unusually tall confirmation card — many params, a long
      // description — degrades into something reachable rather than something
      // clipped, and a clipped Approve button is not a failure mode worth
      // risking.
      child: Column(
        key: _contentKey,
        mainAxisSize: MainAxisSize.min,
        children: [
          CommandInput(
            controller: _controller,
            focusNode: _focus,
            phase: run?.phase ?? TaskPhase.idle,
            enabled: client.connection == CoreConnection.connected,
            libraryOpen: _library,
            onSubmit: _submit,
            onCancel: client.cancelCurrent,
            onOpenMissionControl: _toggleMissionControl,
            onOpenLibrary: () => setState(() => _library = !_library),
          ),
          if (_expanded) Divider(height: 1, color: t.border),
          if (client.connection == CoreConnection.noCore)
            _CoreOffline(message: client.connectionError)
          else if (_library)
            LibraryPanel(
              client: client,
              onClose: () => setState(() => _library = false),
            )
          else if (_expanded) ...[
            for (final req in live)
              ConfirmationCard(
                key: ValueKey(req.key),
                request: req,
                onRespond: (verdict) => client.respond(req, verdict),
                onCancelTask: client.cancelCurrent,
              ),
            if (run != null && run.events.isNotEmpty)
              ConstrainedBox(
                constraints: BoxConstraints(maxHeight: streamCap),
                child: StepStream(events: run.events, shrinkWrap: true),
              ),
            if (run?.status != null) _ResultBar(run: run!),
            // Dex noticing repetition is only useful if it says so where the
            // owner is already looking.
            if (client.saveSuggestion != null)
              _SaveSuggestionBar(
                suggestion: client.saveSuggestion!,
                onSave: (name) {
                  client.saveLastAsWorkflow(name);
                  setState(() {});
                },
                onDismiss: () => setState(() => client.saveSuggestion = null),
              ),
          ],
        ],
      ),
    );
  }
}

class _ResultBar extends StatelessWidget {
  const _ResultBar({required this.run});

  final TaskRun run;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final color = switch (run.status) {
      'COMPLETED' => t.eventColor('done'),
      'CANCELLED' => t.eventColor('cancelled'),
      _ => t.eventColor('failed'),
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: DexTokens.spaceLg,
        vertical: DexTokens.spaceMd,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.07),
        border: Border(top: BorderSide(color: t.border)),
      ),
      child: Row(
        children: [
          DexTag(run.status ?? '', tone: color),
          const SizedBox(width: DexTokens.spaceMd),
          Expanded(
            child: Text(
              run.summary ?? '',
              overflow: TextOverflow.ellipsis,
              style: DexType.body(color: t.textMuted),
            ),
          ),
          const SizedBox(width: DexTokens.spaceSm),
          Text(
            '${(run.elapsed.inMilliseconds / 1000).toStringAsFixed(1)}s',
            style: DexType.codeSm(color: t.textFaint),
          ),
        ],
      ),
    );
  }
}

class _CoreOffline extends StatelessWidget {
  const _CoreOffline({this.message});

  final String? message;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: DexTokens.spaceXl,
        vertical: DexTokens.spaceXl,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.power_off_rounded, size: 24, color: t.textFaint),
          const SizedBox(height: DexTokens.spaceMd),
          Text(
            'Core not connected',
            style: DexType.body(color: t.text, strong: true),
          ),
          const SizedBox(height: DexTokens.spaceXs),
          Text(
            message ?? 'Retrying…',
            textAlign: TextAlign.center,
            style: DexType.codeSm(color: t.textMuted),
          ),
        ],
      ),
    );
  }
}

/// "You have done this three times — want to keep it?"
///
/// Shown inline under a finished task rather than as a dialog: the owner is
/// already looking here, and a modal would interrupt something they just
/// successfully finished.
class _SaveSuggestionBar extends StatefulWidget {
  const _SaveSuggestionBar({
    required this.suggestion,
    required this.onSave,
    required this.onDismiss,
  });

  final SaveSuggestion suggestion;
  final ValueChanged<String> onSave;
  final VoidCallback onDismiss;

  @override
  State<_SaveSuggestionBar> createState() => _SaveSuggestionBarState();
}

class _SaveSuggestionBarState extends State<_SaveSuggestionBar> {
  final _name = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  bool get _valid => RegExp(r'^[a-z0-9][a-z0-9_-]*$').hasMatch(_name.text.trim());

  @override
  Widget build(BuildContext context) {
    final t = context.dex;

    return Container(
      margin: const EdgeInsets.fromLTRB(
        DexTokens.spaceLg,
        0,
        DexTokens.spaceLg,
        DexTokens.spaceSm,
      ),
      padding: const EdgeInsets.all(DexTokens.spaceSm),
      decoration: BoxDecoration(
        color: t.neutral.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(DexTokens.radiusSm),
        border: Border.all(color: t.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              'Done this ${widget.suggestion.times}× — save it as a workflow?',
              style: DexType.caption(color: t.textMuted),
            ),
          ),
          const SizedBox(width: DexTokens.spaceSm),
          DexField(
            controller: _name,
            hint: 'name',
            mono: true,
            width: 116,
            onChanged: (_) => setState(() {}),
            onSubmitted: (_) {
              if (_valid) widget.onSave(_name.text.trim());
            },
          ),
          const SizedBox(width: DexTokens.spaceXs),
          DexButton(
            label: 'Save',
            dense: true,
            tone: t.positive,
            variant: DexButtonVariant.primary,
            enabled: _valid,
            onTap: () => widget.onSave(_name.text.trim()),
          ),
          DexIconButton(
            icon: Icons.close,
            tooltip: 'Dismiss',
            size: 14,
            onTap: widget.onDismiss,
          ),
        ],
      ),
    );
  }
}
