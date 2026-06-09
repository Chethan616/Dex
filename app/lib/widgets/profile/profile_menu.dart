// Bottom-left avatar dropdown shown from the sidebar footer.

import 'package:flutter/material.dart';

import '../../theme/tokens.dart';

enum ProfileMenuAction {
  settings,
  memory,
  reminders,
  feedback,
  upgrade,
  signOut,
}

class ProfileMenu {
  static Future<ProfileMenuAction?> show(BuildContext context) async {
    final overlay = Overlay.of(context).context.findRenderObject() as RenderBox;
    return showMenu<ProfileMenuAction>(
      context: context,
      position: RelativeRect.fromSize(
        Rect.fromLTWH(16, overlay.size.height - 380, 0, 0),
        overlay.size,
      ),
      color: DexColors.surface2,
      shape: RoundedRectangleBorder(
        borderRadius: DexRadius.rmd,
        side: const BorderSide(color: DexColors.border, width: 1),
      ),
      items: <PopupMenuEntry<ProfileMenuAction>>[
        const PopupMenuItem<ProfileMenuAction>(
          enabled: false,
          padding: EdgeInsets.symmetric(
            horizontal: DexSpace.md, vertical: DexSpace.sm,
          ),
          child: _Header(),
        ),
        const PopupMenuDivider(),
        _row(ProfileMenuAction.settings, Icons.settings_outlined, 'Settings'),
        _row(ProfileMenuAction.memory, Icons.psychology_outlined, 'Memory'),
        _row(ProfileMenuAction.reminders, Icons.alarm_rounded, 'Reminders'),
        _row(ProfileMenuAction.feedback, Icons.feedback_outlined, 'Give feedback'),
        const PopupMenuDivider(),
        _row(ProfileMenuAction.signOut, Icons.logout_rounded, 'Sign out'),
      ],
    );
  }

  static PopupMenuItem<ProfileMenuAction> _row(
    ProfileMenuAction value,
    IconData icon,
    String label,
  ) {
    return PopupMenuItem<ProfileMenuAction>(
      value: value,
      padding: const EdgeInsets.symmetric(
        horizontal: DexSpace.md, vertical: DexSpace.sm,
      ),
      child: SizedBox(
        width: 240,
        child: Row(
          children: [
            Icon(icon, size: 16, color: DexColors.textDim),
            const SizedBox(width: DexSpace.md),
            Text(label, style: DexType.label(color: DexColors.text)),
          ],
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header();
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 240,
      child: Row(
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
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Dex user',
                    style: DexType.label(color: DexColors.text)),
                Text('Local plan',
                    style: DexType.caption(color: DexColors.textFaint)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
