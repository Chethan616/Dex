// ConnectorGuideSheet — the in-app "how to link this app" viewer.
//
// Loads assets/guides/<id>.md and renders it with a small, dependency-free
// markdown subset (#/## headings, - bullets, 1. steps, **bold**, `code`,
// paragraphs). Shown when the user taps an app tile in onboarding or opens
// a connector's detail. Guides live as real .md files under assets/guides/
// so they're editable on their own.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../theme/motion.dart';
import '../../theme/tokens.dart';
import '../dex_glass.dart';
import '../menu_glass.dart';
import '../glass_badge_button.dart';

class ConnectorGuideSheet extends StatelessWidget {
  const ConnectorGuideSheet({
    super.key,
    required this.connectorId,
    required this.title,
  });

  final String connectorId;
  final String title;

  /// Whether a bundled guide exists for [connectorId]. Used by callers to
  /// decide if a "How to link" affordance should appear. Kept in sync with
  /// the files under assets/guides/.
  static const Set<String> available = <String>{
    'whatsapp', 'telegram', 'discord', 'slack', 'signal', 'voice-call',
    'imessage', 'matrix', 'msteams', 'googlechat',
  };

  static bool hasGuide(String id) => available.contains(id);

  static Future<void> show(
    BuildContext context, {
    required String connectorId,
    required String title,
  }) async {
    kGlassMenuOpenCount.value++;
    try {
      return await showGeneralDialog<void>(
        context: context,
        barrierDismissible: true,
        barrierLabel: 'Dismiss guide',
        barrierColor: Colors.black.withValues(alpha: 0.4),
        transitionDuration: DexMotion.dialog,
        pageBuilder: (_, _, _) =>
            ConnectorGuideSheet(connectorId: connectorId, title: title),
        transitionBuilder: (ctx, anim, _, child) {
          // if (MediaQuery.of(ctx).disableAnimations) return child;
          // final eased = CurvedAnimation(parent: anim, curve: DexMotion.dampened);
          return DexMotion.buildDialogTransition(ctx, anim, child);
        },
      );
    } finally {
      kGlassMenuOpenCount.value--;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.transparency,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560, maxHeight: 640),
          child: DexGlass(
            radius: 20,
            child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(
                          DexSpace.lg, DexSpace.md, DexSpace.sm, DexSpace.sm),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text('Connect $title',
                                style: DexType.heading(color: DexColors.text)),
                          ),
                          GlassBadgeButton(
                            icon: LucideIcons.x,
                            onTap: () => Navigator.of(context).maybePop(),
                            size: 32,
                            iconColor: DexColors.stateError,
                            glowColor: DexColors.stateError,
                          ),
                        ],
                      ),
                    ),
                    const Divider(height: 1, color: DexColors.border),
                    Flexible(
                      child: FutureBuilder<String>(
                        future: rootBundle
                            .loadString('assets/guides/$connectorId.md'),
                        builder: (context, snap) {
                          if (!snap.hasData) {
                            return const Padding(
                              padding: EdgeInsets.all(DexSpace.xl),
                              child: Center(
                                child: SizedBox(
                                  width: 18,
                                  height: 18,
                                  child:
                                      CircularProgressIndicator(strokeWidth: 2),
                                ),
                              ),
                            );
                          }
                          return SingleChildScrollView(
                            padding: const EdgeInsets.all(DexSpace.lg),
                            child: _Markdown(source: snap.data!),
                          );
                        },
                      ),
                    ),
                  ],
                ),
            ),
        ),
      ),
    );
  }
}

/// Minimal markdown renderer for the guide subset we author. Not a general
/// parser — just enough for clean headings, bullets, steps, and inline
/// bold/code without pulling in a dependency.
class _Markdown extends StatelessWidget {
  const _Markdown({required this.source});
  final String source;

  @override
  Widget build(BuildContext context) {
    final blocks = <Widget>[];
    for (final raw in source.split('\n')) {
      final line = raw.trimRight();
      if (line.isEmpty) {
        blocks.add(const SizedBox(height: DexSpace.sm));
        continue;
      }
      if (line.startsWith('# ')) {
        blocks.add(Padding(
          padding: const EdgeInsets.only(bottom: DexSpace.xs),
          child: Text(line.substring(2),
              style: DexType.heading(color: DexColors.text)),
        ));
      } else if (line.startsWith('## ')) {
        blocks.add(Padding(
          padding: const EdgeInsets.only(top: DexSpace.sm, bottom: 2),
          child: Text(line.substring(3),
              style: DexType.label(color: DexColors.text)),
        ));
      } else if (line.startsWith('- ')) {
        blocks.add(_bullet(line.substring(2), ordered: false, marker: '•'));
      } else if (RegExp(r'^\d+\.\s').hasMatch(line)) {
        final dot = line.indexOf('. ');
        blocks.add(_bullet(line.substring(dot + 2),
            ordered: true, marker: line.substring(0, dot + 1)));
      } else {
        blocks.add(Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: _rich(line, DexType.body(color: DexColors.textDim)),
        ));
      }
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: blocks,
    );
  }

  Widget _bullet(String text, {required bool ordered, required String marker}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: ordered ? 22 : 16,
            child: Text(marker,
                style: DexType.body(color: DexColors.accent)),
          ),
          Expanded(
            child: _rich(text, DexType.body(color: DexColors.textDim)),
          ),
        ],
      ),
    );
  }

  /// Inline **bold** and `code` within a line.
  Widget _rich(String text, TextStyle base) {
    final spans = <TextSpan>[];
    final pattern = RegExp(r'\*\*(.+?)\*\*|`(.+?)`');
    var i = 0;
    for (final m in pattern.allMatches(text)) {
      if (m.start > i) spans.add(TextSpan(text: text.substring(i, m.start)));
      if (m.group(1) != null) {
        spans.add(TextSpan(
          text: m.group(1),
          style: const TextStyle(fontWeight: FontWeight.w600),
        ));
      } else if (m.group(2) != null) {
        spans.add(TextSpan(
          text: m.group(2),
          style: DexType.mono(color: DexColors.text).copyWith(fontSize: 12.5),
        ));
      }
      i = m.end;
    }
    if (i < text.length) spans.add(TextSpan(text: text.substring(i)));
    return RichText(text: TextSpan(style: base, children: spans));
  }
}
