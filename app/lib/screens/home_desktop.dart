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

  static const List<RecentChatItem> _recentChats = <RecentChatItem>[
    RecentChatItem(
      id: 'dns',
      title: 'Change Wi-Fi DNS to 1.1.1.1',
      when: 'Today',
    ),
    RecentChatItem(
      id: 'figma',
      title: 'Export Figma frame as PNG',
      when: 'Yesterday',
    ),
    RecentChatItem(
      id: 'pebble',
      title: 'Searching for pebble.exe file',
      when: 'Saturday',
    ),
    RecentChatItem(
      id: 'aadhaar',
      title: 'Find my Aadhaar card',
      when: '2 days ago',
    ),
  ];

  void _toggleSidebar() => setState(() => _sidebarExpanded = !_sidebarExpanded);

  void _openProfile() async {
    final picked = await ProfileMenu.show(context);
    if (!mounted || picked == null) return;
    // Route each profile menu action to its real destination. Settings
    // opens straight onto the right tab so Memory / Reminders feel
    // like first-class screens rather than "go find it in Settings".
    // Reminders has no real screen yet; routes to Settings preferences
    // until the Reminders screen lands in the next commit.
    switch (picked) {
      case ProfileMenuAction.settings:
        await SettingsDialog.show(context);
      case ProfileMenuAction.memory:
        await SettingsDialog.show(context, initial: SettingsTab.memory);
      case ProfileMenuAction.reminders:
        await RemindersScreen.show(context, widget.store);
      case ProfileMenuAction.feedback:
        // existing -- feedback flow lands in a follow-up
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
                    activeChatId: null,
                    userName: 'Dex user',
                    onNewChat: widget.store.clearMessages,
                    onAvatarTap: _openProfile,
                    onSelectChat: (_) {},
                  ),
                  Expanded(
                    child: Stack(
                      children: [
                        Positioned.fill(
                          child: hasMessages
                              ? ChatView(
                                  store: widget.store,
                                  title: 'Conversation',
                                  onInvite: () {},
                                  onVision: _toggleVision,
                                  onVoice: _openVoice,
                                  onAddAction: _handleAdd,
                                  onClear: widget.store.clearMessages,
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
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  void _handleAdd(ComposerAddAction action) {
    final messenger = ScaffoldMessenger.maybeOf(context);
    messenger?.showSnackBar(
      SnackBar(
        content: Text(action.label),
        backgroundColor: DexColors.surface2,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}
