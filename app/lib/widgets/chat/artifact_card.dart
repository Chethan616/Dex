// The result of a step, drawn instead of read out.
//
// This replaces a paragraph that looked like this:
//
//   find files: count 20, root C:\Users\cheth\Downloads, query dex,
//   matches name=DEX_V3_Project_Report_final.docx path=C:\Users\cheth\
//   Downloads\DEX_V3_Project_Report_final.docx directory=C:\Users\cheth\
//   Downloads, name=… (+12 more)
//
// Every fact present, none of it readable: the path three times per result,
// the fields named as if the reader were debugging JSON, and the one thing
// wanted — which file, can I open it — buried in the middle.
//
// So: one row per result, the name first, the folder underneath in mono, and
// the reason it matched as a small tag. A file matched by the text inside it
// shows the line that matched, because that is the evidence — it is what
// distinguishes the Aadhaar card saved as `scan001.jpg` from a guess.
//
// Styling follows TaskPlanCard exactly: the same DexGlass panel, the same
// heading row with a Lucide icon and a count on the right, the same spacing
// scale. Nothing here introduces a colour, a gradient or a font of its own.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../core/models/artifact.dart';
import '../../theme/tokens.dart';
import '../dex_glass.dart';

class ArtifactCard extends StatelessWidget {
  const ArtifactCard({super.key, required this.artifact});

  final Artifact artifact;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DexSpace.sm),
      child: DexGlass(
        radius: 14,
        padding: const EdgeInsets.all(DexSpace.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                const Icon(LucideIcons.file_search,
                    size: 15, color: DexColors.accent),
                const SizedBox(width: DexSpace.xs),
                Expanded(
                  child: Text(
                    artifact.title,
                    style: DexType.label(color: DexColors.text),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (artifact.total > artifact.items.length)
                  Text(
                    'showing ${artifact.items.length}',
                    style: DexType.caption(color: DexColors.textFaint),
                  ),
              ],
            ),
            if (artifact.note != null) ...[
              const SizedBox(height: 2),
              Text(
                artifact.note!,
                style: DexType.caption(color: DexColors.textFaint),
              ),
            ],
            const SizedBox(height: DexSpace.sm),
            for (final item in artifact.items) _ItemRow(item: item),
          ],
        ),
      ),
    );
  }
}

class _ItemRow extends StatefulWidget {
  const _ItemRow({required this.item});
  final ArtifactItem item;

  @override
  State<_ItemRow> createState() => _ItemRowState();
}

class _ItemRowState extends State<_ItemRow> {
  bool _hovered = false;

  /// Show the file in Explorer, selected.
  ///
  /// Opening the *folder* rather than the file is deliberate. Dex is not
  /// deciding to launch whatever program is registered for a `.pdf`; it is
  /// showing the owner where the thing is and letting them decide.
  Future<void> _reveal() async {
    final path = widget.item.detail;
    if (path == null) return;
    try {
      await Process.run('explorer.exe', ['/select,', path]);
    } on ProcessException {
      // Nothing to report — a file that has moved since the search is not an
      // error worth a dialog.
    }
  }

  Future<void> _copyPath() async {
    final path = widget.item.detail;
    if (path == null) return;
    await Clipboard.setData(ClipboardData(text: path));
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final folder = _folderOf(item.detail);

    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: _reveal,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          margin: const EdgeInsets.only(bottom: 2),
          padding: const EdgeInsets.symmetric(
            horizontal: DexSpace.sm,
            vertical: 6,
          ),
          decoration: BoxDecoration(
            color: _hovered ? DexColors.accentQuiet : Colors.transparent,
            borderRadius: DexRadius.rsm,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Icon(_iconFor(item.label),
                    size: 14, color: DexColors.textDim),
              ),
              const SizedBox(width: DexSpace.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            item.label,
                            style: DexType.body(color: DexColors.text),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (item.bytes != null) ...[
                          const SizedBox(width: DexSpace.sm),
                          Text(
                            _size(item.bytes!),
                            style: DexType.caption(color: DexColors.textFaint),
                          ),
                        ],
                      ],
                    ),
                    if (folder != null)
                      Text(
                        folder,
                        style: DexType.caption(color: DexColors.textFaint),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    if (item.excerpt != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 3),
                        child: Text(
                          item.excerpt!,
                          style: DexType.caption(color: DexColors.textDim),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    if (item.reasons.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Wrap(
                          spacing: DexSpace.xs,
                          runSpacing: DexSpace.xs,
                          children: [
                            for (final reason in item.reasons)
                              _ReasonTag(text: reason),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
              // Only on hover, so a list of twelve results is a list of
              // results and not a list of buttons.
              if (_hovered) ...[
                const SizedBox(width: DexSpace.xs),
                _QuietButton(
                  icon: LucideIcons.copy,
                  tooltip: 'Copy path',
                  onTap: _copyPath,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Why this result is in the answer. Quiet by design — it is a footnote on the
/// row, not a badge competing with the filename.
class _ReasonTag extends StatelessWidget {
  const _ReasonTag({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: DexColors.accentQuiet,
        borderRadius: DexRadius.rsm,
      ),
      child: Text(text, style: DexType.caption(color: DexColors.textDim)),
    );
  }
}

class _QuietButton extends StatelessWidget {
  const _QuietButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final Future<void> Function() onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: GestureDetector(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(4),
          child: Icon(icon, size: 13, color: DexColors.textFaint),
        ),
      ),
    );
  }
}

String? _folderOf(String? path) {
  if (path == null || path.isEmpty) return null;
  final cut = path.lastIndexOf(RegExp(r'[\\/]'));
  return cut <= 0 ? null : path.substring(0, cut);
}

String _size(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} KB';
  if (bytes < 1024 * 1024 * 1024) {
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
  return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
}

/// The file's kind, from its extension. Icons only — no colour coding, which
/// would add a second visual language to a list that already reads fine.
IconData _iconFor(String name) {
  final dot = name.lastIndexOf('.');
  final ext = dot == -1 ? '' : name.substring(dot + 1).toLowerCase();
  return switch (ext) {
    'pdf' => LucideIcons.file_text,
    'doc' || 'docx' || 'odt' || 'rtf' || 'txt' || 'md' => LucideIcons.file_text,
    'xls' || 'xlsx' || 'csv' => LucideIcons.table,
    'ppt' || 'pptx' => LucideIcons.presentation,
    'png' || 'jpg' || 'jpeg' || 'gif' || 'webp' || 'bmp' ||
    'tif' || 'tiff' || 'svg' => LucideIcons.image,
    'mp4' || 'mkv' || 'mov' || 'avi' || 'webm' => LucideIcons.video,
    'mp3' || 'wav' || 'flac' || 'm4a' || 'aac' => LucideIcons.music,
    'zip' || 'rar' || '7z' || 'tar' || 'gz' => LucideIcons.file_archive,
    'exe' || 'msi' => LucideIcons.app_window,
    _ => LucideIcons.file,
  };
}
