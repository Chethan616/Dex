import 'package:flutter/material.dart';

import '../core/gateway_client.dart';
import '../core/models.dart';
import '../core/window_activity.dart';
import '../theme/tokens.dart';
import 'primitives/primitives.dart';

/// Saved workflows, past tasks, and what Dex actually gets used for.
///
/// Three tabs rather than three panels because they answer one question in
/// increasing order of abstraction: what can I replay, what have I asked, and
/// what does that add up to.
class LibraryPanel extends StatefulWidget {
  const LibraryPanel({super.key, required this.client, required this.onClose});

  final GatewayClient client;
  final VoidCallback onClose;

  @override
  State<LibraryPanel> createState() => _LibraryPanelState();
}

class _LibraryPanelState extends State<LibraryPanel>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 3, vsync: this);
  final _search = TextEditingController();

  @override
  void initState() {
    super.initState();
    widget.client.refreshWorkflows();
    widget.client.refreshHistory();
    widget.client.refreshStats();
    _tabs.addListener(() {
      if (_tabs.index == 1) widget.client.refreshHistory(query: _search.text);
      if (_tabs.index == 2) widget.client.refreshStats();
    });
  }

  @override
  void dispose() {
    _tabs.dispose();
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;

    return DexPanel(
      margin: const EdgeInsets.fromLTRB(
        DexTokens.spaceLg,
        DexTokens.spaceSm,
        DexTokens.spaceLg,
        DexTokens.spaceSm,
      ),
      clip: true,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Expanded(
                child: TabBar(
                  controller: _tabs,
                  tabs: const [
                    Tab(text: 'Workflows', height: 38),
                    Tab(text: 'History', height: 38),
                    Tab(text: 'Usage', height: 38),
                  ],
                ),
              ),
              const SizedBox(width: DexTokens.spaceSm),
              DexIconButton(
                icon: Icons.close,
                tooltip: 'Close  (Esc)',
                size: 15,
                onTap: widget.onClose,
              ),
              const SizedBox(width: DexTokens.spaceSm),
            ],
          ),
          Divider(height: 1, color: t.border),
          SizedBox(
            height: 268,
            child: TabBarView(
              controller: _tabs,
              children: [_workflows(t), _history(t), _usage(t)],
            ),
          ),
        ],
      ),
    );
  }

  // ── workflows ─────────────────────────────────────────────────────────────

  Widget _workflows(DexTokens t) {
    final items = widget.client.workflows;
    if (items.isEmpty) {
      return _empty(
        t,
        'No saved workflows yet.',
        'Run something, then save it — Dex replays the exact steps that worked, '
            'with no planning call.',
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(DexTokens.spaceMd),
      itemCount: items.length,
      separatorBuilder: (_, _) => const SizedBox(height: DexTokens.spaceSm),
      itemBuilder: (context, i) => _WorkflowTile(
        workflow: items[i],
        client: widget.client,
      ),
    );
  }

  // ── history ───────────────────────────────────────────────────────────────

  Widget _history(DexTokens t) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            DexTokens.spaceMd,
            DexTokens.spaceMd,
            DexTokens.spaceMd,
            0,
          ),
          child: DexField(
            controller: _search,
            hint: 'Search what you have asked…',
            prefix: Icons.search,
            onSubmitted: (q) =>
                setState(() => widget.client.refreshHistory(query: q)),
          ),
        ),
        Expanded(
          child: widget.client.pastTasks.isEmpty
              ? _empty(
                  t,
                  'Nothing recorded yet.',
                  'Every task you run is kept here, locally.',
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(DexTokens.spaceMd),
                  itemCount: widget.client.pastTasks.length,
                  itemBuilder: (context, i) =>
                      _historyRow(t, widget.client.pastTasks[i]),
                ),
        ),
      ],
    );
  }

  Widget _historyRow(DexTokens t, TaskRecord task) {
    final when = DateTime.fromMillisecondsSinceEpoch(task.startedAt);
    final tone = task.succeeded ? t.positive : t.negative;

    return Padding(
      padding: const EdgeInsets.only(bottom: DexTokens.spaceSm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Icon(
              task.succeeded ? Icons.check_rounded : Icons.close_rounded,
              size: 13,
              color: tone,
            ),
          ),
          const SizedBox(width: DexTokens.spaceSm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  task.text,
                  style: DexType.body(color: t.text),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Row(
                  children: [
                    Text(
                      '${when.day}/${when.month} '
                      '${when.hour.toString().padLeft(2, '0')}:'
                      '${when.minute.toString().padLeft(2, '0')}',
                      style: DexType.codeSm(color: t.textFaint),
                    ),
                    if (task.workflow != null) ...[
                      const SizedBox(width: DexTokens.spaceSm),
                      // Worth marking: these cost no planning call.
                      DexTag(task.workflow!, tone: t.neutral, uppercase: false),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── usage ─────────────────────────────────────────────────────────────────

  Widget _usage(DexTokens t) {
    final stats = widget.client.stats;
    if (stats == null || stats.totalTasks == 0) {
      return _empty(t, 'No usage yet.', 'Come back once you have run a few tasks.');
    }

    final peak = stats.byDay.isEmpty
        ? 1
        : stats.byDay.map((d) => d.tasks).reduce((a, b) => a > b ? a : b);

    return ListView(
      padding: const EdgeInsets.all(DexTokens.spaceMd),
      children: [
        Row(
          children: [
            _stat(t, '${stats.totalTasks}', 'tasks'),
            _stat(t, '${stats.completed}', 'completed', t.positive),
            if (stats.failed > 0) _stat(t, '${stats.failed}', 'failed', t.negative),
            if (stats.workflowRuns > 0)
              _stat(t, '${stats.workflowRuns}', 'replayed', t.info),
          ],
        ),
        if (stats.workflowRuns > 0) ...[
          const SizedBox(height: DexTokens.spaceXs),
          Text(
            '${stats.workflowRuns} planning call'
            '${stats.workflowRuns == 1 ? '' : 's'} avoided by saved workflows',
            style: DexType.caption(color: t.textMuted),
          ),
        ],
        const SizedBox(height: DexTokens.spaceLg),
        if (stats.byDay.isNotEmpty) ...[
          _sectionLabel(t, 'Per day'),
          for (final day in stats.byDay)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                children: [
                  SizedBox(
                    width: 46,
                    child: Text(
                      day.day.substring(5),
                      style: DexType.codeSm(color: t.textFaint),
                    ),
                  ),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(3),
                      child: LinearProgressIndicator(
                        value: day.tasks / peak,
                        minHeight: 6,
                        backgroundColor: t.surface,
                        valueColor: AlwaysStoppedAnimation(t.info),
                      ),
                    ),
                  ),
                  const SizedBox(width: DexTokens.spaceSm),
                  SizedBox(
                    width: 22,
                    child: Text(
                      '${day.tasks}',
                      textAlign: TextAlign.right,
                      style: DexType.codeSm(color: t.textMuted),
                    ),
                  ),
                ],
              ),
            ),
        ],
        if (stats.topActions.isNotEmpty) ...[
          const SizedBox(height: DexTokens.spaceLg),
          _sectionLabel(t, 'Most used'),
          for (final action in stats.topActions.take(6))
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                children: [
                  SizedBox(
                    width: 34,
                    child: Text(
                      '${action.runs}×',
                      style: DexType.codeSm(color: t.textMuted),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      action.action,
                      overflow: TextOverflow.ellipsis,
                      style: DexType.code(color: t.text),
                    ),
                  ),
                  if (action.failures > 0)
                    DexTag('${action.failures} failed', tone: t.negative),
                ],
              ),
            ),
        ],
      ],
    );
  }

  // ── shared bits ───────────────────────────────────────────────────────────

  Widget _sectionLabel(DexTokens t, String text) => Padding(
        padding: const EdgeInsets.only(bottom: DexTokens.spaceSm),
        child: Text(text, style: DexType.caption(color: t.textMuted, strong: true)),
      );

  Widget _stat(DexTokens t, String value, String label, [Color? color]) => Padding(
        padding: const EdgeInsets.only(right: DexTokens.spaceXl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(value, style: DexType.display(color: color ?? t.text)),
            Text(label, style: DexType.caption(color: t.textMuted)),
          ],
        ),
      );

  Widget _empty(DexTokens t, String title, String detail) => Center(
        child: Padding(
          padding: const EdgeInsets.all(DexTokens.spaceLg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(title, style: DexType.body(color: t.textMuted, strong: true)),
              const SizedBox(height: DexTokens.spaceXs),
              Text(
                detail,
                textAlign: TextAlign.center,
                style: DexType.caption(color: t.textFaint),
              ),
            ],
          ),
        ),
      );
}

