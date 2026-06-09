// Collapsible left navigation rail.
//   - Collapsed: 72px wide, icon column only.
//   - Expanded: 240px wide, full labels + recent chats list + user footer.
//
// Sections mirror the Copilot IA -- New chat / Library / Tasks / Projects /
// Discover / Imagine / Experiments -- but the destinations are Dex's own
// (most still TODO placeholder screens, per the plan).

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../theme/tokens.dart';
import 'home/recent_chats_card.dart';

class DexSidebar extends StatelessWidget {
  const DexSidebar({
    super.key,
    required this.expanded,
    required this.onToggle,
    required this.recentChats,
    required this.activeChatId,
    required this.userName,
    this.onNewChat,
    this.onLibrary,
    this.onTasks,
    this.onNewProject,
    this.onDiscover,
    this.onImagine,
    this.onExperiments,
    this.onSelectChat,
    this.onAvatarTap,
  });

  final bool expanded;
  final VoidCallback onToggle;
  final List<RecentChatItem> recentChats;
  final String? activeChatId;
  final String userName;
  final VoidCallback? onNewChat;
  final VoidCallback? onLibrary;
  final VoidCallback? onTasks;
  final VoidCallback? onNewProject;
  final VoidCallback? onDiscover;
  final VoidCallback? onImagine;
  final VoidCallback? onExperiments;
  final ValueChanged<RecentChatItem>? onSelectChat;
  final VoidCallback? onAvatarTap;

  static const double _collapsedWidth = 72;
  static const double _expandedWidth = 240;

