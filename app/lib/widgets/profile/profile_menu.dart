// Bottom-left avatar dropdown shown from the sidebar footer.
// Routes through GlossyMenu so the popup picks up the same glossy
// gradient + edge highlight + spring entry as the rest of the chrome.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../theme/tokens.dart';
import '../glossy_menu.dart';

enum ProfileMenuAction {
  settings,
  memory,
  reminders,
  feedback,
  signOut,
}

class ProfileMenu {
  static Future<ProfileMenuAction?> show(BuildContext context) {
    final overlay =
        Overlay.of(context).context.findRenderObject() as RenderBox;
    // Anchor in the bottom-left of the screen, just above the sidebar's
    // footer avatar. The card itself is 260 wide so we leave 16px gutter
    // off the left edge.
    final anchor = Offset(16, overlay.size.height - 360);
    return GlossyMenu.show<ProfileMenuAction>(
      context: context,
      anchor: anchor,
      width: 260,
      entries: const <GlossyMenuEntry<ProfileMenuAction>>[
        GlossyMenuHeader<ProfileMenuAction>(child: _ProfileHeader()),
        GlossyMenuDivider<ProfileMenuAction>(),
        GlossyMenuItem<ProfileMenuAction>(
          value: ProfileMenuAction.settings,
          child: _Row(icon: LucideIcons.settings, label: 'Settings'),
        ),
        GlossyMenuItem<ProfileMenuAction>(
          value: ProfileMenuAction.memory,
          child: _Row(icon: LucideIcons.brain, label: 'Memory'),
        ),
        GlossyMenuItem<ProfileMenuAction>(
          value: ProfileMenuAction.reminders,
          child: _Row(icon: LucideIcons.alarm_clock, label: 'Reminders'),
        ),
        GlossyMenuItem<ProfileMenuAction>(
          value: ProfileMenuAction.feedback,
          child: _Row(icon: LucideIcons.message_circle, label: 'Give feedback'),
        ),
        GlossyMenuDivider<ProfileMenuAction>(),
        GlossyMenuItem<ProfileMenuAction>(
          value: ProfileMenuAction.signOut,
          child: _Row(icon: LucideIcons.log_out, label: 'Sign out'),
        ),
      ],
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 16, color: DexColors.textDim),
        const SizedBox(width: DexSpace.md),
        Text(label, style: DexType.label(color: DexColors.text)),
      ],
    );
  }
}

class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader();
  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 32,
          height: 32,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: DexColors.surface,
            shape: BoxShape.circle,
            border: Border.all(color: DexColors.border),
          ),
          child: Text('D', style: DexType.label(color: DexColors.text)),
        ),
        const SizedBox(width: DexSpace.md),
        Expanded(
          child: Text('Dex user',
              style: DexType.label(color: DexColors.text),
              overflow: TextOverflow.ellipsis),
        ),
      ],
    );
  }
}
