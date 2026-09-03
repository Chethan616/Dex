// The Copilot-style desktop shell:
//
//   DexSidebar | (EmptyHome | ChatView) | ActionPreviewPanel (slide-in)
//
// The sidebar is collapsible. The center pane shows EmptyHome until the
// first message lands in the ConversationStore, then it swaps to ChatView.
// ActionPreviewPanel slides in from the right whenever the store has a
// pending approval -- preserving the design.md trust UX inside the new
// chrome.

import 'package:flutter/material.dart';

import '../core/dex_gateway.dart';
import '../core/models/agent_state.dart';
import '../core/state/conversation_store.dart';
import '../theme/tokens.dart';
import '../widgets/chat/action_preview_panel.dart';
import '../widgets/chat/chat_view.dart';
import '../widgets/composer/add_menu.dart';
import '../widgets/dex_sidebar.dart';
import '../widgets/dialog/permission_dialog.dart';
import '../widgets/home/empty_home.dart';
import '../widgets/home/recent_chats_card.dart';
import '../widgets/home/recent_files_card.dart';
import '../widgets/living_background.dart';
import 'reminders_screen.dart';
import '../widgets/profile/profile_menu.dart';
import '../widgets/settings/settings_dialog.dart';
import '../widgets/vision/vision_panel.dart';
import '../widgets/voice/voice_mode_screen.dart';

class HomeDesktop extends StatefulWidget {
  const HomeDesktop({super.key, required this.store, this.onSignOut});
  final ConversationStore store;

  /// Provided by the app root: clears the local account flag and
  /// routes back to the login screen.
  final VoidCallback? onSignOut;

  @override
  State<HomeDesktop> createState() => _HomeDesktopState();
}

class _HomeDesktopState extends State<HomeDesktop> {
  bool _sidebarExpanded = true;
  bool _visionOpen = false;
  bool _micGranted = false;

  static const _greetingName = 'there';

  static const List<String> _suggestions = <String>[
    'Open Excel and total column B',
    'Find a file on this PC',
    'Take a screenshot of this app',
    'Summarise the open browser tab',
    'Read my last email',
    'Start a new project',
    'Draft a reply',
    'Show me what you can do',
  ];

  static const List<RecentFileItem> _recentFiles = <RecentFileItem>[
    RecentFileItem(name: 'design.md', when: 'Today'),
    RecentFileItem(name: 'PLAN.md', when: 'Yesterday'),
    RecentFileItem(name: 'README.md', when: 'Yesterday'),
  ];

  /// What was actually asked, newest first.
  ///
  /// The conversations, from what was actually said.
  ///
  /// These four rows were `const` to begin with — "Change Wi-Fi DNS to
  /// 1.1.1.1", "Export Figma frame as PNG", "Searching for pebble.exe file",
  /// "Find my Aadhaar card". None of them had ever happened, and a history
  /// that is decoration is worse than none: it is the one part of the app
  /// whose whole job is to be a record.
  ///
  /// Then it read the task list, which was real but was a list of *requests* —
  /// so clicking a row could only re-run it, because the request was the only
  /// thing stored. Now it reads conversations, and a click opens one.
  List<RecentChatItem> get _recentChats {
    final client = DexGatewayClient.current;
    final threads = client?.conversations ?? const <Map<String, dynamic>>[];

    if (threads.isNotEmpty) {
      return [
        for (final thread in threads.take(30))
          RecentChatItem(
            id: thread['id'] as String? ?? '',
            title: (thread['title'] as String? ?? '').trim(),
            when: _ago((thread['lastAt'] as num?)?.toInt()),
            // Failures stay in the list. A record that quietly drops what went
            // wrong is a highlight reel, and the failures are the ones worth
            // seeing again.
            failed: thread['failed'] == true,
          ),
      ].where((c) => c.title.isNotEmpty && c.id.isNotEmpty).toList(growable: false);
    }

    // Nothing stored yet — a fresh install, or a core from before
    // conversations existed. The task list still says what was asked, and a
    // row from it re-runs rather than opening, because there is no thread to
    // open. Better than an empty sidebar that implies nothing has happened.
    final tasks = client?.history ?? const [];
    return [
      for (final task in tasks.take(20))
        RecentChatItem(
          id: task['requestId'] as String? ?? '',
          title: (task['text'] as String? ?? '').trim(),
          when: _ago(task['startedAt'] as int?),
          failed: _isFailure(task['status'] as String?),
        ),
    ].where((c) => c.title.isNotEmpty).toList(growable: false);
  }

