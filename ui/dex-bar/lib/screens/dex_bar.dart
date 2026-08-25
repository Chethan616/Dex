import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:window_manager/window_manager.dart';

import '../core/gateway_client.dart';
import '../core/window_activity.dart';
import '../core/models.dart';
import '../theme/tokens.dart';
import '../widgets/command_input.dart';
import '../widgets/confirmation_card.dart';
import '../widgets/step_stream.dart';
import 'mission_control.dart';

/// The Alt+Space bar. At rest it is one row. It grows downward while a task
/// runs, slides a confirmation card in when approval is needed, and collapses
/// back after the task settles.
class DexBar extends StatefulWidget {
  const DexBar({super.key, required this.client});

  final GatewayClient client;

  @override
  State<DexBar> createState() => _DexBarState();
}

/// How long a finished task's result stays on screen before the bar collapses.
const _collapseAfter = Duration(seconds: 6);

class _DexBarState extends State<DexBar> {
  final _controller = TextEditingController();
  final _focus = FocusNode();
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
    setState(_resize);
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

  bool get _expanded =>
      _missionControl ||
      client.current != null ||
      client.pending.isNotEmpty ||
      client.connection == CoreConnection.noCore;

  Size? _lastSize;

  /// Only touch the window when the target size actually changes. Resizing and
  /// re-centring on every event would shuffle the window under the pointer
  /// while the owner is trying to read it.
  void _resize() {
    final size = _missionControl
        ? const Size(DexTokens.missionWidth, DexTokens.missionHeight)
        : Size(
            DexTokens.barWidth,
            _expanded ? DexTokens.barActiveHeight : DexTokens.barRestHeight,
          );
    if (_lastSize == size) return;
    _lastSize = size;

    // window_manager only reports user-driven geometry changes, so mark this
    // one ourselves — once now and once after the animation lands, so the
    // confirmation card's settle clock starts when the window stops moving.
    WindowActivity.markThrough(const Duration(milliseconds: 350));
    windowManager.setSize(size, animate: true);
    if (!_missionControl) windowManager.center();
  }

  void _submit(String text) {
    client.submit(text);
    _controller.clear();
    _focus.requestFocus();
    _resize();
  }

  void _toggleMissionControl() {
    setState(() => _missionControl = !_missionControl);
    _resize();
  }

  void _dismiss() {
    if (_missionControl) return _toggleMissionControl();
    if (client.current != null &&
        client.current!.phase != TaskPhase.thinking &&
        client.current!.phase != TaskPhase.running) {
      client.clearCurrent();
      _resize();
      return;
    }
    windowManager.hide();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final run = client.current;
    final live = client.pending.values.toList();

    return CallbackShortcuts(
      bindings: {
        const SingleActivator(LogicalKeyboardKey.escape): _dismiss,
        const SingleActivator(LogicalKeyboardKey.keyM, control: true): _toggleMissionControl,
      },
      child: Focus(
        autofocus: true,
        child: DragToMoveArea(
          child: Container(
            decoration: BoxDecoration(
              color: t.bg,
              borderRadius: BorderRadius.circular(DexTokens.radiusLg),
              border: Border.all(color: t.border),
              boxShadow: [BoxShadow(color: t.shadow, blurRadius: 32, offset: const Offset(0, 8))],
            ),
            clipBehavior: Clip.antiAlias,
            child: _missionControl
                ? MissionControl(client: client, onClose: _toggleMissionControl)
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      CommandInput(
                        controller: _controller,
                        focusNode: _focus,
                        phase: run?.phase ?? TaskPhase.idle,
                        enabled: client.connection == CoreConnection.connected,
                        onSubmit: _submit,
                        onCancel: client.cancelCurrent,
                        onOpenMissionControl: _toggleMissionControl,
                      ),
                      if (_expanded) Divider(height: 1, color: t.border),
                      if (client.connection == CoreConnection.noCore)
                        Expanded(child: _CoreOffline(message: client.connectionError))
                      else if (_expanded) ...[
                        for (final req in live)
                          ConfirmationCard(
                            key: ValueKey(req.key),
                            request: req,
                            onRespond: (verdict) => client.respond(req, verdict),
                            onCancelTask: client.cancelCurrent,
                          ),
                        if (run != null)
                          Expanded(child: StepStream(events: run.events))
                        else
                          const Spacer(),
                        if (run?.status != null) _ResultBar(run: run!),
                      ],
                    ],
                  ),
          ),
        ),
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
          Text(
            run.status ?? '',
            style: DexType.mono(size: 11, color: color, weight: FontWeight.w600, spacing: 0.5),
          ),
          const SizedBox(width: DexTokens.spaceMd),
          Expanded(
            child: Text(
              run.summary ?? '',
              overflow: TextOverflow.ellipsis,
              style: DexType.sans(size: 12.5, color: t.textMuted),
            ),
          ),
          Text(
            '${(run.elapsed.inMilliseconds / 1000).toStringAsFixed(1)}s',
            style: DexType.mono(size: 11, color: t.textFaint),
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
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(DexTokens.spaceXl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.power_off_rounded, size: 26, color: t.textFaint),
            const SizedBox(height: DexTokens.spaceMd),
            Text(
              'Core not connected',
              style: DexType.sans(size: 14, color: t.text, weight: FontWeight.w500),
            ),
            const SizedBox(height: DexTokens.spaceXs),
            Text(
              message ?? 'Retrying…',
              textAlign: TextAlign.center,
              style: DexType.mono(size: 11.5, color: t.textMuted),
            ),
          ],
        ),
      ),
    );
  }
}
