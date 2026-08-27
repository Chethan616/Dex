import 'package:flutter/material.dart';

import '../core/models.dart';
import '../theme/tokens.dart';
import 'primitives/primitives.dart';

/// The one row that is always visible: state dot, input, and the two ways out.
///
/// Held to [DexTokens.barRestHeight]. The row used to be 92px tall around a
/// single 16px field — three quarters chrome. A launcher should be mostly the
/// thing you type into.
class CommandInput extends StatelessWidget {
  const CommandInput({
    super.key,
    required this.controller,
    required this.focusNode,
    required this.phase,
    required this.enabled,
    required this.onSubmit,
    required this.onCancel,
    required this.onOpenMissionControl,
    required this.onOpenLibrary,
    this.libraryOpen = false,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final TaskPhase phase;
  final bool enabled;
  final ValueChanged<String> onSubmit;
  final VoidCallback onCancel;
  final VoidCallback onOpenMissionControl;

  /// Saved workflows, history, and what Dex gets used for.
  final VoidCallback onOpenLibrary;
  final bool libraryOpen;

  bool get _busy =>
      phase == TaskPhase.thinking ||
      phase == TaskPhase.running ||
      phase == TaskPhase.awaiting;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;

    return SizedBox(
      height: DexTokens.barRestHeight,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: DexTokens.spaceLg),
        child: Row(
          children: [
            _PhaseDot(phase: phase, enabled: enabled),
            const SizedBox(width: DexTokens.spaceMd),
            Expanded(
              child: TextField(
                controller: controller,
                focusNode: focusNode,
                enabled: enabled,
                autofocus: true,
                cursorColor: t.accent,
                cursorWidth: 2,
                style: DexType.prompt(color: t.text),
                decoration: InputDecoration(
                  isDense: true,
                  isCollapsed: true,
                  border: InputBorder.none,
                  hintText: enabled ? 'What should DEX do?' : 'Waiting for core…',
                  hintStyle: DexType.prompt(color: t.textFaint),
                ),
                onSubmitted: (value) {
                  final text = value.trim();
                  if (text.isNotEmpty) onSubmit(text);
                },
              ),
            ),
            const SizedBox(width: DexTokens.spaceMd),
            if (_busy) ...[
              _StatusPill(phase: phase),
              const SizedBox(width: DexTokens.spaceSm),
              DexButton(
                label: 'Cancel',
                dense: true,
                tone: t.negative,
                onTap: onCancel,
              ),
            ] else
              const DexKeyHint('Enter'),
            const SizedBox(width: DexTokens.spaceXs),
            DexIconButton(
              tooltip: 'Workflows, history and usage',
              icon: libraryOpen ? Icons.bookmarks : Icons.bookmarks_outlined,
              tone: libraryOpen ? t.accent : null,
              onTap: onOpenLibrary,
            ),
            DexIconButton(
              tooltip: 'Mission Control  (Ctrl+M)',
              icon: Icons.grid_view_rounded,
              onTap: onOpenMissionControl,
            ),
          ],
        ),
      ),
    );
  }
}

class _PhaseDot extends StatefulWidget {
  const _PhaseDot({required this.phase, required this.enabled});

  final TaskPhase phase;
  final bool enabled;

  @override
  State<_PhaseDot> createState() => _PhaseDotState();
}

class _PhaseDotState extends State<_PhaseDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  Color _color(DexTokens t) {
    if (!widget.enabled) return t.textFaint;
    return switch (widget.phase) {
      TaskPhase.idle => t.textMuted,
      TaskPhase.thinking => t.eventColor('thinking'),
      TaskPhase.running => t.eventColor('executing'),
      TaskPhase.awaiting => t.eventColor('awaiting'),
      TaskPhase.done => t.eventColor('done'),
      TaskPhase.failed => t.eventColor('failed'),
      TaskPhase.cancelled => t.eventColor('cancelled'),
    };
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final color = _color(t);
    final animate = widget.enabled &&
        (widget.phase == TaskPhase.thinking ||
            widget.phase == TaskPhase.running ||
            widget.phase == TaskPhase.awaiting);

    return AnimatedBuilder(
      animation: _pulse,
      builder: (context, _) {
        final glow = animate ? 0.25 + (_pulse.value * 0.55) : 0.0;
        return Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
            boxShadow: glow > 0
                ? [
                    BoxShadow(
                      color: color.withValues(alpha: glow),
                      blurRadius: 9,
                      spreadRadius: 2,
                    )
                  ]
                : null,
          ),
        );
      },
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.phase});

  final TaskPhase phase;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final (String label, Color color) = switch (phase) {
      TaskPhase.thinking => ('thinking', t.eventColor('thinking')),
      TaskPhase.running => ('running', t.eventColor('executing')),
      TaskPhase.awaiting => ('needs you', t.eventColor('awaiting')),
      _ => ('idle', t.textMuted),
    };

    return DexTag.round(label, tone: color);
  }
}
