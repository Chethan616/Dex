// Connectors tab. Lists third-party services Dex can hook up to. Real wiring
// lives behind a follow-up PR; v1 just renders the list + Connect buttons.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../../theme/tokens.dart';
import '../settings_row.dart';
import 'connector_detail.dart';

class ConnectorEntry {
  const ConnectorEntry({
    required this.id,
    required this.name,
    required this.icon,
    required this.description,
    required this.developer,
    required this.category,
  });
  final String id;
  final String name;
  final IconData icon;
  final String description;
  final String developer;
  final String category;
}

const _entries = <ConnectorEntry>[
  ConnectorEntry(
    id: 'cloud-drive',
    name: 'Cloud drive',
    icon: LucideIcons.cloud,
    description: 'Search, analyse, read, create, edit, and download files in your cloud drive.',
    developer: 'Generic',
    category: 'Productivity',
  ),
  ConnectorEntry(
    id: 'mail',
    name: 'Mail',
    icon: LucideIcons.mail,
    description: 'Search, analyse, read, create, edit, and send messages in your inbox.',
    developer: 'Generic',
    category: 'Productivity',
  ),
  ConnectorEntry(
    id: 'calendar',
    name: 'Calendar',
    icon: LucideIcons.calendar,
    description: 'Search, analyse, read, create, and edit events on your calendar.',
    developer: 'Generic',
    category: 'Productivity',
  ),
  ConnectorEntry(
    id: 'contacts',
    name: 'Contacts',
    icon: LucideIcons.user,
    description: 'Search and analyse your contacts.',
    developer: 'Generic',
    category: 'Productivity',
  ),
  ConnectorEntry(
    id: 'docs',
    name: 'Documents',
    icon: LucideIcons.file_text,
    description: 'Read, analyse, and edit your saved documents.',
    developer: 'Generic',
    category: 'Productivity',
  ),
  ConnectorEntry(
    id: 'tasks',
    name: 'Tasks',
    icon: LucideIcons.list_checks,
    description: 'Create, complete, and triage tasks from inside Dex.',
    developer: 'Generic',
    category: 'Productivity',
  ),
];

class ConnectorsTab extends StatefulWidget {
  const ConnectorsTab({super.key});
  @override
  State<ConnectorsTab> createState() => _ConnectorsTabState();
}

class _ConnectorsTabState extends State<ConnectorsTab> {
  ConnectorEntry? _detail;

  @override
  Widget build(BuildContext context) {
    if (_detail != null) {
      return ConnectorDetail(
        entry: _detail!,
        onBack: () => setState(() => _detail = null),
      );
    }
    return SingleChildScrollView(
      padding: const EdgeInsets.all(DexSpace.lg),
      child: SettingsSection(
        title: 'Connectors',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: _entries
              .map((e) => _Row(
                    entry: e,
                    onConnect: () {},
                    onOpen: () => setState(() => _detail = e),
                  ))
              .toList(growable: false),
        ),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({
    required this.entry,
    required this.onConnect,
    required this.onOpen,
  });
  final ConnectorEntry entry;
  final VoidCallback onConnect;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onOpen,
      borderRadius: DexRadius.rsm,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: DexSpace.xs, vertical: DexSpace.sm,
        ),
        child: Row(
          children: [
            Container(
              width: 32,
              height: 32,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: DexColors.surface,
                borderRadius: DexRadius.rsm,
                border: Border.all(color: DexColors.border),
              ),
              child: Icon(entry.icon, size: 16, color: DexColors.textDim),
            ),
            const SizedBox(width: DexSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(entry.name,
                      style: DexType.label(color: DexColors.text)),
                  Text(entry.description,
                      style: DexType.caption(color: DexColors.textFaint),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
            OutlinedButton(
              onPressed: onConnect,
              style: OutlinedButton.styleFrom(
                foregroundColor: DexColors.text,
                side: const BorderSide(color: DexColors.border),
                padding: const EdgeInsets.symmetric(
                  horizontal: DexSpace.md, vertical: DexSpace.xs,
                ),
              ),
              child: const Text('Connect'),
            ),
            const Icon(LucideIcons.chevron_right,
                size: 16, color: DexColors.textFaint),
          ],
        ),
      ),
    );
  }
}
