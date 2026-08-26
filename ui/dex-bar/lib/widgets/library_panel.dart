import 'package:flutter/material.dart';

import '../core/gateway_client.dart';
import '../core/models.dart';
import '../core/window_activity.dart';
import '../theme/tokens.dart';

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

class _LibraryPanelState extends State<LibraryPanel> with SingleTickerProviderStateMixin {
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

    return Container(
      margin: const EdgeInsets.fromLTRB(
        DexTokens.spaceLg, DexTokens.spaceSm, DexTokens.spaceLg, DexTokens.spaceSm,
      ),
      decoration: BoxDecoration(
        color: t.surfaceRaised,
        borderRadius: BorderRadius.circular(DexTokens.radiusMd),
        border: Border.all(color: t.border),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Expanded(
                child: TabBar(
                  controller: _tabs,
                  labelStyle: DexType.sans(size: 12, weight: FontWeight.w600),
                  unselectedLabelStyle: DexType.sans(size: 12),
                  labelColor: t.text,
                  unselectedLabelColor: t.textMuted,
                  indicatorColor: t.eventColor('done'),
                  indicatorSize: TabBarIndicatorSize.label,
                  dividerColor: Colors.transparent,
                  tabs: const [
                    Tab(text: 'Workflows', height: 38),
                    Tab(text: 'History', height: 38),
                    Tab(text: 'Usage', height: 38),
                  ],
                ),
              ),
              IconButton(
                icon: Icon(Icons.close, size: 16, color: t.textMuted),
                onPressed: widget.onClose,
                tooltip: 'Close',
              ),
            ],
          ),
          Divider(height: 1, color: t.border),
          SizedBox(
            height: 260,
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
            DexTokens.spaceMd, DexTokens.spaceSm, DexTokens.spaceMd, 0,
          ),
          child: TextField(
            controller: _search,
            style: DexType.sans(size: 12.5, color: t.text),
            decoration: InputDecoration(
              isDense: true,
              hintText: 'Search what you have asked…',
              hintStyle: DexType.sans(size: 12.5, color: t.textFaint),
              prefixIcon: Icon(Icons.search, size: 15, color: t.textFaint),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(DexTokens.radiusSm),
                borderSide: BorderSide(color: t.border),
              ),
            ),
            onSubmitted: (q) => setState(() => widget.client.refreshHistory(query: q)),
          ),
        ),
        Expanded(
          child: widget.client.pastTasks.isEmpty
              ? _empty(t, 'Nothing recorded yet.', 'Every task you run is kept here, locally.')
              : ListView.builder(
                  padding: const EdgeInsets.all(DexTokens.spaceMd),
                  itemCount: widget.client.pastTasks.length,
                  itemBuilder: (context, i) => _historyRow(t, widget.client.pastTasks[i]),
                ),
        ),
      ],
    );
  }

  Widget _historyRow(DexTokens t, TaskRecord task) {
    final when = DateTime.fromMillisecondsSinceEpoch(task.startedAt);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            task.succeeded ? Icons.check : Icons.close,
            size: 13,
            color: task.succeeded ? t.eventColor('done') : t.eventColor('failed'),
          ),
          const SizedBox(width: DexTokens.spaceSm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  task.text,
                  style: DexType.sans(size: 12.5, color: t.text),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                Row(
                  children: [
                    Text(
                      '${when.day}/${when.month} ${when.hour.toString().padLeft(2, '0')}:'
                      '${when.minute.toString().padLeft(2, '0')}',
                      style: DexType.mono(size: 10, color: t.textFaint),
                    ),
                    if (task.workflow != null) ...[
                      const SizedBox(width: 6),
                      // Worth marking: these cost no planning call.
                      _pill(t, task.workflow!, t.eventColor('routing')),
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
            _stat(t, '${stats.completed}', 'completed', t.eventColor('done')),
            if (stats.failed > 0) _stat(t, '${stats.failed}', 'failed', t.eventColor('failed')),
            if (stats.workflowRuns > 0)
              _stat(t, '${stats.workflowRuns}', 'replayed', t.eventColor('routing')),
          ],
        ),
        if (stats.workflowRuns > 0) ...[
          const SizedBox(height: DexTokens.spaceSm),
          Text(
            '${stats.workflowRuns} planning call${stats.workflowRuns == 1 ? '' : 's'} '
            'avoided by saved workflows',
            style: DexType.sans(size: 11, color: t.textMuted),
          ),
        ],
        const SizedBox(height: DexTokens.spaceMd),
        if (stats.byDay.isNotEmpty) ...[
          Text('Per day', style: DexType.sans(size: 11.5, color: t.textMuted)),
          const SizedBox(height: 6),
          for (final day in stats.byDay)
            Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Row(
                children: [
                  SizedBox(
                    width: 58,
                    child: Text(day.day.substring(5),
                        style: DexType.mono(size: 10, color: t.textFaint)),
                  ),
                  Expanded(
                    child: LinearProgressIndicator(
                      value: day.tasks / peak,
                      minHeight: 5,
                      backgroundColor: t.surface,
                      valueColor: AlwaysStoppedAnimation(t.eventColor('executing')),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text('${day.tasks}', style: DexType.mono(size: 10, color: t.textMuted)),
                ],
              ),
            ),
        ],
        if (stats.topActions.isNotEmpty) ...[
          const SizedBox(height: DexTokens.spaceMd),
          Text('Most used', style: DexType.sans(size: 11.5, color: t.textMuted)),
          const SizedBox(height: 6),
          for (final action in stats.topActions.take(6))
            Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Row(
                children: [
                  SizedBox(
                    width: 34,
                    child: Text('${action.runs}×',
                        style: DexType.mono(size: 11, color: t.textMuted)),
                  ),
                  Expanded(
                    child: Text(action.action,
                        style: DexType.mono(size: 11.5, color: t.text)),
                  ),
                  if (action.failures > 0)
                    _pill(t, '${action.failures} failed', t.eventColor('failed')),
                ],
              ),
            ),
        ],
      ],
    );
  }

  // ── shared bits ───────────────────────────────────────────────────────────

  Widget _stat(DexTokens t, String value, String label, [Color? color]) => Padding(
        padding: const EdgeInsets.only(right: DexTokens.spaceLg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(value, style: DexType.mono(size: 19, color: color ?? t.text)),
            Text(label, style: DexType.sans(size: 10.5, color: t.textMuted)),
          ],
        ),
      );

  Widget _pill(DexTokens t, String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.14),
          borderRadius: BorderRadius.circular(3),
        ),
        child: Text(text, style: DexType.mono(size: 9.5, color: color)),
      );

  Widget _empty(DexTokens t, String title, String detail) => Center(
        child: Padding(
          padding: const EdgeInsets.all(DexTokens.spaceLg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(title, style: DexType.sans(size: 13, color: t.textMuted)),
              const SizedBox(height: 4),
              Text(
                detail,
                textAlign: TextAlign.center,
                style: DexType.sans(size: 11.5, color: t.textFaint, height: 1.4),
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
    widget.client.runWorkflow(widget.workflow, _args.map((c) => c.text.trim()).toList());
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final w = widget.workflow;
    final ready = _armed && _args.every((c) => c.text.trim().isNotEmpty);

    return Container(
      padding: const EdgeInsets.all(DexTokens.spaceMd),
      decoration: BoxDecoration(
        color: t.surface,
        borderRadius: BorderRadius.circular(DexTokens.radiusSm),
        border: Border.all(color: t.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(w.name, style: DexType.mono(size: 13, color: t.text, weight: FontWeight.w600)),
              const SizedBox(width: 6),
              Text('${w.steps} step${w.steps == 1 ? '' : 's'}',
                  style: DexType.mono(size: 10, color: t.textFaint)),
              if (w.runCount > 0) ...[
                const SizedBox(width: 6),
                Text('· run ${w.runCount}×',
                    style: DexType.mono(size: 10, color: t.textFaint)),
              ],
              const Spacer(),
              InkWell(
                onTap: () => widget.client.deleteWorkflow(w.name),
                child: Icon(Icons.delete_outline, size: 15, color: t.textFaint),
              ),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            w.description.isEmpty ? w.triggerText : w.description,
            style: DexType.sans(size: 11.5, color: t.textMuted),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: DexTokens.spaceSm),
          Row(
            children: [
              for (var i = 0; i < w.params.length; i++) ...[
                SizedBox(
                  width: 96,
                  child: TextField(
                    controller: _args[i],
                    onChanged: (_) => setState(() {}),
                    style: DexType.mono(size: 11.5, color: t.text),
                    decoration: InputDecoration(
                      isDense: true,
                      contentPadding:
                          const EdgeInsets.symmetric(horizontal: 7, vertical: 7),
                      hintText: w.params[i],
                      hintStyle: DexType.mono(size: 11.5, color: t.textFaint),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(DexTokens.radiusSm),
                        borderSide: BorderSide(color: t.border),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 6),
              ],
              const Spacer(),
              // Null when not ready, so an unarmed control is not in the
              // gesture arena at all — same rule as the confirmation card.
              GestureDetector(
                onTap: ready ? _run : null,
                child: AnimatedOpacity(
                  duration: DexTokens.durFast,
                  opacity: ready ? 1 : 0.35,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 7),
                    decoration: BoxDecoration(
                      color: t.eventColor('done').withValues(alpha: 0.16),
                      borderRadius: BorderRadius.circular(DexTokens.radiusSm),
                      border: Border.all(
                        color: t.eventColor('done').withValues(alpha: 0.5),
                      ),
                    ),
                    child: Text(
                      'Run',
                      style: DexType.sans(
                        size: 12,
                        color: t.eventColor('done'),
                        weight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
