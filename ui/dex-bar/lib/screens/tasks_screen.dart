import 'package:flutter/material.dart';

import '../core/gateway_client.dart';
import '../core/models.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';
import '../widgets/primitives/primitives.dart';

/// Everything you have asked Dex to do.
///
/// This is the `/history` command with a search box. The data was always there
/// — the core records every task in SQLite with its intent, duration and
/// outcome — and the only way to see it was to know the command existed.
class TasksScreen extends StatefulWidget {
  const TasksScreen({super.key, required this.client});

  final GatewayClient client;

  @override
  State<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends State<TasksScreen> {
  final _search = TextEditingController();

  @override
  void initState() {
    super.initState();
    widget.client.addListener(_onChange);
    widget.client.refreshHistory();
    widget.client.refreshStats();
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    widget.client.removeListener(_onChange);
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final tasks = widget.client.pastTasks;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            DexTokens.spaceXl,
            DexTokens.spaceXl,
            DexTokens.spaceXl,
            DexTokens.spaceMd,
          ),
          child: Row(
            children: [
              Expanded(
                child: DexField(
                  controller: _search,
                  hint: 'Search what you have asked for',
                  prefix: Icons.search_rounded,
                  onChanged: (q) => widget.client.refreshHistory(query: q),
                ),
              ),
              const SizedBox(width: DexTokens.spaceMd),
              if (widget.client.stats != null)
                Tooltip(
                  message: '${widget.client.stats!.completed} completed, '
                      '${widget.client.stats!.failed} failed\n'
                      '${widget.client.stats!.workflowRuns} replayed from a '
                      'saved workflow — planning calls that did not have to happen',
                  child: DexTag(
                    '${widget.client.stats!.totalTasks} tasks · 7 days',
                    tone: t.info,
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: tasks.isEmpty
              ? Center(
                  child: Text(
                    _search.text.isEmpty
                        ? 'Nothing yet. Ask Dex for something.'
                        : 'Nothing matched “${_search.text}”.',
                    style: DexType.caption(color: t.textFaint),
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(
                    DexTokens.spaceXl,
                    0,
                    DexTokens.spaceXl,
                    DexTokens.spaceXl,
                  ),
                  itemCount: tasks.length,
                  itemBuilder: (context, i) => DexEntrance(
                    delay: Duration(milliseconds: (i < 8 ? i : 8) * 25),
                    child: _TaskRow(
                      record: tasks[i],
                      onRerun: () => widget.client.submit(tasks[i].text),
                    ),
                  ),
                ),
        ),
      ],
    );
  }
}

class _TaskRow extends StatefulWidget {
  const _TaskRow({required this.record, required this.onRerun});

  final TaskRecord record;
  final VoidCallback onRerun;

  @override
  State<_TaskRow> createState() => _TaskRowState();
}

class _TaskRowState extends State<_TaskRow> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final r = widget.record;
    final ok = r.status == 'done' || r.status == 'success';

    return MouseRegion(
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: Container(
        margin: const EdgeInsets.only(bottom: DexTokens.spaceXs),
        padding: const EdgeInsets.symmetric(
          horizontal: DexTokens.spaceMd,
          vertical: DexTokens.spaceMd,
        ),
        decoration: BoxDecoration(
          color: _hover ? t.surfaceRaised : Colors.transparent,
          borderRadius: BorderRadius.circular(DexTokens.radiusMd),
        ),
        child: Row(
          children: [
            Icon(
              ok ? Icons.check_rounded : Icons.close_rounded,
              size: 14,
              color: ok ? t.positive : t.negative,
            ),
            const SizedBox(width: DexTokens.spaceMd),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    r.text,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: DexType.body(color: t.text),
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Text(
                        _when(r.startedAt),
                        style: DexType.caption(color: t.textFaint),
                      ),
                      if (r.durationMs != null) ...[
                        Text(' · ', style: DexType.caption(color: t.textFaint)),
                        Text(
                          '${(r.durationMs! / 1000).toStringAsFixed(1)}s',
                          style: DexType.code(color: t.textFaint),
                        ),
                      ],
                      if (r.workflow != null) ...[
                        const SizedBox(width: DexTokens.spaceSm),
                        DexTag(r.workflow!, tone: t.attention, filled: false, outlined: true),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            AnimatedOpacity(
              duration: DexMotion.durationOf(context, DexMotion.fast),
              opacity: _hover ? 1 : 0,
              child: DexButton(
                label: 'Run again',
                dense: true,
                consequential: true,
                onTap: widget.onRerun,
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _when(int epochMs) {
    final at = DateTime.fromMillisecondsSinceEpoch(epochMs);
    final ago = DateTime.now().difference(at);
    if (ago.inMinutes < 1) return 'just now';
    if (ago.inHours < 1) return '${ago.inMinutes}m ago';
    if (ago.inDays < 1) return '${ago.inHours}h ago';
    if (ago.inDays < 7) return '${ago.inDays}d ago';
    return '${at.year}-${at.month.toString().padLeft(2, '0')}-'
        '${at.day.toString().padLeft(2, '0')}';
  }
}
