// Diagnostics tab — the in-app log window.
//
// Renders DexLog.entries live (gateway connect/RPC, gateway spawn,
// tool errors/aborts, uncaught Flutter/zone errors). Color-coded by
// level, newest at the bottom, with Copy (whole buffer to clipboard)
// and Clear. This is where "we can notice errors" happens without
// hunting a console.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../../core/log.dart';
import '../../../theme/tokens.dart';
import '../settings_row.dart';

class DiagnosticsTab extends StatefulWidget {
  const DiagnosticsTab({super.key});

  @override
  State<DiagnosticsTab> createState() => _DiagnosticsTabState();
}

class _DiagnosticsTabState extends State<DiagnosticsTab> {
  final ScrollController _scroll = ScrollController();

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  Color _levelColor(DexLogLevel level) => switch (level) {
        DexLogLevel.info => DexColors.textDim,
        DexLogLevel.warn => DexColors.stateAwaiting,
        DexLogLevel.error => DexColors.stateError,
      };

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(DexSpace.lg),
      child: SettingsSection(
        title: 'Diagnostics',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Live log of the gateway, tools, and the app. Newest at '
                    'the bottom. Copy this if you hit an error.',
                    style: DexType.caption(color: DexColors.textFaint),
                  ),
                ),
                const SizedBox(width: DexSpace.sm),
                _ActionButton(
                  icon: LucideIcons.copy,
                  label: 'Copy',
                  onTap: () async {
                    await Clipboard.setData(ClipboardData(text: DexLog.dump()));
                    if (context.mounted) {
                      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
                        const SnackBar(content: Text('Logs copied')),
                      );
                    }
                  },
                ),
                const SizedBox(width: DexSpace.xs),
                _ActionButton(
                  icon: LucideIcons.trash_2,
                  label: 'Clear',
                  onTap: DexLog.clear,
                ),
              ],
            ),
            const SizedBox(height: DexSpace.md),
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  color: DexColors.bg,
                  borderRadius: DexRadius.rmd,
                  border: Border.all(color: DexColors.border),
                ),
                padding: const EdgeInsets.all(DexSpace.sm),
                child: ValueListenableBuilder<List<DexLogEntry>>(
                  valueListenable: DexLog.entries,
                  builder: (context, entries, _) {
                    if (entries.isEmpty) {
                      return Center(
                        child: Text(
                          'No log entries yet.',
                          style: DexType.caption(color: DexColors.textFaint),
                        ),
                      );
                    }
                    // Keep pinned to newest once it's built.
                    WidgetsBinding.instance.addPostFrameCallback((_) {
                      if (_scroll.hasClients) {
                        _scroll.jumpTo(_scroll.position.maxScrollExtent);
                      }
                    });
                    return ListView.builder(
                      controller: _scroll,
                      itemCount: entries.length,
                      itemBuilder: (context, i) {
                        final e = entries[i];
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 1),
                          child: RichText(
                            text: TextSpan(
                              style: DexType.mono(color: DexColors.textDim)
                                  .copyWith(fontSize: 11.5, height: 1.35),
                              children: [
                                TextSpan(
                                  text: '${e.timeLabel} ',
                                  style: TextStyle(color: DexColors.textFaint),
                                ),
                                TextSpan(
                                  text: '${e.levelLabel} ',
                                  style: TextStyle(
                                    color: _levelColor(e.level),
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                TextSpan(
                                  text: '[${e.tag}] ',
                                  style: TextStyle(color: DexColors.accent),
                                ),
                                TextSpan(text: e.message),
                              ],
                            ),
                          ),
                        );
                      },
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: Icon(icon, size: 14),
      label: Text(label),
      style: OutlinedButton.styleFrom(
        foregroundColor: DexColors.textDim,
        side: const BorderSide(color: DexColors.border),
        padding: const EdgeInsets.symmetric(
            horizontal: DexSpace.md, vertical: DexSpace.xs),
      ),
    );
  }
}
