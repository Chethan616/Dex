// Action row rendered under an agent message: like / dislike / share /
// copy / read-aloud / regenerate / open-in-page. All actions are
// optional callbacks so screens can disable any subset.

import 'package:flutter/material.dart';

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
            icon: Icons.thumb_up_outlined,
            tooltip: 'Like',
            onTap: onLike,
          ),
          _IconAction(
            icon: Icons.thumb_down_outlined,
            tooltip: 'Dislike',
            onTap: onDislike,
          ),
          _IconAction(
            icon: Icons.share_outlined,
            tooltip: 'Share',
            onTap: onShare,
          ),
          _IconAction(
            icon: Icons.content_copy_outlined,
            tooltip: 'Copy',
            onTap: onCopy,
          ),
          _IconAction(
            icon: Icons.volume_up_outlined,
            tooltip: 'Read aloud',
            onTap: onReadAloud,
          ),
          _IconAction(
            icon: Icons.refresh_rounded,
            tooltip: 'Regenerate',
            onTap: onRegenerate,
          ),
          const SizedBox(width: DexSpace.sm),
          if (onEditInPage != null)
            TextButton.icon(
              onPressed: onEditInPage,
              icon: const Icon(Icons.edit_outlined, size: 14),
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
    return Tooltip(
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
    );
  }
}
