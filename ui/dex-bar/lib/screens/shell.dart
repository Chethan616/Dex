import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';

import '../core/gateway_client.dart';
import '../core/supervisor/supervisor.dart';
import '../core/theme_controller.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';
import '../widgets/primitives/primitives.dart';
import 'home_screen.dart';
import 'logs_screen.dart';
import 'settings/settings_screen.dart';
import 'schedules_screen.dart';
import 'tasks_screen.dart';
import 'workflows_screen.dart';

/// The application window.
///
/// Six destinations, and every one of them is something the core could already
/// do and only a slash command could reach. `/history`, `/workflows`,
/// `/schedules` and the log files were all real features that required knowing
/// they existed. None of this is new capability; it is the existing capability
/// made findable.
///
/// The Alt+Space bar is a separate window and stays exactly as it was. This is
/// where you live; that is where you go when you want one thing done now.
class DexShell extends StatefulWidget {
  const DexShell({
    super.key,
    required this.client,
    required this.supervisor,
    required this.theme,
    required this.onQuit,
  });

  final GatewayClient client;
  final Supervisor supervisor;
  final ThemeController theme;
  final Future<void> Function() onQuit;

  @override
  State<DexShell> createState() => DexShellState();
}

class DexShellState extends State<DexShell> {
  int _index = 0;

  static const destinations = [
    (Icons.bolt_rounded, 'Home'),
    (Icons.history_rounded, 'Tasks'),
    (Icons.schedule_rounded, 'Schedules'),
    (Icons.bookmark_outline_rounded, 'Workflows'),
    (Icons.subject_rounded, 'Logs'),
    (Icons.tune_rounded, 'Settings'),
  ];

  /// Jump straight to a page — used by the hotkeys.
  void go(int index) {
    if (index == _index || index < 0 || index >= destinations.length) return;
    setState(() => _index = index);
  }

  void goTo(String name) => go(
        destinations.indexWhere((d) => d.$2.toLowerCase() == name.toLowerCase()),
      );