  @override
  Widget build(BuildContext context) {
    final width = expanded ? _expandedWidth : _collapsedWidth;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      curve: Curves.easeOutCubic,
      width: width,
      decoration: BoxDecoration(
        // Sidebar reads as a "panel" sitting on top of the wallpaper
        // gradient -- a slightly deeper vertical fade that harmonises
        // with the bg's top-to-bottom navy shift. The hairline right
        // border replaces the old VerticalDivider so we don't end up
        // with a double line between the rail and the content.
        gradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: <Color>[
            Color(0xFF0A132E),
            Color(0xFF050B1F),
          ],
        ),
        border: const Border(
          right: BorderSide(
            color: Color.fromRGBO(0xFF, 0xFF, 0xFF, 0.06),
            width: 1,
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _Header(expanded: expanded, onToggle: onToggle),
          const SizedBox(height: DexSpace.sm),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: DexSpace.sm),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _NavItem(
                    icon: LucideIcons.file_plus,
                    label: 'New chat',
                    expanded: expanded,
                    onTap: onNewChat,
                  ),
                  _NavItem(
                    icon: LucideIcons.library,
                    label: 'Library',
                    expanded: expanded,
                    onTap: onLibrary,
                  ),
                  _NavItem(
                    icon: LucideIcons.square_check,
                    label: 'Tasks',
                    badge: 'PREVIEW',
                    expanded: expanded,
                    onTap: onTasks,
                  ),
                  _NavItem(
                    icon: LucideIcons.folder,
                    label: 'Projects',
                    expanded: expanded,
                    trailing: const Icon(LucideIcons.plus,
                        size: 16, color: DexColors.textDim),
                    onTap: onNewProject,
                  ),
                  const _Divider(),
                  _NavItem(
                    icon: LucideIcons.compass,
                    label: 'Discover',
                    expanded: expanded,
                    onTap: onDiscover,
                  ),
                  _NavItem(
                    icon: LucideIcons.sparkles,
                    label: 'Imagine',
                    expanded: expanded,
                    onTap: onImagine,
                  ),
                  _NavItem(
                    icon: LucideIcons.layout_grid,
                    label: 'Experiments',
                    expanded: expanded,
                    onTap: onExperiments,
                  ),
                  if (expanded && recentChats.isNotEmpty) ...[
                    const _Divider(),
                    const SizedBox(height: DexSpace.sm),
                    ...recentChats.map(
                      (c) => _ChatRow(
                        chat: c,
                        active: c.id == activeChatId,
                        onTap: () => onSelectChat?.call(c),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          _Footer(
            expanded: expanded,
            userName: userName,
            onAvatarTap: onAvatarTap,
          ),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.expanded, required this.onToggle});
  final bool expanded;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DexSpace.md, DexSpace.lg, DexSpace.sm, 0,
      ),
      child: Row(
        children: [
          Container(
            width: 24,
            height: 24,
            decoration: BoxDecoration(
              color: DexColors.accent,
              borderRadius: DexRadius.rsm,
            ),
            alignment: Alignment.center,
            child: Text(
              'D',
              style: DexType.label(color: DexColors.bg).copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          if (expanded) ...[
            const SizedBox(width: DexSpace.sm),
            Expanded(
              child: Text('Dex', style: DexType.label(color: DexColors.text)),
            ),
          ],
          IconButton(
            icon: Icon(
              expanded
                  ? LucideIcons.panel_left_close
                  : LucideIcons.menu,
              size: 18,
            ),
            color: DexColors.textDim,
            onPressed: onToggle,
            tooltip: expanded ? 'Collapse sidebar' : 'Expand sidebar',
            visualDensity: VisualDensity.compact,
          ),
        ],
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.expanded,
    this.badge,
    this.trailing,
    this.onTap,
    this.active = false,
  });

  final IconData icon;
  final String label;
  final bool expanded;
  final String? badge;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final bg = active ? DexColors.surface2 : Colors.transparent;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: Tooltip(
        message: expanded ? '' : label,
        child: InkWell(
          onTap: onTap,
          borderRadius: DexRadius.rsm,
          child: Container(
            decoration: BoxDecoration(
              color: bg,
              borderRadius: DexRadius.rsm,
            ),
            padding: const EdgeInsets.symmetric(
              horizontal: DexSpace.md, vertical: DexSpace.sm,
            ),
            child: Row(
              children: [
                Icon(icon, size: 18, color: DexColors.textDim),
                if (expanded) ...[
                  const SizedBox(width: DexSpace.md),
                  Expanded(
                    child: Text(label,
                        style: DexType.label(color: DexColors.text),
                        overflow: TextOverflow.ellipsis),
                  ),
                  if (badge != null)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: DexSpace.xs, vertical: 1,
                      ),
                      decoration: BoxDecoration(
                        color: DexColors.surface2,
                        borderRadius: DexRadius.rsm,
                        border: Border.all(color: DexColors.border),
                      ),
                      child: Text(badge!,
                          style: DexType.caption(color: DexColors.textDim)),
                    ),
                  if (trailing != null) ...[
                    const SizedBox(width: DexSpace.xs),
                    trailing!,
                  ],
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ChatRow extends StatelessWidget {
  const _ChatRow({required this.chat, required this.active, required this.onTap});
  final RecentChatItem chat;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: InkWell(
        onTap: onTap,
        borderRadius: DexRadius.rsm,
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: DexSpace.md, vertical: DexSpace.sm,
          ),
          decoration: BoxDecoration(
            color: active ? DexColors.surface2 : Colors.transparent,
            borderRadius: DexRadius.rsm,
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  chat.title,
                  style: DexType.label(color: DexColors.text),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (active)
                const Icon(LucideIcons.ellipsis,
                    size: 14, color: DexColors.textFaint),
            ],
          ),
        ),
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider();
  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.symmetric(vertical: DexSpace.sm),
        child: Divider(height: 1, color: DexColors.border),
      );
}

class _Footer extends StatelessWidget {
  const _Footer({
    required this.expanded,
    required this.userName,
    required this.onAvatarTap,
  });

  final bool expanded;
  final String userName;
  final VoidCallback? onAvatarTap;

  @override
  Widget build(BuildContext context) {
    final initial = userName.isNotEmpty ? userName[0].toUpperCase() : 'D';
    final avatar = InkResponse(
      onTap: onAvatarTap,
      radius: 22,
      child: Container(
        width: 32,
        height: 32,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: DexColors.surface2,
          shape: BoxShape.circle,
          border: Border.all(color: DexColors.border),
        ),
        child: Text(initial,
            style: DexType.label(color: DexColors.text)),
      ),
    );
    return Padding(
      padding: const EdgeInsets.all(DexSpace.md),
      child: Row(
        children: [
          avatar,
          if (expanded) ...[
            const SizedBox(width: DexSpace.sm),
            Expanded(
              child: Text(userName,
                  style: DexType.label(color: DexColors.text),
                  overflow: TextOverflow.ellipsis),
            ),
          ],
        ],
      ),
    );
  }
}
