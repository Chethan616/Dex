// The empty-state home surface. Centered greeting, big composer, suggestion
// chips, and a two-card row of recent files + recent chats below.

import 'package:flutter/material.dart';

import '../../theme/tokens.dart';
import '../composer/add_menu.dart';
import '../composer/dex_composer.dart';
import 'recent_chats_card.dart';
import 'recent_files_card.dart';
import 'suggestion_chip.dart';

class EmptyHome extends StatelessWidget {
  const EmptyHome({
    super.key,
    required this.greetingName,
    required this.suggestions,
    required this.recentFiles,
    required this.recentChats,
    required this.onSubmit,
    this.isBusy = false,
    this.onStop,
    this.onVision,
    this.onVoice,
    this.onAddAction,
    this.onSelectFile,
    this.onSelectChat,
  });

  final String greetingName;
  final List<String> suggestions;
  final List<RecentFileItem> recentFiles;
  final List<RecentChatItem> recentChats;
  final ValueChanged<String> onSubmit;
  final bool isBusy;
  final VoidCallback? onStop;
  final VoidCallback? onVision;
  final VoidCallback? onVoice;
  final ValueChanged<ComposerAddAction>? onAddAction;
  final ValueChanged<RecentFileItem>? onSelectFile;
  final ValueChanged<RecentChatItem>? onSelectChat;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 900;
        return SingleChildScrollView(
          padding: const EdgeInsets.symmetric(
            horizontal: DexSpace.xxl, vertical: DexSpace.xxl,
          ),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 880),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SizedBox(height: DexSpace.xxxl),
                  Text(
                    'Hi $greetingName, what should we dive into today?',
                    textAlign: TextAlign.center,
                    style: DexType.title(color: DexColors.text),
                  ),
                  const SizedBox(height: DexSpace.xl),
                  DexComposer(
                    onSubmit: onSubmit,
                    isBusy: isBusy,
                    onStop: onStop,
                    onVision: onVision,
                    onVoice: onVoice,
                    onAddAction: onAddAction,
                  ),
                  const SizedBox(height: DexSpace.lg),
                  Wrap(
                    alignment: WrapAlignment.center,
                    spacing: DexSpace.sm,
                    runSpacing: DexSpace.sm,
                    children: suggestions
                        .map((s) => SuggestionChip(
                              label: s,
                              onTap: () => onSubmit(s),
                            ))
                        .toList(growable: false),
                  ),
                  const SizedBox(height: DexSpace.xxl),
                  _Cards(
                    wide: wide,
                    files: recentFiles,
                    chats: recentChats,
                    onSelectFile: onSelectFile,
                    onSelectChat: onSelectChat,
                  ),
                  const SizedBox(height: DexSpace.xxl),
                  Text(
                    'Dex is an agent and may make mistakes. Every action shows a preview first.',
                    textAlign: TextAlign.center,
                    style: DexType.caption(color: DexColors.textFaint),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _Cards extends StatelessWidget {
  const _Cards({
    required this.wide,
    required this.files,
    required this.chats,
    required this.onSelectFile,
    required this.onSelectChat,
  });

  final bool wide;
  final List<RecentFileItem> files;
  final List<RecentChatItem> chats;
  final ValueChanged<RecentFileItem>? onSelectFile;
  final ValueChanged<RecentChatItem>? onSelectChat;

  @override
  Widget build(BuildContext context) {
    final filesCard = RecentFilesCard(files: files, onSelect: onSelectFile);
    final chatsCard = RecentChatsCard(chats: chats, onSelect: onSelectChat);
    if (!wide) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          filesCard,
          const SizedBox(height: DexSpace.md),
          chatsCard,
        ],
      );
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: filesCard),
        const SizedBox(width: DexSpace.md),
        Expanded(child: chatsCard),
      ],
    );
  }
}
