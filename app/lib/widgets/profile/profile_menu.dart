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

/// Wraps [child] (the avatar) in a GlassPopover. Tapping the avatar opens a
/// frosted profile card; picking a row calls [onAction] and closes.
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
    return GlassPopover(
      quality: GlassQuality.premium, // morph; falls back to standard on Skia
      popoverWidth: 248,
      popoverHeight: 312,
      triggerBuilder: (context, toggle) => MouseRegion(
        cursor: SystemMouseCursors.click,
        child: GestureDetector(onTap: toggle, child: child),
      ),
      contentBuilder: (context, close) => Padding(
        padding: const EdgeInsets.all(DexSpace.md),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(colors: [
                      DexColors.accent.withValues(alpha: 0.9),
                      DexColors.stateThinking.withValues(alpha: 0.9),
                    ]),
                  ),
                  child: Text(initial,
                      style: DexType.heading(color: DexColors.bg)),
                ),
                const SizedBox(width: DexSpace.md),
                Expanded(
                  child: Text(userName,
                      style: DexType.label(color: DexColors.text),
                      overflow: TextOverflow.ellipsis),
                ),
              ],
            ),
            const SizedBox(height: DexSpace.md),
            const Divider(height: 1, color: DexColors.border),
            const SizedBox(height: DexSpace.xs),
            _Row(
              icon: LucideIcons.settings,
              label: 'Settings',
              onTap: () {
                close();
                onAction(ProfileMenuAction.settings);
              },
            ),
            _Row(
              icon: LucideIcons.brain,
              label: 'Memory',
              onTap: () {
                close();
                onAction(ProfileMenuAction.memory);
              },
            ),
            _Row(
              icon: LucideIcons.alarm_clock,
              label: 'Reminders',
              onTap: () {
                close();
                onAction(ProfileMenuAction.reminders);
              },
            ),
            _Row(
              icon: LucideIcons.message_circle,
              label: 'Give feedback',
              onTap: () {
                close();
                onAction(ProfileMenuAction.feedback);
              },
            ),
            const SizedBox(height: DexSpace.xs),
            const Divider(height: 1, color: DexColors.border),
            const SizedBox(height: DexSpace.xs),
            _Row(
              icon: LucideIcons.log_out,
              label: 'Sign out',
              onTap: () {
                close();
                onAction(ProfileMenuAction.signOut);
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: InkWell(
        onTap: onTap,
        borderRadius: DexRadius.rsm,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: DexSpace.sm, vertical: DexSpace.sm,
          ),
          child: Row(
            children: [
              Icon(icon, size: 16, color: DexColors.textDim),
              const SizedBox(width: DexSpace.md),
              Text(label, style: DexType.label(color: DexColors.text)),
            ],
          ),
        ),
      ),
    );
  }
}
