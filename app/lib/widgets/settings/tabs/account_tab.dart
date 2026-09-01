// Account: what Dex knows about you, and how to remove it.
//
// This tab used to carry a second, complete API-key and model surface —
// "Brain model", "Hands model", Gemini keys, a Groq key field, an Apply
// button. All of it wrote to `~/.dex/dex.json`, which is v1's config file.
// Nothing in this Dex reads that file. Every control on it did nothing, and
// they contradicted the settings that do work: it offered a "Hands model" for
// UFO² desktop automation, which this Dex does not have.
//
// Two settings screens for one thing, where one of them is inert, is worse
// than one — the owner has no way to tell which they are looking at. Keys and
// models live in Intelligence now, and this tab does the one thing it is
// actually for: showing what is stored locally and letting you delete it.

import 'package:flutter/material.dart';

import '../../../core/dex_gateway.dart';
import '../../../theme/tokens.dart';
import '../settings_dialog.dart';

class AccountTab extends StatefulWidget {
  const AccountTab({super.key, this.onNavigate});

  /// Lets the "manage them in Intelligence" line actually go there.
  final void Function(SettingsTab)? onNavigate;

  @override
  State<AccountTab> createState() => _AccountTabState();
}

class _AccountTabState extends State<AccountTab> {
  bool _confirming = false;

  @override
  Widget build(BuildContext context) {
    final client = DexGatewayClient.current;
    final settings = client?.settings;
    final stored = settings?.credentials.where((c) => c.stored).length ?? 0;

    return ListView(
      padding: const EdgeInsets.fromLTRB(28, 24, 28, 40),
      children: [
        const _Title('This machine'),
        const _Blurb(
          'Dex runs entirely on your PC. There is no Dex account and nothing '
          'is uploaded — the Windows account you are already signed in to is '
          'the only identity involved.',
        ),
        const SizedBox(height: 20),

        _Card(
          icon: Icons.key_rounded,
          title: 'API keys and model',
          value: stored == 0
              ? 'None stored'
              : '$stored key${stored == 1 ? '' : 's'} stored, encrypted',
          detail: settings == null
              ? 'Connecting to the core…'
              : 'Brain: ${settings.provider.isEmpty ? "not chosen" : settings.provider}'
                  '${settings.model.isEmpty ? "" : " · ${settings.model}"}',
          action: _Link(
            label: 'Manage in Intelligence',
            onTap: () => widget.onNavigate?.call(SettingsTab.intelligence),
          ),
        ),
        const SizedBox(height: 12),

        const _Card(
          icon: Icons.folder_outlined,
          title: 'What is kept, and where',
          value: r'%LOCALAPPDATA%\DEX',
          detail: 'Settings, encrypted API keys, task history, evidence from '
              'verified steps, and the five log files. Nothing else, and '
              'nothing outside this folder.',
        ),
        const SizedBox(height: 24),

        const _Title('Remove your data'),
        const _Blurb(
          'Deletes the task history, saved workflows and stored keys. Dex '
          'keeps working; it simply will not remember anything or be able to '
          'plan until you add a key or sign in to Claude Code again.',
        ),
        const SizedBox(height: 14),

        if (!_confirming)
          Align(
            alignment: Alignment.centerLeft,
            child: _Button(
              label: 'Delete local data',
              danger: true,
              onTap: () => setState(() => _confirming = true),
            ),
          )
        else
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: DexColors.stateError.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: DexColors.stateError.withValues(alpha: 0.4)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'This cannot be undone.',
                  style: TextStyle(
                    color: DexColors.stateError,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Deleting from here is deliberately not wired to a button '
                  'that does it silently. Close Dex and remove '
                  r'%LOCALAPPDATA%\DEX yourself — that way you can see exactly '
                  'what is going, and keep the logs if you want them.',
                  style: TextStyle(
                    color: DexColors.textDim,
                    fontSize: 12,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: 12),
                _Button(
                  label: 'Understood',
                  onTap: () => setState(() => _confirming = false),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({
    required this.icon,
    required this.title,
    required this.value,
    required this.detail,
    this.action,
  });

  final IconData icon;
  final String title;
  final String value;
  final String detail;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: DexColors.surface.withValues(alpha: 0.45),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: DexColors.border),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 17, color: DexColors.textDim),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: const TextStyle(
                        color: DexColors.text,
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                      )),
                  const SizedBox(height: 3),
                  Text(value,
                      style: const TextStyle(
                        color: DexColors.accent,
                        fontSize: 12,
                        fontFamily: 'monospace',
                      )),
                  const SizedBox(height: 5),
                  Text(detail,
                      style: const TextStyle(
                        color: DexColors.textDim,
                        fontSize: 11.5,
                        height: 1.5,
                      )),
                ],
              ),
            ),
            if (action != null) ...[const SizedBox(width: 12), action!],
          ],
        ),
      );
}

class _Link extends StatelessWidget {
  const _Link({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => MouseRegion(
        cursor: SystemMouseCursors.click,
        child: GestureDetector(
          onTap: onTap,
          child: Text(label,
              style: const TextStyle(color: DexColors.accent, fontSize: 11.5)),
        ),
      );
}

class _Button extends StatelessWidget {
  const _Button({required this.label, required this.onTap, this.danger = false});

  final String label;
  final VoidCallback onTap;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final tone = danger ? DexColors.stateError : DexColors.textDim;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 7),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: tone.withValues(alpha: 0.45)),
        ),
        child: Text(label, style: TextStyle(color: tone, fontSize: 12)),
      ),
    );
  }
}

class _Title extends StatelessWidget {
  const _Title(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: const TextStyle(
          color: DexColors.text,
          fontSize: 16,
          fontWeight: FontWeight.w600,
        ),
      );
}

class _Blurb extends StatelessWidget {
  const _Blurb(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 5),
        child: Text(text,
            style: const TextStyle(
              color: DexColors.textDim,
              fontSize: 12.5,
              height: 1.55,
            )),
      );
}