/// One saved workflow: what it does, and a way to run it.
class _WorkflowTile extends StatefulWidget {
  const _WorkflowTile({required this.workflow, required this.client});

  final SavedWorkflow workflow;
  final GatewayClient client;

  @override
  State<_WorkflowTile> createState() => _WorkflowTileState();
}

class _WorkflowTileState extends State<_WorkflowTile> {
  late final List<TextEditingController> _args = List.generate(
    widget.workflow.params.length,
    (_) => TextEditingController(),
  );

  @override
  void dispose() {
    for (final c in _args) {
      c.dispose();
    }
    super.dispose();
  }

  /// Running a workflow changes real state, so the same movement guard the
  /// confirmation card uses applies here: a window raised under the pointer
  /// must not be able to launch one.
  bool get _armed => WindowActivity.safeToAccept;

  void _run() {
    widget.client
        .runWorkflow(widget.workflow, _args.map((c) => c.text.trim()).toList());
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final w = widget.workflow;
    final ready = _armed && _args.every((c) => c.text.trim().isNotEmpty);

    return DexPanel(
      raised: false,
      radius: DexTokens.radiusSm,
      padding: const EdgeInsets.all(DexTokens.spaceMd),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(w.name, style: DexType.code(color: t.text, strong: true)),
              const SizedBox(width: DexTokens.spaceSm),
              Text(
                '${w.steps} step${w.steps == 1 ? '' : 's'}'
                '${w.runCount > 0 ? ' · run ${w.runCount}×' : ''}',
                style: DexType.codeSm(color: t.textFaint),
              ),
              const Spacer(),
              DexIconButton(
                icon: Icons.delete_outline,
                tooltip: 'Forget "${w.name}"',
                size: 15,
                onTap: () => widget.client.deleteWorkflow(w.name),
              ),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            w.description.isEmpty ? w.triggerText : w.description,
            style: DexType.caption(color: t.textMuted),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: DexTokens.spaceSm),
          Row(
            children: [
              for (var i = 0; i < w.params.length; i++) ...[
                DexField(
                  controller: _args[i],
                  hint: w.params[i],
                  mono: true,
                  width: 100,
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(width: DexTokens.spaceXs),
              ],
              const Spacer(),
              DexButton(
                label: 'Run',
                variant: DexButtonVariant.primary,
                tone: t.positive,
                dense: true,
                // Disabled means out of the gesture arena entirely — the same
                // rule the confirmation card relies on.
                enabled: ready,
                onTap: _run,
              ),
            ],
          ),
        ],
      ),
    );
  }
}
