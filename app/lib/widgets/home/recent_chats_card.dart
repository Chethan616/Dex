// "Keep talking to Dex" card -- recent conversations list rendered as
// a HomeCard. Tapping a row opens the conversation through onSelect.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../theme/tokens.dart';
import 'home_card.dart';

class RecentChatItem {
  const RecentChatItem({required this.id, required this.title, required this.when});
  final String id;
  final String title;
  final String when;
}

class RecentChatsCard extends StatelessWidget {
  const RecentChatsCard({
    super.key,
    required this.chats,
    this.onSelect,
  });

  final List<RecentChatItem> chats;
  final ValueChanged<RecentChatItem>? onSelect;

  @override
  Widget build(BuildContext context) {
    return HomeCard(
      icon: LucideIcons.message_square,
      title: 'Keep talking to Dex',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: chats
            .map((c) => _Row(chat: c, onTap: () => onSelect?.call(c)))
            .toList(growable: false),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.chat, required this.onTap});
  final RecentChatItem chat;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: DexRadius.rsm,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: DexSpace.sm, vertical: DexSpace.sm,
        ),
        child: Row(
          children: [
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: DexColors.surface,
                borderRadius: DexRadius.rsm,
                border: Border.all(color: DexColors.border),
              ),
              child: const Icon(LucideIcons.message_square,
                  size: 12, color: DexColors.textDim),
            ),
            const SizedBox(width: DexSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(chat.title,
                      style: DexType.label(color: DexColors.text),
                      overflow: TextOverflow.ellipsis),
                  Text(chat.when,
                      style: DexType.caption(color: DexColors.textFaint)),
                ],
              ),
            ),
            const Icon(LucideIcons.ellipsis,
                size: 14, color: DexColors.textFaint),
          ],
        ),
      ),
    );
  }
}
