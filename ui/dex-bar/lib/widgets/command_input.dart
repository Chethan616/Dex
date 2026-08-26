import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/models.dart';
import '../theme/tokens.dart';

/// The one row that is always visible: status dot, input, hint.
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

  bool get _busy =>
      phase == TaskPhase.thinking || phase == TaskPhase.running || phase == TaskPhase.awaiting;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: DexTokens.spaceLg,
        vertical: DexTokens.spaceMd,
      ),
      child: Row(
        children: [
          _PhaseDot(phase: phase, enabled: enabled),
          const SizedBox(width: DexTokens.spaceMd),
          Expanded(
            child: Shortcuts(
              shortcuts: const {
                SingleActivator(LogicalKeyboardKey.escape): _DismissIntent(),
              },
              child: TextField(
                controller: controller,
                focusNode: focusNode,
                enabled: enabled,
                autofocus: true,
                cursorColor: t.accent,
                cursorWidth: 2,
                style: DexType.sans(size: 16, color: t.text, height: 1.3),
                decoration: InputDecoration(
                  isDense: true,
                  border: InputBorder.none,
                  hintText: enabled ? 'What should DEX do?' : 'Waiting for core…',
                  hintStyle: DexType.sans(size: 16, color: t.textFaint),
                ),
                onSubmitted: (value) {
                  final text = value.trim();
                  if (text.isNotEmpty) onSubmit(text);
                },
              ),
            ),
          ),
          const SizedBox(width: DexTokens.spaceMd),
          if (_busy) ...[
            _StatusPill(phase: phase),
            const SizedBox(width: DexTokens.spaceSm),
            _BarButton(
              label: 'Cancel',
              onTap: onCancel,
              color: t.eventColor('failed'),
            ),
          ] else
            _KeyHint(label: 'Enter', tokens: t),
          const SizedBox(width: DexTokens.spaceSm),
          _IconTap(
            tooltip: 'Workflows, history and usage',
            icon: Icons.bookmarks_outlined,
            onTap: onOpenLibrary,
          ),
          _IconTap(
            tooltip: 'Mission Control  (Ctrl+M)',
            icon: Icons.grid_view_rounded,
            onTap: onOpenMissionControl,
          ),
        ],
      ),
    );
  }
}

class _DismissIntent extends Intent {
  const _DismissIntent();
}

class _PhaseDot extends StatefulWidget {
  const _PhaseDot({required this.phase, required this.enabled});

  final TaskPhase phase;
  final bool enabled;

  @override
  State<_PhaseDot> createState() => _PhaseDotState();
}

class _PhaseDotState extends State<_PhaseDot> with SingleTickerProviderStateMixin {
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
          width: 9,
          height: 9,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
            boxShadow: glow > 0
                ? [BoxShadow(color: color.withValues(alpha: glow), blurRadius: 9, spreadRadius: 2)]
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

    return AnimatedContainer(
      duration: DexTokens.durMed,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(label, style: DexType.mono(size: 10.5, color: color)),
    );
  }
}

class _KeyHint extends StatelessWidget {
  const _KeyHint({required this.label, required this.tokens});

  final String label;
  final DexTokens tokens;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: tokens.surfaceRaised,
        borderRadius: BorderRadius.circular(DexTokens.radiusSm),
        border: Border.all(color: tokens.border),
      ),
      child: Text(label, style: DexType.mono(size: 10.5, color: tokens.textFaint)),
    );
  }
}

class _BarButton extends StatelessWidget {
  const _BarButton({required this.label, required this.onTap, required this.color});

  final String label;
  final VoidCallback onTap;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: t.surfaceRaised,
            borderRadius: BorderRadius.circular(DexTokens.radiusSm),
            border: Border.all(color: color.withValues(alpha: 0.4)),
          ),
          child: Text(label, style: DexType.sans(size: 11.5, color: color, weight: FontWeight.w500)),
        ),
      ),
    );
  }
}

class _IconTap extends StatelessWidget {
  const _IconTap({required this.tooltip, required this.icon, required this.onTap});

  final String tooltip;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return Tooltip(
      message: tooltip,
      textStyle: DexType.sans(size: 11, color: t.text),
      decoration: BoxDecoration(
        color: t.surfaceRaised,
        borderRadius: BorderRadius.circular(DexTokens.radiusSm),
        border: Border.all(color: t.border),
      ),
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        child: GestureDetector(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(4),
            child: Icon(icon, size: 16, color: t.textMuted),
          ),
        ),
      ),
    );
  }
}
