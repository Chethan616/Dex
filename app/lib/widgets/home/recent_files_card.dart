// "Attach a recent file to chat" card. v1 stub: feed it a list of recent
// filenames from the host; tapping a row routes through onSelect.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../theme/tokens.dart';
import 'home_card.dart';

class RecentFileItem {
  const RecentFileItem({
    required this.name,
    required this.when,
    this.icon = LucideIcons.file,
  });
  final String name;
  final String when;
  final IconData icon;
}

class RecentFilesCard extends StatelessWidget {
  const RecentFilesCard({
    super.key,
    required this.files,
    this.onSelect,
  });

  final List<RecentFileItem> files;
  final ValueChanged<RecentFileItem>? onSelect;

  @override
  Widget build(BuildContext context) {
    return HomeCard(
      icon: LucideIcons.paperclip,
      title: 'Attach a recent file to chat',
      trailing: const Icon(LucideIcons.info,
          size: 14, color: DexColors.textFaint),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: files
            .map((f) => _Row(file: f, onTap: () => onSelect?.call(f)))
            .toList(growable: false),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.file, required this.onTap});
  final RecentFileItem file;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: InkWell(
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
              child: Icon(file.icon, size: 14, color: DexColors.textDim),
            ),
            const SizedBox(width: DexSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(file.name,
                      style: DexType.label(color: DexColors.text),
                      overflow: TextOverflow.ellipsis),
                  Text(file.when,
                      style: DexType.caption(color: DexColors.textFaint)),
                ],
              ),
            ),
            const Icon(LucideIcons.ellipsis,
                size: 14, color: DexColors.textFaint),
          ],
        ),
      ),
      ),
    );
  }
}
