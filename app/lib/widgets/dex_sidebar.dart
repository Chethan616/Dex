// Collapsible left navigation rail.
//   - Collapsed: 72px wide, icon column only.
//   - Expanded: 240px wide, full labels + recent chats list + user footer.
//
// Every item here goes somewhere that exists.
//
// It used to mirror the Copilot information architecture -- Library, Tasks,
// Projects, Discover, Imagine, Experiments -- and its own comment admitted the
// destinations were "most still TODO placeholder screens". Six of the seven
// items did nothing: home_desktop passed a handler for New chat and for none of
// the others, so tapping one was indistinguishable from the app having frozen.
// A navigation rail that mostly does not navigate is worse than a short one,
// because the owner cannot tell which half works -- and Imagine and Experiments
// name features Dex does not have and will not grow by being clicked.
//
// What replaced them is what Dex actually is: the conversation, the workflows
// it has learned, the schedules it will fire, the capabilities it can reach
// right now, and the log of what it did. Each one opens a real screen.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../theme/motion.dart';
import '../theme/tokens.dart';
import 'home/recent_chats_card.dart';
import 'menu_glass.dart';
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
    this.onWorkflows,
    this.onSchedules,
    this.onCapabilities,
    this.onLogs,
    this.onSettings,
    this.onSelectChat,
    this.onSearchChats,
    this.onRenameChat,
    this.onDeleteChat,
    this.onRerunChat,
    this.onProfileAction,
  });

  final bool expanded;
  final VoidCallback onToggle;
  final List<RecentChatItem> recentChats;
  final String? activeChatId;
  final String userName;
  final VoidCallback? onNewChat;

  /// Re-running is now something the owner asks for, on the row's menu,
  /// rather than the only thing a click could mean.
  /// Search across what was said, not only what was asked.
  final void Function(String query)? onSearchChats;
  final void Function(RecentChatItem chat, String name)? onRenameChat;
  final void Function(RecentChatItem chat)? onDeleteChat;
  final void Function(RecentChatItem chat)? onRerunChat;

  /// Settings → Memory: the saved plans, and how often each has replayed.
  final VoidCallback? onWorkflows;

  /// The schedules screen — what Dex will do without being asked.
  final VoidCallback? onSchedules;

  /// Settings → Connectors: the daemon and each agent, probed live.
  final VoidCallback? onCapabilities;

  /// Settings → Diagnostics: time-ordered logs, filtered by level and source.
  final VoidCallback? onLogs;

  final VoidCallback? onSettings;
  final ValueChanged<RecentChatItem>? onSelectChat;
  final ValueChanged<ProfileMenuAction>? onProfileAction;

  static const double _collapsedWidth = 80;
  static const double _expandedWidth = 280;

  @override
  State<DexSidebar> createState() => _DexSidebarState();
}

