// Connectors & Apps tab.
//
// The full surface Dex ships with — automation engines (UFO²,
// browser-use, OmniParser), built-in tools, messaging channels, AI
// providers, and web/speech plugins — searchable, grouped by category,
// with live status probed from the gateway's config.get snapshot
// (see core/connectors.dart for the catalog + wiring).

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../../core/connectors.dart';
import '../../../theme/tokens.dart';
import 'connector_detail.dart';

class ConnectorsTab extends StatefulWidget {
  const ConnectorsTab({super.key});
  @override
  State<ConnectorsTab> createState() => _ConnectorsTabState();
}

class _ConnectorsTabState extends State<ConnectorsTab> {
  final ConnectorsStore _store = ConnectorsStore();
  final TextEditingController _search = TextEditingController();
  ConnectorEntry? _detail;

  @override
  void initState() {
    super.initState();
    _store.addListener(_onStore);
    _search.addListener(_onStore);
    _store.refresh();
  }

  void _onStore() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _store.removeListener(_onStore);
    _search.removeListener(_onStore);
    _search.dispose();
    _store.dispose();
    super.dispose();
  }

  List<ConnectorEntry> get _filtered {
    final q = _search.text.trim().toLowerCase();
    if (q.isEmpty) return kConnectorCatalog;
    return kConnectorCatalog
        .where((e) =>
            e.name.toLowerCase().contains(q) ||
            e.description.toLowerCase().contains(q) ||
            e.developer.toLowerCase().contains(q) ||
            e.category.label.toLowerCase().contains(q))
        .toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    if (detail != null) {
      return ConnectorDetail(
        entry: detail,
        status: detail.statusIn(_store.config),
        onBack: () => setState(() => _detail = null),
      );
    }

    final entries = _filtered;
    final children = <Widget>[
      Row(
        children: [
          Expanded(
            child: Text('Connectors & Apps',
                style: DexType.heading(color: DexColors.text)),
          ),
          if (_store.loading)
            const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 1.6,
                color: DexColors.textFaint,
              ),
            )
          else
            Text(
              '${_store.connectedCount} connected',
              style: DexType.caption(color: DexColors.textFaint),
            ),
        ],
      ),
      const SizedBox(height: DexSpace.md),
      _SearchField(controller: _search),
      const SizedBox(height: DexSpace.md),
    ];

    if (entries.isEmpty) {
      children.add(Padding(
        padding: const EdgeInsets.symmetric(vertical: DexSpace.xl),
        child: Center(
          child: Text(
            'No connectors match "${_search.text.trim()}"',
            style: DexType.body(color: DexColors.textFaint),
          ),
        ),
      ));
    } else {
      for (final category in ConnectorCategory.values) {
        final inCategory = entries
            .where((e) => e.category == category)
            .toList(growable: false);
        if (inCategory.isEmpty) continue;
        children
          ..add(Padding(
            padding: const EdgeInsets.only(
              top: DexSpace.md, bottom: DexSpace.xs,
            ),
            child: Text(
              category.label.toUpperCase(),
              style: DexType.caption(color: DexColors.textFaint)
                  .copyWith(letterSpacing: 1.1),
            ),
          ))
          ..addAll(inCategory.map((e) => _Row(
                entry: e,
                status: e.statusIn(_store.config),
                onOpen: () => setState(() => _detail = e),
              )));
      }
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(DexSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: children,
      ),
    );
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({required this.controller});
  final TextEditingController controller;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 36,
      decoration: BoxDecoration(
        color: DexColors.surface,
        borderRadius: DexRadius.rsm,
        border: Border.all(color: DexColors.border),
      ),
      child: Row(
        children: [
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: DexSpace.sm),
            child: Icon(LucideIcons.search,
                size: 14, color: DexColors.textFaint),
          ),
          Expanded(
            child: TextField(
              controller: controller,
              style: DexType.body(color: DexColors.text),
              cursorColor: DexColors.text,
              decoration: InputDecoration(
                isDense: true,
                border: InputBorder.none,
                hintText: 'Search connectors — WhatsApp, browser, Gemini…',
                hintStyle: DexType.body(color: DexColors.textFaint),
              ),
            ),
          ),
          if (controller.text.isNotEmpty)
            IconButton(
              icon: const Icon(LucideIcons.x, size: 14),
              color: DexColors.textFaint,
              onPressed: controller.clear,
            ),
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({
    required this.entry,
    required this.status,
    required this.onOpen,
  });
  final ConnectorEntry entry;
  final ConnectorStatus status;
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
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
            const SizedBox(width: DexSpace.sm),
            ConnectorStatusChip(status: status),
            const SizedBox(width: DexSpace.xs),
            const Icon(LucideIcons.chevron_right,
                size: 16, color: DexColors.textFaint),
          ],
        ),
      ),
    );
  }
}

/// Small status pill: green dot + Connected, dim Built-in, or an
/// outlined Connect affordance. Shared with the detail view.
class ConnectorStatusChip extends StatelessWidget {
  const ConnectorStatusChip({super.key, required this.status});
  final ConnectorStatus status;

  @override
  Widget build(BuildContext context) {
    final (label, color, filled) = switch (status) {
      ConnectorStatus.connected => ('Connected', DexColors.stateApprove, true),
      ConnectorStatus.builtin => ('Built-in', DexColors.textFaint, true),
      ConnectorStatus.available => ('Connect', DexColors.textDim, false),
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DexSpace.sm, vertical: 3,
      ),
      decoration: BoxDecoration(
        color: filled
            ? color.withValues(alpha: 0.10)
            : Colors.transparent,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: filled ? Colors.transparent : DexColors.border,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (status == ConnectorStatus.connected) ...[
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                color: color,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 5),
          ],
          Text(label, style: DexType.caption(color: color)),
        ],
      ),
    );
  }
}
