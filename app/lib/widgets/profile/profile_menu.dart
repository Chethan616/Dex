// Profile popover shown from the sidebar avatar — a real GlassPopover with
// custom content + close callback (the "Custom content with close callback"
// pattern from the package's overlays example): avatar + name header, then
// action rows that fire onAction and self-close.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

import '../../theme/tokens.dart';

enum ProfileMenuAction {
  settings,
  memory,
  reminders,
  feedback,
  signOut,
}

/// Wraps [child] (the avatar) in the same GlassMenu the dropdowns use, so the
/// profile menu matches the voice-settings Language dropdown exactly: accent
/// selection pill, premium morph, accent glyphs (Sign out destructive-red).
class ProfilePopover extends StatelessWidget {
  const ProfilePopover({
    super.key,
    required this.child,
    required this.userName,
    required this.onAction,
  });

  final Widget child;
  final String userName;
  final ValueChanged<ProfileMenuAction> onAction;

  @override
  Widget build(BuildContext context) {
    final initial = userName.isNotEmpty ? userName[0].toUpperCase() : 'D';
    return GlassMenu(
      quality: GlassQuality.premium,
      menuWidth: 248,
      triggerBuilder: (context, toggle) => MouseRegion(
        cursor: SystemMouseCursors.click,
        child: GestureDetector(onTap: toggle, child: child),
      ),
      items: [
        GlassMenuLabel(
          height: 52,
          child: Row(
            children: [
              Container(
                width: 32,
                height: 32,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(colors: [
                    DexColors.accent.withValues(alpha: 0.9),
                    DexColors.stateThinking.withValues(alpha: 0.9),
                  ]),
                ),
                child: Text(initial, style: DexType.label(color: DexColors.bg)),
              ),
              const SizedBox(width: DexSpace.sm),
              Expanded(
                child: Text(userName,
                    style: DexType.label(color: DexColors.text),
                    overflow: TextOverflow.ellipsis),
              ),
            ],
          ),
        ),
        const GlassMenuDivider(),
        GlassMenuItem(
          title: 'Settings',
          icon: const Icon(LucideIcons.settings, color: DexColors.accent),
          onTap: () => onAction(ProfileMenuAction.settings),
        ),
        GlassMenuItem(
          title: 'Memory',
          icon: const Icon(LucideIcons.brain, color: DexColors.accent),
          onTap: () => onAction(ProfileMenuAction.memory),
        ),
        GlassMenuItem(
          title: 'Reminders',
          icon: const Icon(LucideIcons.alarm_clock, color: DexColors.accent),
          onTap: () => onAction(ProfileMenuAction.reminders),
        ),
        GlassMenuItem(
          title: 'Give feedback',
          icon: const Icon(LucideIcons.message_circle, color: DexColors.accent),
          onTap: () => onAction(ProfileMenuAction.feedback),
        ),
        const GlassMenuDivider(),
        GlassMenuItem(
          title: 'Sign out',
          icon: const Icon(LucideIcons.log_out),
          isDestructive: true,
          onTap: () => onAction(ProfileMenuAction.signOut),
        ),
      ],
    );
  }
}