class _DexSidebarState extends State<DexSidebar>
    with SingleTickerProviderStateMixin {
  late final AnimationController _entry;

  /// The history search box, opened from the History heading.
  final _search = TextEditingController();
  bool _searching = false;

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
      margin: const EdgeInsets.all(DexSpace.md),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
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
        border: Border.all(
          color: const Color.fromRGBO(0x6E, 0xA8, 0xFF, 0.18),
          width: 1,
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
                  // New chat first and alone: it is the one thing here the
                  // owner does many times a day, and grouping it with the
                  // screens made it one of six equal rows.
                  _NavItem(
                    icon: LucideIcons.file_plus,
                    label: 'New chat',
                    expanded: widget.expanded,
                    onTap: widget.onNewChat,
                  ),

                  // Two headings rather than one divider. The rail mixes
                  // things Dex does for you with places you go to look at
                  // something, and reading it as one list means reading all
                  // six every time to find either.
                  if (widget.expanded) const _RailHeading('Automate'),
                  _NavItem(
                    icon: LucideIcons.repeat,
                    label: 'Workflows',
                    expanded: widget.expanded,
                    onTap: widget.onWorkflows,
                  ),
                  _NavItem(
                    icon: LucideIcons.clock,
                    label: 'Schedules',
                    expanded: widget.expanded,
                    onTap: widget.onSchedules,
                  ),

                  if (widget.expanded)
                    const _RailHeading('This machine')
                  else
                    const _Divider(),
                  _NavItem(
                    icon: LucideIcons.plug,
                    label: 'Capabilities',
                    expanded: widget.expanded,
                    onTap: widget.onCapabilities,
                  ),
                  _NavItem(
                    icon: LucideIcons.scroll_text,
                    label: 'Logs',
                    expanded: widget.expanded,
                    onTap: widget.onLogs,
                  ),
                  _NavItem(
                    icon: LucideIcons.settings,
                    label: 'Settings',
                    expanded: widget.expanded,
                    onTap: widget.onSettings,
                  ),
                  if (widget.expanded && widget.recentChats.isNotEmpty) ...[
                    const SizedBox(height: DexSpace.lg),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(
                        DexSpace.md, 0, DexSpace.md, DexSpace.xs,
                      ),
                      child: Row(
                        children: [
                          Text(
                            'History',
                            style: DexType.caption(color: DexColors.textDim)
                                .copyWith(
                              letterSpacing: 0.5,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const Spacer(),
                          // Searching *inside* messages is the thing task
                          // history could never do — the answer to "what was
                          // that path Dex gave me" is in a reply, not a
                          // request. It is worth a control rather than only a
                          // slash command nobody knows about.
                          _IconAction(
                            icon: _searching
                                ? LucideIcons.x
                                : LucideIcons.search,
                            onTap: () => setState(() {
                              _searching = !_searching;
                              if (!_searching) {
                                _search.clear();
                                widget.onSearchChats?.call('');
                              }
                            }),
                          ),
                        ],
                      ),
                    ),
                    if (_searching)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(
                          DexSpace.md, 0, DexSpace.md, DexSpace.sm,
                        ),
                        child: TextField(
                          controller: _search,
                          autofocus: true,
                          style: DexType.caption(color: DexColors.text),
                          onChanged: (value) =>
                              widget.onSearchChats?.call(value.trim()),
                          decoration: InputDecoration(
                            hintText: 'words anyone said…',
                            hintStyle:
                                DexType.caption(color: DexColors.textFaint),
                            isDense: true,
                            contentPadding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 8),
                            filled: true,
                            fillColor: DexColors.surface2,
                            border: OutlineInputBorder(
                              borderRadius: DexRadius.rsm,
                              borderSide:
                                  const BorderSide(color: DexColors.border),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: DexRadius.rsm,
                              borderSide:
                                  const BorderSide(color: DexColors.border),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: DexRadius.rsm,
                              borderSide:
                                  const BorderSide(color: DexColors.accent),
                            ),
                          ),
                        ),
                      ),
                    ..._grouped(widget.recentChats).expand((entry) => [
                      if (entry.$1 != null)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(
                            DexSpace.md, DexSpace.sm, DexSpace.md, 2,
                          ),
                          child: Text(
                            entry.$1!,
                            style: DexType.caption(color: DexColors.textFaint),
                          ),
                        ),
                      ...entry.$2.map(
                        (c) => _ChatRow(
                        chat: c,
                        active: c.id == widget.activeChatId,
                        onTap: () => widget.onSelectChat?.call(c),
                        onRename: widget.onRenameChat == null
                            ? null
                            : (name) => widget.onRenameChat!.call(c, name),
                        onDelete: widget.onDeleteChat == null
                            ? null
                            : () => widget.onDeleteChat!.call(c),
                        onRerun: widget.onRerunChat == null
                            ? null
                            : () => widget.onRerunChat!.call(c),
                      ),
                      ),
                    ]),
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

/// History, split into the buckets a person thinks in.
///
/// `when` is already a phrase — "2h ago" — and a phrase cannot be bucketed.
/// Twenty rows of "2h ago", "5h ago", "yesterday" read as one list; under
/// Today / Yesterday / Earlier the same rows are scannable.
///
/// Rows with no timestamp keep their order and get no heading, so a core from
/// before conversations existed still shows its history rather than nothing.
List<(String?, List<RecentChatItem>)> _grouped(List<RecentChatItem> chats) {
  if (chats.every((c) => c.at == null)) return [(null, chats)];

  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final yesterday = today.subtract(const Duration(days: 1));

  final buckets = <String, List<RecentChatItem>>{
    'Today': [],
    'Yesterday': [],
    'Earlier': [],
  };

  for (final chat in chats) {
    final at = chat.at;
    if (at == null) {
      buckets['Earlier']!.add(chat);
    } else if (!at.isBefore(today)) {
      buckets['Today']!.add(chat);
    } else if (!at.isBefore(yesterday)) {
      buckets['Yesterday']!.add(chat);
    } else {
      buckets['Earlier']!.add(chat);
    }
  }

  return [
    for (final entry in buckets.entries)
      if (entry.value.isNotEmpty) (entry.key, entry.value),
  ];
}

class _RailHeading extends StatelessWidget {
  const _RailHeading(this.label);
  final String label;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(
          DexSpace.md, DexSpace.md, DexSpace.md, DexSpace.xs,
        ),
        child: Text(
          label.toUpperCase(),
          style: DexType.caption(color: DexColors.textFaint).copyWith(
            letterSpacing: 0.8,
            fontWeight: FontWeight.w600,
          ),
        ),
      );
}

