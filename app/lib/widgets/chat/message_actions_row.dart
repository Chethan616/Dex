// Action row rendered under an agent message: like / dislike / share /
// copy / read-aloud / regenerate / open-in-page. All actions are
// optional callbacks so screens can disable any subset.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../theme/tokens.dart';

class MessageActionsRow extends StatelessWidget {
  const MessageActionsRow({
    super.key,
    this.onLike,
    this.onDislike,
    this.onShare,
    this.onCopy,
    this.onReadAloud,
    this.onRegenerate,
    this.onEditInPage,
  });

  final VoidCallback? onLike;
  final VoidCallback? onDislike;
  final VoidCallback? onShare;
  final VoidCallback? onCopy;
  final VoidCallback? onReadAloud;
  final VoidCallback? onRegenerate;
  final VoidCallback? onEditInPage;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: DexSpace.sm, bottom: DexSpace.xs),
      child: Row(
        children: [
          _IconAction(
            icon: LucideIcons.thumbs_up,
            tooltip: 'Like',
            onTap: onLike,
          ),
          _IconAction(
            icon: LucideIcons.thumbs_down,
            tooltip: 'Dislike',
            onTap: onDislike,
          ),
          _IconAction(
            icon: LucideIcons.share_2,
            tooltip: 'Share',
            onTap: onShare,
          ),
          _IconAction(
            icon: LucideIcons.copy,
            tooltip: 'Copy',
            onTap: onCopy,
          ),
          _IconAction(
            icon: LucideIcons.volume_2,
            tooltip: 'Read aloud',
            onTap: onReadAloud,
          ),
          _IconAction(
            icon: LucideIcons.refresh_cw,
            tooltip: 'Regenerate',
            onTap: onRegenerate,
          ),
          const SizedBox(width: DexSpace.sm),
          if (onEditInPage != null)
            TextButton.icon(
              onPressed: onEditInPage,
              icon: const Icon(LucideIcons.pencil, size: 14),
              label: Text('Edit in a page',
                  style: DexType.label(color: DexColors.text)),
              style: TextButton.styleFrom(
                foregroundColor: DexColors.text,
                padding: const EdgeInsets.symmetric(
                  horizontal: DexSpace.sm, vertical: DexSpace.xs,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _IconAction extends StatelessWidget {
  const _IconAction({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });
  final IconData icon;
  final String tooltip;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: onTap != null
          ? SystemMouseCursors.click
          : SystemMouseCursors.basic,
      child: Tooltip(
        message: tooltip,
        child: InkResponse(
          onTap: onTap,
          radius: 16,
          child: Container(
            width: 28,
            height: 28,
            alignment: Alignment.center,
            child: Icon(icon, size: 14, color: DexColors.textDim),
          ),
        ),
      ),
    );
  }
}
