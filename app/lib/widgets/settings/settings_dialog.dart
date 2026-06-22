// The Settings modal. Left rail of tab labels, right pane of contents.
// Sub-screens (e.g. View memory) replace the right pane in place.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../theme/motion.dart';
import '../../theme/tokens.dart';
import '../dex_glass.dart';
import '../menu_glass.dart';
import 'tabs/about_tab.dart';
import 'tabs/account_tab.dart';
import 'tabs/connectors_tab.dart';
import 'tabs/diagnostics_tab.dart';
import 'tabs/memory_tab.dart';
import 'tabs/preferences_tab.dart';
import 'tabs/privacy_tab.dart';

enum SettingsTab {
  preferences,
  memory,
  account,
  connectors,
  diagnostics,
  privacy,
  about,
}

extension on SettingsTab {
  String get label => switch (this) {
        SettingsTab.preferences => 'Preferences',
        SettingsTab.memory => 'Memory',
        SettingsTab.account => 'Account',
        SettingsTab.connectors => 'Connectors & Apps',
        SettingsTab.diagnostics => 'Diagnostics',
        SettingsTab.privacy => 'Privacy',
        SettingsTab.about => 'About',
      };
}

class SettingsDialog extends StatefulWidget {
  const SettingsDialog({super.key, this.initialTab = SettingsTab.preferences});
  final SettingsTab initialTab;

  static Future<void> show(BuildContext context,
      {SettingsTab initial = SettingsTab.preferences}) {
    return showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Dismiss settings',
      barrierColor: Colors.black.withValues(alpha: 0.4),
      transitionDuration: DexMotion.dialog,
      pageBuilder: (_, _, _) => SettingsDialog(initialTab: initial),
      transitionBuilder: (ctx, anim, _, child) {
        final reduce = MediaQuery.of(ctx).disableAnimations;
        if (reduce) return child;
        // Same dampened landing as the permission dialog: smooth fade
        // + soft slide-up + gentle scale. No spring overshoot --
        // a big modal jittering on entry would feel cheap.
        final eased = CurvedAnimation(parent: anim, curve: DexMotion.dampened);
        return FadeTransition(
          opacity: eased,
          child: AnimatedBuilder(
            animation: eased,
            builder: (_, c) => Transform.translate(
              offset: Offset(0, (1 - eased.value) * 20),
              child: Transform.scale(
                scale: 0.97 + 0.03 * eased.value,
                child: c,
              ),
            ),
            child: child,
          ),
        );
      },
    );
  }

  @override
  State<SettingsDialog> createState() => _SettingsDialogState();
}

class _SettingsDialogState extends State<SettingsDialog> {
  late SettingsTab _tab;

  @override
  void initState() {
    super.initState();
    _tab = widget.initialTab;
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.transparency,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: 760, minHeight: 540, maxHeight: 640,
          ),
          child: DexGlass(
            radius: 20,
            // No liquid edge rim on the settings panel — it sits over the
            // dimmed home + drifting fog, and the moving specular read as a
            // "vibrating" edge light. Plain frost is stable.
            rim: false,
            child: Column(
              children: [
                _Header(onClose: () => Navigator.of(context).maybePop()),
                const Divider(height: 1, color: DexColors.border),
                Expanded(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _TabList(
                        current: _tab,
                        onSelect: (t) => setState(() => _tab = t),
                      ),
                      const VerticalDivider(
                          width: 1, color: DexColors.border),
                      Expanded(child: _content(_tab)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _navigate(SettingsTab t) => setState(() => _tab = t);

  Widget _content(SettingsTab t) {
    switch (t) {
      case SettingsTab.preferences:
        return const PreferencesTab();
      case SettingsTab.memory:
        return const MemoryTab();
      case SettingsTab.account:
        return const AccountTab();
      case SettingsTab.connectors:
        return const ConnectorsTab();
      case SettingsTab.diagnostics:
        return const DiagnosticsTab();
      case SettingsTab.privacy:
        return PrivacyTab(onNavigate: _navigate);
      case SettingsTab.about:
        return const AboutTab();
    }
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.onClose});
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: DexSpace.lg, vertical: DexSpace.md,
      ),
      child: Row(
        children: [
          Expanded(
            child: Text('Settings',
                style: DexType.heading(color: DexColors.text)),
          ),
          IconButton(
            icon: const Icon(LucideIcons.x, size: 18),
            color: DexColors.textDim,
            onPressed: onClose,
          ),
        ],
      ),
    );
  }
}

class _TabList extends StatelessWidget {
  const _TabList({required this.current, required this.onSelect});
  final SettingsTab current;
  final ValueChanged<SettingsTab> onSelect;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 200,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: DexSpace.sm, vertical: DexSpace.md,
        ),
        child: Column(
          children: [
            ...SettingsTab.values.map((t) {
              final active = t == current;
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 1),
                child: InkWell(
                  onTap: () => onSelect(t),
                  borderRadius: DexRadius.rsm,
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                      horizontal: DexSpace.md, vertical: DexSpace.sm,
                    ),
                    decoration: BoxDecoration(
                      color:
                          active ? kDexMenuAccentSurface : Colors.transparent,
                      borderRadius: DexRadius.rsm,
                      border: Border.all(
                        color: active
                            ? kDexMenuAccentBorder
                            : Colors.transparent,
                      ),
                    ),
                    child: Text(
                      t.label,
                      style: DexType.label(
                        color: active ? DexColors.accent : DexColors.textDim,
                      ),
                    ),
                  ),
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
}