  @override
  Widget build(BuildContext context) {
    final t = context.dex;

    return Container(
      decoration: BoxDecoration(
        color: t.bg,
        borderRadius: BorderRadius.circular(DexTokens.radiusLg),
        border: Border.all(color: t.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          _TitleBar(client: widget.client),
          Expanded(
            child: Row(
              children: [
                _Rail(
                  index: _index,
                  onSelect: go,
                  client: widget.client,
                ),
                Container(width: 1, color: t.border),
                Expanded(
                  child: AnimatedSwitcher(
                    duration: DexMotion.durationOf(context, DexMotion.medium),
                    // Fade only. The pages are full-width, and sliding one out
                    // while another slides in reads as a page turn — which
                    // implies an order these destinations do not have.
                    child: KeyedSubtree(
                      key: ValueKey(_index),
                      child: _page(),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _page() => switch (_index) {
        0 => HomeScreen(client: widget.client, supervisor: widget.supervisor),
        1 => TasksScreen(client: widget.client),
        2 => SchedulesScreen(client: widget.client),
        3 => WorkflowsScreen(client: widget.client),
        4 => LogsScreen(client: widget.client),
        _ => SettingsScreen(
            client: widget.client,
            supervisor: widget.supervisor,
            theme: widget.theme,
            onQuit: widget.onQuit,
          ),
      };
}

/// The window's own title bar.
///
/// The system one is hidden, so this is both the drag handle and the close
/// button. Dragging is a DragToMoveArea rather than a manual pointer handler:
/// the OS moves the window, which keeps it smooth and keeps it honest about
/// snapping and multi-monitor edges.
class _TitleBar extends StatelessWidget {
  const _TitleBar({required this.client});

  final GatewayClient client;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;

    return SizedBox(
      height: 42,
      child: DragToMoveArea(
        child: Container(
          decoration: BoxDecoration(
            color: t.surface,
            border: Border(bottom: BorderSide(color: t.border)),
          ),
          padding: const EdgeInsets.only(left: DexTokens.spaceLg),
          child: Row(
            children: [
              ShaderMask(
                shaderCallback: (rect) => LinearGradient(
                  colors: [t.accent, t.attention],
                ).createShader(rect),
                child: Text(
                  'Dex',
                  style: DexType.body(color: Colors.white, strong: true),
                ),
              ),
              const SizedBox(width: DexTokens.spaceMd),
              _ConnectionDot(client: client),
              const Spacer(),
              DexIconButton(
                icon: Icons.remove_rounded,
                tooltip: 'Minimise',
                onTap: windowManager.minimize,
              ),
              DexIconButton(
                icon: Icons.close_rounded,
                tooltip: 'Hide Dex — Alt+Space keeps working',
                onTap: windowManager.hide,
              ),
              const SizedBox(width: DexTokens.spaceSm),
            ],
          ),
        ),
      ),
    );
  }
}

class _ConnectionDot extends StatelessWidget {
  const _ConnectionDot({required this.client});

  final GatewayClient client;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final (color, label) = switch (client.connection) {
      CoreConnection.connected => (t.positive, 'Connected'),
      CoreConnection.connecting => (t.warn, 'Connecting'),
      CoreConnection.noCore => (t.negative, 'Core not running'),
      CoreConnection.disconnected => (t.negative, 'Disconnected'),
    };

    return Tooltip(
      message: client.connectionError ?? label,
      child: Row(
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: DexTokens.spaceSm),
          Text(label, style: DexType.caption(color: t.textFaint)),
        ],
      ),
    );
  }
}

class _Rail extends StatelessWidget {
  const _Rail({required this.index, required this.onSelect, required this.client});

  final int index;
  final ValueChanged<int> onSelect;
  final GatewayClient client;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;

    return Container(
      width: 168,
      color: t.surface,
      padding: const EdgeInsets.symmetric(vertical: DexTokens.spaceMd),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < DexShellState.destinations.length; i++)
            _RailItem(
              icon: DexShellState.destinations[i].$1,
              label: DexShellState.destinations[i].$2,
              selected: i == index,
              badge: i == 0 && client.pending.isNotEmpty
                  ? client.pending.length
                  : null,
              onTap: () => onSelect(i),
            ),
          const Spacer(),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: DexTokens.spaceMd),
            child: Text(
              'Alt+Space anywhere',
              style: DexType.caption(color: t.textFaint),
            ),
          ),
        ],
      ),
    );
  }
}

class _RailItem extends StatefulWidget {
  const _RailItem({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
    this.badge,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final int? badge;

  @override
  State<_RailItem> createState() => _RailItemState();
}

class _RailItemState extends State<_RailItem> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final active = widget.selected;

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: DexTokens.spaceSm,
        vertical: 2,
      ),
      child: DexPressable(
        child: FocusRing(
          enabled: true,
          radius: DexTokens.radiusMd,
          semanticLabel: widget.label,
          onTap: widget.onTap,
          onHoverChanged: (v) => setState(() => _hover = v),
          child: AnimatedContainer(
            duration: DexMotion.durationOf(context, DexMotion.fast),
            padding: const EdgeInsets.symmetric(
              horizontal: DexTokens.spaceMd,
              vertical: 9,
            ),
            decoration: BoxDecoration(
              color: active
                  ? t.accent.withValues(alpha: 0.14)
                  : _hover
                      ? t.surfaceRaised
                      : Colors.transparent,
              borderRadius: BorderRadius.circular(DexTokens.radiusMd),
            ),
            child: Row(
              children: [
                Icon(
                  widget.icon,
                  size: 17,
                  color: active ? t.accent : t.textMuted,
                ),
                const SizedBox(width: DexTokens.spaceMd),
                Expanded(
                  child: Text(
                    widget.label,
                    style: DexType.body(
                      color: active ? t.text : t.textMuted,
                      strong: active,
                    ),
                  ),
                ),
                if (widget.badge != null)
                  DexTag.round('${widget.badge}', tone: t.attention),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
