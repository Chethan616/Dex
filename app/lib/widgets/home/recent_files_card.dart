// "Attach a recent file to chat" card. v1 stub: feed it a list of recent
// filenames from the host; tapping a row routes through onSelect.

import 'package:flutter/material.dart';

import '../../theme/tokens.dart';
import 'home_card.dart';

class RecentFileItem {
  const RecentFileItem({
    required this.name,
    required this.when,
    this.icon = Icons.insert_drive_file_outlined,
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
      icon: Icons.attach_file_rounded,
      title: 'Attach a recent file to chat',
      trailing: const Icon(Icons.info_outline_rounded,
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
            const Icon(Icons.more_horiz_rounded,
                size: 14, color: DexColors.textFaint),
          ],
        ),
      ),
    );
  }
}