  /// Whether this row is a conversation that can be opened, or an old task row.
  bool _isConversation(String id) =>
      (DexGatewayClient.current?.conversations ?? const [])
          .any((c) => c['id'] == id);

  /// Open a screen by name, for the slash commands.
  ///
  /// The composer asks for 'workflows' or 'schedules' rather than pushing a
  /// route itself: which screens exist and how they open belongs here, and a
  /// command that hard-codes a route breaks quietly the day the route moves.
  void _openScreen(String screen) {
    switch (screen) {
      case 'workflows':
        SettingsDialog.show(context, initial: SettingsTab.memory);
      case 'schedules':
      case 'reminders':
        RemindersScreen.show(context, widget.store);
    }
  }

  static bool _isFailure(String? status) =>
      status != null && status != 'COMPLETED' && status != 'ANSWERED';

  static String _ago(int? epochMs) {
    if (epochMs == null) return '';
    final then = DateTime.fromMillisecondsSinceEpoch(epochMs);
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(then.year, then.month, then.day);
    final days = today.difference(day).inDays;

    if (days <= 0) return 'Today';
    if (days == 1) return 'Yesterday';
    if (days < 7) return '$days days ago';
    if (days < 14) return 'Last week';
    return '${then.day}/${then.month}';
  }

  @override
  void initState() {
    super.initState();
    // The list is only as good as the last refresh. Once when the core comes
    // up, and again whenever the store settles, which is when a task has just
    // finished and added a row.
    DexGatewayClient.current?.refreshHistory();
    DexGatewayClient.current?.listConversations();
    widget.store.addListener(_onStoreChanged);
  }

  @override
  void dispose() {
    widget.store.removeListener(_onStoreChanged);
    super.dispose();
  }

  bool _wasBusy = false;

  void _onStoreChanged() {
    // Only on the busy -> idle edge. Refreshing on every frame of a streaming
    // task would ask the core for the history sixty times a second.
    final busy = widget.store.isBusy;
    if (_wasBusy && !busy) {
      DexGatewayClient.current?.refreshHistory();
      // The turn just ended, so the thread it belonged to has a new last
      // message and probably a title it did not have before.
      DexGatewayClient.current?.listConversations();
    }
    _wasBusy = busy;
  }

  void _toggleSidebar() => setState(() => _sidebarExpanded = !_sidebarExpanded);

  // Routes a profile-popover action to its real destination. The popover
  // (GlassPopover in the sidebar) closes itself before calling this.
  Future<void> _handleProfileAction(ProfileMenuAction action) async {
    // Wait for the popup menu's exit animation to finish before starting a heavy
    // dialog animation to avoid overlapping BackdropFilters, which causes stutter.
    await Future.delayed(const Duration(milliseconds: 350));
    if (!mounted) return;
    switch (action) {
      case ProfileMenuAction.settings:
        await SettingsDialog.show(context);
      case ProfileMenuAction.memory:
        await SettingsDialog.show(context, initial: SettingsTab.memory);
      case ProfileMenuAction.reminders:
        await RemindersScreen.show(context, widget.store);
      case ProfileMenuAction.feedback:
        // feedback flow lands in a follow-up
        break;
      case ProfileMenuAction.signOut:
        widget.onSignOut?.call();
    }
  }

