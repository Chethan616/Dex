// Step row — agent-zero-style compact step line in the conversation.
//
// Where the old ToolChip announced "Claude picked tool X" as a pill, the
// step row renders every tool call the way agent-zero's web UI does:
//
//   [EXE] Get-ItemProperty 'HKCU:\Control Panel\Desktop'   · done 0.4s
//   [WIN] open notepad and write hello                     · running
//
// One collapsed line per step, expandable on click to the full detail
// (args, summary, output lines) pulled from the correlated ToolActivity.
// Everything renders from raw gateway events — the LLM never has to
// narrate what it's doing, which is both faster and cheaper.
//
// Ported concept (MIT) from agent-zero's process-step UI
// (vendor/agent-zero/webui — GEN/EXE/USE/WWW badges + expand-on-click).

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../core/models/message.dart';
import '../../core/models/tool_activity.dart';
import '../../theme/motion.dart';
import '../../theme/tokens.dart';
import '../tool_chip.dart' show EnginePill;

/// 3-letter step code + its accent color, derived from the raw tool id.
(String, Color) stepBadgeFor(String toolId) {
  final t = toolId.toLowerCase();
  if (t.contains('desktop')) return ('WIN', DexColors.stateActing);
  if (t.contains('browser')) return ('WWW', DexColors.accent);
  if (t == 'exec' || t == 'bash' || t.contains('process')) {
    return ('EXE', DexColors.stateThinking);
  }
  if (t.contains('omniparser') || t.contains('parse_screen')) {
    return ('EYE', DexColors.stateAwaiting);
  }
  if (t == 'message') return ('MSG', DexColors.stateApprove);
  if (t == 'read' || t == 'write' || t == 'edit' || t == 'apply_patch') {
    return ('DOC', DexColors.textDim);
  }
  return ('USE', DexColors.stateAwaiting);
}

class StepRow extends StatefulWidget {
  const StepRow({super.key, required this.message, this.activity});

  /// The toolChip-speaker message announcing the call.
  final Message message;

  /// Correlated activity (matched by callId) carrying args + output.
  final ToolActivity? activity;

  @override
  State<StepRow> createState() => _StepRowState();
}

class _StepRowState extends State<StepRow> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final m = widget.message;
    final a = widget.activity;
    final (code, color) = stepBadgeFor(m.toolId ?? 'unknown');
    final state = m.chipState ?? ToolChipState.running;
    final heading = (a?.goalLabel ?? m.toolGoal ?? m.toolId ?? '').trim();

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          MouseRegion(
            cursor: SystemMouseCursors.click,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => setState(() => _expanded = !_expanded),
              child: Row(
                children: [
                  _Badge(code: code, color: color),
                  const SizedBox(width: DexSpace.sm),
                  Expanded(
                    child: Text(
                      heading.isEmpty ? (m.toolId ?? 'tool') : heading,
                      style: DexType.mono(color: DexColors.textDim),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: DexSpace.sm),
                  _StatusLabel(state: state, activity: a),
                  const SizedBox(width: DexSpace.xs),
                  Icon(
                    _expanded
                        ? LucideIcons.chevron_down
                        : LucideIcons.chevron_right,
                    size: 13,
                    color: DexColors.textFaint,
                  ),
                ],
              ),
            ),
          ),
          AnimatedSize(
            duration: DexMotion.respecting(context, DexMotion.fast),
            curve: DexMotion.respectingCurve(context, DexMotion.easeOut),
            alignment: Alignment.topCenter,
            child: _expanded
                ? _StepDetail(message: m, activity: a)
                : const SizedBox(width: double.infinity),
          ),
        ],
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.code, required this.color});
  final String code;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 38,
      alignment: Alignment.center,
      padding: const EdgeInsets.symmetric(vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        code,
        style: DexType.caption(color: color).copyWith(
          fontWeight: FontWeight.w600,
          letterSpacing: 0.8,
        ),
      ),
    );
  }
}

class _StatusLabel extends StatelessWidget {
  const _StatusLabel({required this.state, this.activity});
  final ToolChipState state;
  final ToolActivity? activity;

  @override
  Widget build(BuildContext context) {
    final (color, label) = switch (state) {
      ToolChipState.running => (DexColors.stateActing, 'running'),
      ToolChipState.done => (DexColors.stateApprove, 'done'),
      ToolChipState.failed => (DexColors.stateError, 'failed'),
      ToolChipState.denied => (DexColors.stateError, 'denied'),
    };
    final d = activity?.endedAt != null ? activity!.duration : null;
    final text = d != null && state != ToolChipState.running
        ? '$label ${_fmtDuration(d)}'
        : label;
    return Text(text, style: DexType.caption(color: color));
  }

  String _fmtDuration(Duration d) {
    if (d.inSeconds < 60) {
      return '${(d.inMilliseconds / 1000).toStringAsFixed(1)}s';
    }
    return '${d.inMinutes}m ${d.inSeconds % 60}s';
  }
}

class _StepDetail extends StatelessWidget {
  const _StepDetail({required this.message, this.activity});
  final Message message;
  final ToolActivity? activity;

  @override
  Widget build(BuildContext context) {
    final a = activity;
    final args = a?.args;
    final output = a?.outputLines ?? const <String>[];
    final summary = a?.summary;

    return Container(
      margin: const EdgeInsets.only(top: 4, left: 46),
      padding: const EdgeInsets.all(DexSpace.md),
      decoration: BoxDecoration(
        color: DexColors.surface,
        borderRadius: DexRadius.rsm,
        border: Border.all(color: DexColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  message.toolId ?? 'tool',
                  style: DexType.mono(color: DexColors.text),
                ),
              ),
              if (message.engine != null) EnginePill(engine: message.engine!),
            ],
          ),
          if (args != null && args.isNotEmpty) ...[
            const SizedBox(height: DexSpace.sm),
            ...args.entries.take(6).map(
                  (e) => Text(
                    '${e.key}: ${_clip(e.value.toString(), 160)}',
                    style: DexType.mono(color: DexColors.textDim),
                  ),
                ),
          ],
          if (summary != null && summary.isNotEmpty) ...[
            const SizedBox(height: DexSpace.sm),
            Text(
              _clip(summary, 300),
              style: DexType.body(color: DexColors.text),
            ),
          ],
          if (output.isNotEmpty) ...[
            const SizedBox(height: DexSpace.sm),
            ...output.take(10).map(
                  (l) => Text(
                    _clip(l, 200),
                    style: DexType.mono(color: DexColors.textFaint),
                  ),
                ),
          ],
        ],
      ),
    );
  }

  String _clip(String s, int max) =>
      s.length <= max ? s : '${s.substring(0, max)}…';
}
