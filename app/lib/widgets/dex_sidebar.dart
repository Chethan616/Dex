// Collapsible left navigation rail.
//   - Collapsed: 72px wide, icon column only.
//   - Expanded: 240px wide, full labels + recent chats list + user footer.
//
// Sections mirror the Copilot IA -- New chat / Library / Tasks / Projects /
// Discover / Imagine / Experiments -- but the destinations are Dex's own
// (most still TODO placeholder screens, per the plan).

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../theme/motion.dart';
import '../theme/tokens.dart';
import 'home/recent_chats_card.dart';
import 'profile/profile_menu.dart';

class DexSidebar extends StatefulWidget {
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
    this.onProfileAction,
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
  final ValueChanged<ProfileMenuAction>? onProfileAction;

  static const double _collapsedWidth = 72;
  static const double _expandedWidth = 240;

  @override
  State<DexSidebar> createState() => _DexSidebarState();
}

class _DexSidebarState extends State<DexSidebar>
    with SingleTickerProviderStateMixin {
  late final AnimationController _entry;

  @override
  void initState() {
    super.initState();
    // One-shot slide-in from the left when the home shell first
    // mounts. 360ms is long enough to read as a deliberate reveal
    // rather than a jolt; the dampened decelerate curve matches
    // the dialog / menu entry motion language.
    _entry = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 360),
    )..forward();
  }

  @override
  void dispose() {
    _entry.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final width = widget.expanded
        ? DexSidebar._expandedWidth
        : DexSidebar._collapsedWidth;
    final body = _buildBody(width);
    final reduce = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (reduce) return body;
    return AnimatedBuilder(
      animation: _entry,
      builder: (context, child) {
        final t = DexMotion.dampened.transform(_entry.value);
        return Transform.translate(
          offset: Offset((1 - t) * -width, 0),
          child: Opacity(opacity: t, child: child),
        );
      },
      child: body,
    );
  }

  Widget _buildBody(double width) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      curve: Curves.easeOutCubic,
      width: width,
      decoration: const BoxDecoration(
        // Sidebar reads as a translucent panel sitting on the bg
        // gradient. Three-stop vertical fade with a brighter top
        // (catches the implied light source) settling into the deep
        // navy of the wallpaper. Apple-grade refractive treatment on
        // the two visible edges:
        //   - top: bright white-alpha highlight ("lit edge")
        //   - right: sky-blue tint that reads as the bg fog leaking
        //            through the glass into the content area
        // Together they make the rail look like an etched glass panel
        // sitting on top of the wallpaper rather than a flat slab.
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: <Color>[
            Color(0xFF14213F),
            Color(0xFF0B142E),
            Color(0xFF050B1F),
          ],
          stops: <double>[0.0, 0.4, 1.0],
        ),
        border: Border(
          top: BorderSide(
            color: Color.fromRGBO(0xFF, 0xFF, 0xFF, 0.12),
            width: 1,
          ),
          right: BorderSide(
            // Sky-blue-tinted edge -- picks up DexSurface.bgGradient's
            // sky-blue glow and refracts it where the rail meets the
            // content. Pure-white would read as a flat hairline; the
            // tint makes it feel alive.
            color: Color.fromRGBO(0x6E, 0xA8, 0xFF, 0.18),
            width: 1,
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _Header(expanded: widget.expanded, onToggle: widget.onToggle),
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
                    expanded: widget.expanded,
                    onTap: widget.onNewChat,
                  ),
                  _NavItem(
                    icon: LucideIcons.library,
                    label: 'Library',
                    expanded: widget.expanded,
                    onTap: widget.onLibrary,
                  ),
                  _NavItem(
                    icon: LucideIcons.square_check,
                    label: 'Tasks',
                    badge: 'PREVIEW',
                    expanded: widget.expanded,
                    onTap: widget.onTasks,
                  ),
                  _NavItem(
                    icon: LucideIcons.folder,
                    label: 'Projects',
                    expanded: widget.expanded,
                    trailing: const Icon(LucideIcons.plus,
                        size: 16, color: DexColors.textDim),
                    onTap: widget.onNewProject,
                  ),
                  const _Divider(),
                  _NavItem(
                    icon: LucideIcons.compass,
                    label: 'Discover',
                    expanded: widget.expanded,
                    onTap: widget.onDiscover,
                  ),
                  _NavItem(
                    icon: LucideIcons.sparkles,
                    label: 'Imagine',
                    expanded: widget.expanded,
                    onTap: widget.onImagine,
                  ),
                  _NavItem(
                    icon: LucideIcons.layout_grid,
                    label: 'Experiments',
                    expanded: widget.expanded,
                    onTap: widget.onExperiments,
                  ),
                  if (widget.expanded && widget.recentChats.isNotEmpty) ...[
                    const SizedBox(height: DexSpace.lg),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(
                        DexSpace.md, 0, DexSpace.md, DexSpace.xs,
                      ),
                      child: Text(
                        'History',
                        style: DexType.caption(color: DexColors.textDim)
                            .copyWith(
                          letterSpacing: 0.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    ...widget.recentChats.map(
                      (c) => _ChatRow(
                        chat: c,
                        active: c.id == widget.activeChatId,
                        onTap: () => widget.onSelectChat?.call(c),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          _Footer(
            expanded: widget.expanded,
            userName: widget.userName,
            onProfileAction: widget.onProfileAction,
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
        mainAxisAlignment: expanded
            ? MainAxisAlignment.start
            : MainAxisAlignment.center,
        children: [
          if (expanded)
            Expanded(
              child: Text(
                'Dex',
                style: DexType.heading(color: DexColors.text),
              ),
            ),
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
              mainAxisAlignment: expanded
                  ? MainAxisAlignment.start
                  : MainAxisAlignment.center,
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
    required this.onProfileAction,
  });

  final bool expanded;
  final String userName;
  final ValueChanged<ProfileMenuAction>? onProfileAction;

  @override
  Widget build(BuildContext context) {
    final initial = userName.isNotEmpty ? userName[0].toUpperCase() : 'D';
    final avatarDot = Container(
      width: 32,
      height: 32,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: DexColors.surface2,
        shape: BoxShape.circle,
        border: Border.all(color: DexColors.border),
      ),
      child: Text(initial, style: DexType.label(color: DexColors.text)),
    );
    // The avatar opens a real GlassPopover profile card (custom content +
    // close callback). Each row fires onProfileAction and self-closes.
    final avatar = ProfilePopover(
      userName: userName,
      onAction: onProfileAction ?? (_) {},
      child: avatarDot,
    );
    return Padding(
      padding: const EdgeInsets.all(DexSpace.md),
      child: Row(
        mainAxisAlignment: expanded
            ? MainAxisAlignment.start
            : MainAxisAlignment.center,
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
