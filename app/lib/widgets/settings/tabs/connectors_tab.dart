// Connectors & Apps tab.
//
// The full surface Dex ships with — automation engines (UFO²,
// browser-use, OmniParser), built-in tools, messaging channels, AI
// providers, and web/speech plugins — searchable, grouped by category,
// with live status probed from the gateway's config.get snapshot
// (see core/connectors.dart for the catalog + wiring).

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';

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
      _SearchField(
        controller: _search,
        onSubmitted: (q) => q.trim().isEmpty
            ? _store.clearSearch()
            : _store.searchRemote(q),
        searching: _store.searching,
      ),
      const SizedBox(height: DexSpace.md),
      if (_store.installNote != null)
        Padding(
          padding: const EdgeInsets.only(bottom: DexSpace.sm),
          child: Text(_store.installNote!,
              style: DexType.caption(color: DexColors.textDim)),
        ),
    ];

    // ClawHub search hits: skills the user can one-click install from the
    // remote registry (gateway skills.search / skills.install RPCs).
    if (_store.searchResults.isNotEmpty) {
      children
        ..add(Padding(
          padding: const EdgeInsets.only(
            top: DexSpace.xs, bottom: DexSpace.xs,
          ),
          child: Text(
            'FROM THE SKILL REGISTRY',
            style: DexType.caption(color: DexColors.textFaint)
                .copyWith(letterSpacing: 1.1),
          ),
        ))
        ..addAll(_store.searchResults.map((r) => _RemoteSkillRow(
              skill: r,
              installing: _store.isInstalling(r.slug),
              alreadyInstalled:
                  _store.skills.any((s) => s.name == r.slug),
              onInstall: () => _store.installSkill(r.slug),
            )));
    }

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

    // Installed skills (bundled + workspace) from skills.status -- the
    // real app-integration surface: github, discord, notion, email, ...
    // Rendered LAST: it's the longest list, so the curated connector
    // catalog stays above the fold.
    final skillQuery = _search.text.trim().toLowerCase();
    final visibleSkills = _store.skills
        .where((s) =>
            skillQuery.isEmpty ||
            s.name.toLowerCase().contains(skillQuery) ||
            s.description.toLowerCase().contains(skillQuery))
        .toList(growable: false);
    if (visibleSkills.isNotEmpty) {
      children
        ..add(Padding(
          padding: const EdgeInsets.only(
            top: DexSpace.md, bottom: DexSpace.xs,
          ),
          child: Text(
            'INSTALLED SKILLS',
            style: DexType.caption(color: DexColors.textFaint)
                .copyWith(letterSpacing: 1.1),
          ),
        ))
        ..addAll(visibleSkills.map((s) => _SkillRow(skill: s)));
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

/// The real package GlassSearchBar (apple_messages "Search messages"
/// style) — own glass layer, built-in animated clear X-circle, accent
/// search glyph. The live list filter runs off the controller listener
/// in the parent, so typing filters immediately; Enter triggers the
/// ClawHub remote search. A subtle spinner overlays the right edge while
/// the remote search is in flight.
class _SearchField extends StatelessWidget {
  const _SearchField({
    required this.controller,
    required this.onSubmitted,
    this.searching = false,
  });
  final TextEditingController controller;
  final ValueChanged<String> onSubmitted;
  final bool searching;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.text,
      child: Stack(
        alignment: Alignment.centerRight,
        children: [
          GlassSearchBar(
            controller: controller,
            placeholder: 'Search connectors, apps & skills…',
            onSubmitted: onSubmitted,
            useOwnLayer: true,
            height: 48,
            // On focus the bar shrinks and a circle-X dismiss pill slides in
            // from the right (the iMessage "Search messages" pattern). Tapping
            // it clears the field + the remote search and dismisses focus.
            showsCancelButton: true,
            cancelIcon: const Icon(LucideIcons.circle_x,
                size: 20, color: DexColors.textFaint),
            onCancel: () {
              controller.clear();
              onSubmitted('');
            },
            searchIconColor: DexColors.textFaint,
            clearIconColor: DexColors.textFaint,
            textStyle: DexType.body(color: DexColors.text),
            placeholderStyle: DexType.body(color: DexColors.textFaint),
          ),
          if (searching)
            const Padding(
              padding: EdgeInsets.only(right: DexSpace.lg),
              child: SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(
                  strokeWidth: 1.6,
                  color: DexColors.textFaint,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// One installed skill from skills.status. Status chip mirrors the
/// connector vocabulary: eligible -> Ready (green), missing setup ->
/// outline, disabled -> dim.
class _SkillRow extends StatelessWidget {
  const _SkillRow({required this.skill});
  final SkillInfo skill;

  @override
  Widget build(BuildContext context) {
    final (label, color) = skill.disabled
        ? ('Disabled', DexColors.textFaint)
        : skill.eligible
            ? ('Ready', DexColors.stateApprove)
            : ('Setup needed', DexColors.stateAwaiting);
    return Padding(
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
            child: skill.emoji != null && skill.emoji!.isNotEmpty
                ? Text(skill.emoji!, style: const TextStyle(fontSize: 14))
                : const Icon(LucideIcons.puzzle,
                    size: 16, color: DexColors.textDim),
          ),
          const SizedBox(width: DexSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(skill.name, style: DexType.label(color: DexColors.text)),
                Text(
                  skill.description,
                  style: DexType.caption(color: DexColors.textFaint),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: DexSpace.sm),
          Text(label, style: DexType.caption(color: color)),
        ],
      ),
    );
  }
}

/// One ClawHub search hit with a one-click Install button.
class _RemoteSkillRow extends StatelessWidget {
  const _RemoteSkillRow({
    required this.skill,
    required this.installing,
    required this.alreadyInstalled,
    required this.onInstall,
  });
  final RemoteSkill skill;
  final bool installing;
  final bool alreadyInstalled;
  final VoidCallback onInstall;

  @override
  Widget build(BuildContext context) {
    return Padding(
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
            child: const Icon(LucideIcons.cloud_download,
                size: 16, color: DexColors.textDim),
          ),
          const SizedBox(width: DexSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(skill.name, style: DexType.label(color: DexColors.text)),
                Text(
                  skill.description,
                  style: DexType.caption(color: DexColors.textFaint),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: DexSpace.sm),
          if (alreadyInstalled)
            Text('Installed',
                style: DexType.caption(color: DexColors.stateApprove))
          else if (installing)
            const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 1.6,
                color: DexColors.textFaint,
              ),
            )
          else
            OutlinedButton(
              onPressed: onInstall,
              style: OutlinedButton.styleFrom(
                foregroundColor: DexColors.text,
                side: const BorderSide(color: DexColors.border),
                padding: const EdgeInsets.symmetric(
                  horizontal: DexSpace.md, vertical: DexSpace.xs,
                ),
              ),
              child: const Text('Install'),
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