class _IconAction extends StatelessWidget {
  const _IconAction({required this.icon, required this.onTap});
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        borderRadius: DexRadius.rsm,
        child: Padding(
          padding: const EdgeInsets.all(3),
          child: Icon(icon, size: 13, color: DexColors.textFaint),
        ),
      );
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
    this.onTap,
  });

  final IconData icon;
  final String label;
  final bool expanded;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    const bg = Colors.transparent;
    // No Tooltip at all when the label is already on screen.
    //
    // This was `Tooltip(message: expanded ? '' : label)`, which still builds a
    // Tooltip — with its overlay entry and its own MouseRegion — in order to
    // show nothing. Six of them, on the one widget that is always mounted,
    // each arming a hover timer and inserting an overlay for an empty string.
    final row = Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
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
                ],
              ],
            ),
          ),
        ),
    );
    return expanded ? row : Tooltip(message: label, child: row);
  }
}

class _ChatRow extends StatefulWidget {
  const _ChatRow({
    required this.chat,
    required this.active,
    required this.onTap,
    this.onRename,
    this.onDelete,
    this.onRerun,
  });

  final RecentChatItem chat;
  final bool active;
  final VoidCallback onTap;
  final void Function(String name)? onRename;
  final VoidCallback? onDelete;
  final VoidCallback? onRerun;

  @override
  State<_ChatRow> createState() => _ChatRowState();
}

class _ChatRowState extends State<_ChatRow> {
  bool _hovered = false;

  /// Rename in place. A dialog for two words would be a lot of ceremony for
  /// something the owner is doing while scanning a list.
  Future<void> _rename() async {
    final controller = TextEditingController(text: widget.chat.title);
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: DexColors.surface,
        title: Text('Rename', style: DexType.label(color: DexColors.text)),
        content: TextField(
          controller: controller,
          autofocus: true,
          style: DexType.body(color: DexColors.text),
          onSubmitted: (value) => Navigator.of(context).pop(value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text('Cancel', style: DexType.label(color: DexColors.textDim)),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(controller.text),
            child: Text('Rename', style: DexType.label(color: DexColors.accent)),
          ),
        ],
      ),
    );
    if (name != null) widget.onRename?.call(name);
  }

  @override
  Widget build(BuildContext context) {
    final chat = widget.chat;
    final active = widget.active;
    final onTap = widget.onTap;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: InkWell(
        onTap: onTap,
        onHover: (over) => setState(() => _hovered = over),
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
              // A failed task keeps its place in the history and says so. The
              // ones that went wrong are usually the ones worth re-opening.
              if (chat.failed) ...[
                const Icon(LucideIcons.circle_x,
                    size: 12, color: DexColors.stateError),
                const SizedBox(width: DexSpace.xs),
              ],
              Expanded(
                child: Text(
                  chat.title,
                  style: DexType.label(
                    color: chat.failed ? DexColors.textDim : DexColors.text,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              // Only on hover or when this is the open one, so a list of
              // thirty threads reads as a list rather than a toolbar.
              if (_hovered || active)
                PopupMenuButton<String>(
                  tooltip: '',
                  padding: EdgeInsets.zero,
                  splashRadius: 14,
                  color: DexColors.surface,
                  icon: const Icon(LucideIcons.ellipsis,
                      size: 14, color: DexColors.textFaint),
                  onSelected: (choice) {
                    switch (choice) {
                      case 'rename':
                        _rename();
                      case 'rerun':
                        widget.onRerun?.call();
                      case 'delete':
                        widget.onDelete?.call();
                    }
                  },
                  itemBuilder: (context) => [
                    if (widget.onRename != null)
                      _menuItem('rename', LucideIcons.pencil, 'Rename'),
                    if (widget.onRerun != null)
                      _menuItem('rerun', LucideIcons.rotate_ccw, 'Run again'),
                    if (widget.onDelete != null)
                      _menuItem('delete', LucideIcons.trash_2, 'Delete',
                          colour: DexColors.stateError),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}

PopupMenuItem<String> _menuItem(
  String value,
  IconData icon,
  String label, {
  Color colour = DexColors.text,
}) {
  return PopupMenuItem<String>(
    value: value,
    height: 34,
    child: Row(
      children: [
        Icon(icon, size: 14, color: colour),
        const SizedBox(width: DexSpace.sm),
        Text(label, style: DexType.label(color: colour)),
      ],
    ),
  );
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
        shape: BoxShape.circle,
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            kDexMenuAccentSurface,
            kDexMenuTint,
          ],
        ),
        border: Border.all(color: kDexMenuAccentBorder),
      ),
      child: Text(initial, style: DexType.label(color: DexColors.accent)),
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