  Future<void> _openVoice() async {
    if (!_micGranted) {
      final granted = await PermissionDialog.show(
        context,
        title: 'Let Dex use your microphone?',
        description: 'You can change this later in Settings.',
      );
      if (granted != true || !mounted) return;
      setState(() => _micGranted = true);
    }
    if (!mounted) return;
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => const VoiceModeScreen(),
      fullscreenDialog: true,
    ));
  }

  void _toggleVision() => setState(() => _visionOpen = !_visionOpen);

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.store,
      builder: (context, _) {
        final hasMessages = widget.store.messages.isNotEmpty;
        return Scaffold(
          body: LivingBackground(
            activity: widget.store,
            isActive: () => widget.store.state == AgentState.acting,
            child: SafeArea(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  DexSidebar(
                    expanded: _sidebarExpanded,
                    onToggle: _toggleSidebar,
                    recentChats: _recentChats,
                    // The open thread is marked, so the sidebar says which
                    // conversation the screen is showing.
                    activeChatId: widget.store.isFresh
                        ? null
                        : widget.store.conversationId,
                    userName: 'Dex user',
                    // Starts a *new thread*, not just an empty screen. The
                    // old one stays on disk; this stops writing to it.
                    onNewChat: widget.store.newConversation,
                    // Each one opens a screen that exists and shows live data.
                    // Six of these used to be null, so the rail looked broken.
                    onWorkflows: () =>
                        SettingsDialog.show(context, initial: SettingsTab.memory),
                    onSchedules: () =>
                        RemindersScreen.show(context, widget.store),
                    onCapabilities: () => SettingsDialog.show(
                        context, initial: SettingsTab.connectors),
                    onLogs: () => SettingsDialog.show(
                        context, initial: SettingsTab.diagnostics),
                    onSettings: () => SettingsDialog.show(context),
                    onProfileAction: _handleProfileAction,
                    // Re-ask it. Deliberately not "reopen the conversation":
                    // messages have never been persisted, so restoring one
                    // would show an empty transcript under a real title, which
                    // is a worse lie than starting the task again.
                    onSelectChat: (chat) {
                      // Open it. Re-running was never what a click on history
                      // should mean — it is just all a click could do while
                      // the request was the only thing stored.
                      if (_isConversation(chat.id)) {
                        widget.store.openConversation(chat.id);
                      } else {
                        widget.store.sendHumanMessage(chat.title);
                      }
                    },
                    onRenameChat: (chat, name) =>
                        DexGatewayClient.current?.renameConversation(chat.id, name),
                    onDeleteChat: (chat) =>
                        DexGatewayClient.current?.deleteConversation(chat.id),
                    onRerunChat: (chat) =>
                        widget.store.sendHumanMessage(chat.title),
                  ),
                  Expanded(
                    child: Stack(
                      children: [
                        Positioned.fill(
                          child: hasMessages
                              ? ChatView(
                                  store: widget.store,
                                  title: 'Conversation',
                                  onVision: _toggleVision,
                                  onVoice: _openVoice,
                                  onAddAction: _handleAdd,
                                  onClear: widget.store.clearMessages,
                                  onNewChat: widget.store.newConversation,
                                  onOpenScreen: _openScreen,
                                )
                              : EmptyHome(
                                  greetingName: _greetingName,
                                  suggestions: _suggestions,
                                  recentFiles: _recentFiles,
                                  recentChats: _recentChats,
                                  onSubmit: widget.store.sendHumanMessage,
                                  isBusy: widget.store.isBusy,
                                  onStop: widget.store.stop,
                                  onVision: _toggleVision,
                                  onVoice: _openVoice,
                                  onAddAction: _handleAdd,
                                  onClear: widget.store.clearMessages,
                                  onNewChat: widget.store.newConversation,
                                  onOpenScreen: _openScreen,
                                ),
                        ),
                        if (_visionOpen)
                          Positioned(
                            right: DexSpace.lg,
                            bottom: DexSpace.xxxl,
                            child: VisionPanel(onClose: _toggleVision),
                          ),
                      ],
                    ),
                  ),
                  ActionPreviewPanel(
                    preview: widget.store.pending,
                    onApprove: widget.store.approve,
                    onDeny: widget.store.deny,
                    waiting: widget.store.approvalsWaiting,
                    onApproveAll: widget.store.approveAll,
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  /// What is left of the + menu after the composer has handled its own.
  ///
  /// Attaching files and taking a screenshot both end in an attachment, so the
  /// composer does those itself. Connectors is a screen, so it lands here.
  ///
  /// This used to be the whole handler, and all it did was show a snackbar
  /// with the label of the thing that had not happened.
  void _handleAdd(ComposerAddAction action) {
    if (action == ComposerAddAction.connectors) {
      SettingsDialog.show(context, initial: SettingsTab.connectors);
    }
  }
}
