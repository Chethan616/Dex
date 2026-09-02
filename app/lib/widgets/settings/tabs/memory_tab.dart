// Memory: what Dex has actually done, and what it has learned to repeat.
//
// This read `~/.dex/workspace/MEMORY.md` — a file v1 wrote and nothing in this
// Dex has ever read. It reported a fact count from a document no part of the
// system consults, which is a worse failure than an empty screen: it looked
// like memory was working.
//
// The real memory is in %LOCALAPPDATA%\DEX\dex.db: every task with its
// outcome and duration, and the workflows saved out of the ones worth
// repeating. That is what this shows now, and forgetting a workflow here
// actually forgets it.


import 'package:flutter/material.dart';

import '../../../core/dex_gateway.dart';
import '../../../theme/tokens.dart';

class MemoryTab extends StatefulWidget {
  const MemoryTab({super.key});

  @override
  State<MemoryTab> createState() => _MemoryTabState();
}

class _MemoryTabState extends State<MemoryTab> {
  final _search = TextEditingController();
  String _query = '';

  DexGatewayClient? get _client => DexGatewayClient.current;

  @override
  void initState() {
    super.initState();
    _client?.addListener(_onChange);
    _refresh();
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  void _refresh() {
    _client
      ?..refreshStats()
      ..refreshWorkflows()
      ..refreshHistory(query: _query);
  }

  @override
  void dispose() {
    _client?.removeListener(_onChange);
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final client = _client;
    if (client == null) {
      return const _Empty('The Dex core is not connected.');
    }

    final stats = client.stats;
    final workflows = client.workflows;
    final history = client.history;

    return ListView(
      padding: const EdgeInsets.fromLTRB(28, 24, 28, 40),
      children: [
        const _Title('What Dex remembers'),
        const _Blurb(
          r'Every task, its outcome and how long it took, in '
          r'%LOCALAPPDATA%\DEX\dex.db. Local, and never uploaded.',
        ),
        const SizedBox(height: 18),

        if (stats != null) _StatsRow(stats: stats),
        const SizedBox(height: 24),

        const _Title('Saved workflows'),
        const _Blurb(
          'Every task that works is saved here on its own, with the values you '
          'chose turned into parameters. Ask for the same thing again and it '
          'replays with your new values and no planning call at all.',
        ),
        const SizedBox(height: 12),
        if (workflows.isEmpty)
          const _Card(
            child: Text(
              'Nothing yet. Finish a task and it appears here.',
              style: TextStyle(color: DexColors.textFaint, fontSize: 12),
            ),
          )
        else
          for (final w in workflows)
            _WorkflowRow(
              workflow: w,
              onForget: () => client.forgetWorkflow(w['name'] as String? ?? ''),
              onRename: (to) =>
                  client.renameWorkflow(w['name'] as String? ?? '', to),
            ),

        const SizedBox(height: 24),
        const _Title('Recent tasks'),
        const SizedBox(height: 10),
        SizedBox(
          height: 32,
          child: TextField(
            controller: _search,
            onChanged: (q) {
              setState(() => _query = q);
              client.refreshHistory(query: q);
            },
            style: const TextStyle(color: DexColors.text, fontSize: 12),
            decoration: InputDecoration(
              isDense: true,
              hintText: 'Search what you have asked for…',
              hintStyle: const TextStyle(color: DexColors.textFaint, fontSize: 12),
              prefixIcon: const Icon(Icons.search_rounded,
                  size: 15, color: DexColors.textFaint),
              prefixIconConstraints:
                  const BoxConstraints(minWidth: 30, minHeight: 30),
              filled: true,
              fillColor: DexColors.surface2.withValues(alpha: 0.4),
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: const BorderSide(color: DexColors.border),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: const BorderSide(color: DexColors.border),
              ),
            ),
          ),
        ),
        const SizedBox(height: 10),
        if (history.isEmpty)
          _Card(
            child: Text(
              _query.isEmpty
                  ? 'Nothing yet.'
                  : 'Nothing matches “$_query”.',
              style: const TextStyle(color: DexColors.textFaint, fontSize: 12),
            ),
          )
        else
          for (final task in history) _TaskRow(task: task),
      ],
    );
  }
}

class _StatsRow extends StatelessWidget {
  const _StatsRow({required this.stats});

  final Map<String, dynamic> stats;

  @override
  Widget build(BuildContext context) {
    final total = stats['totalTasks'] as int? ?? 0;
    final completed = stats['completed'] as int? ?? 0;
    final failed = stats['failed'] as int? ?? 0;
    final replayed = stats['workflowRuns'] as int? ?? 0;

    return Row(
      children: [
        _Stat(label: 'Tasks', value: '$total', hint: 'last 7 days'),
        _Stat(
          label: 'Completed',
          value: '$completed',
          tone: DexColors.stateApprove,
        ),
        _Stat(
          label: 'Failed',
          value: '$failed',
          tone: failed > 0 ? DexColors.stateError : null,
        ),
        _Stat(
          label: 'Replayed',
          value: '$replayed',
          // The number worth understanding: these ran from a saved workflow,
          // so they cost no planning call at all.
          hint: 'no planning call',
        ),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({
    required this.label,
    required this.value,
    this.hint,
    this.tone,
  });

  final String label;
  final String value;
  final String? hint;
  final Color? tone;

  @override
  Widget build(BuildContext context) => Expanded(
        child: Container(
          margin: const EdgeInsets.only(right: 8),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: DexColors.surface.withValues(alpha: 0.45),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: DexColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                value,
                style: TextStyle(
                  color: tone ?? DexColors.text,
                  fontSize: 20,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 2),
              Text(label,
                  style: const TextStyle(
                      color: DexColors.textDim, fontSize: 11.5)),
              if (hint != null)
                Text(hint!,
                    style: const TextStyle(
                        color: DexColors.textFaint, fontSize: 10)),
            ],
          ),
        ),
      );
}

class _WorkflowRow extends StatelessWidget {
  const _WorkflowRow({
    required this.workflow,
    required this.onForget,
    required this.onRename,
  });

  final Map<String, dynamic> workflow;
  final VoidCallback onForget;
  final ValueChanged<String> onRename;

  @override
  Widget build(BuildContext context) {
    final name = workflow['name'] as String? ?? '';
    final runs = workflow['runCount'] as int? ?? 0;
    final params = (workflow['params'] as List?)?.cast<String>() ?? const [];
    final learned = workflow['origin'] != 'named';
    final failures = workflow['failCount'] as int? ?? 0;

    return _Card(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        name,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: DexColors.text,
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    // Learned, not chosen. Worth saying: it explains the slug
                    // of a name, and that renaming it is available.
                    if (learned)
                      const _Tag(text: 'learned', tone: DexColors.textFaint),
                    if (!learned)
                      const _Tag(text: 'named', tone: DexColors.accent),
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  (workflow['description'] as String?)?.isNotEmpty == true
                      ? workflow['description'] as String
                      : workflow['triggerText'] as String? ?? '',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      color: DexColors.textDim, fontSize: 11.5, height: 1.4),
                ),
                const SizedBox(height: 4),
                Text(
                  [
                    '${workflow['steps'] ?? 0} steps',
                    if (runs > 0) 'replayed $runs×',
                    // The line that explains what a workflow is *for*.
                    if (params.isNotEmpty)
                      'you can change ${params.join(', ')}'
                    else
                      'no parameters',
                    if (failures > 0) 'failed $failures× recently',
                  ].join('  ·  '),
                  style: TextStyle(
                    color: failures > 0
                        ? DexColors.stateAwaiting
                        : DexColors.textFaint,
                    fontSize: 10.5,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              _Action(
                label: learned ? 'Name it' : 'Rename',
                tone: DexColors.accent,
                onTap: () => _rename(context, name),
              ),
              const SizedBox(height: 6),
              _Action(
                label: 'Forget',
                tone: DexColors.stateError,
                onTap: onForget,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _rename(BuildContext context, String current) async {
    final controller = TextEditingController(text: current);
    final chosen = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: DexColors.surface,
        title: const Text('Name this workflow',
            style: TextStyle(color: DexColors.text, fontSize: 15)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'A named workflow is yours: it is never forgotten automatically, '
              'and you can run it by name.',
              style: TextStyle(color: DexColors.textDim, fontSize: 12, height: 1.5),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              autofocus: true,
              style: const TextStyle(color: DexColors.text, fontSize: 13),
              decoration: const InputDecoration(
                hintText: 'lowercase letters, digits, - or _',
                hintStyle: TextStyle(color: DexColors.textFaint, fontSize: 12),
              ),
              onSubmitted: (value) => Navigator.of(context).pop(value),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(controller.text),
            child: const Text('Save'),
          ),
        ],
      ),
    );

    final name = chosen?.trim() ?? '';
    if (name.isNotEmpty && name != current) onRename(name);
  }
}

class _Tag extends StatelessWidget {
  const _Tag({required this.text, required this.tone});
  final String text;
  final Color tone;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(4),
          border: Border.all(color: tone.withValues(alpha: 0.4)),
        ),
        child: Text(text, style: TextStyle(color: tone, fontSize: 9.5)),
      );
}

class _Action extends StatelessWidget {
  const _Action({required this.label, required this.tone, required this.onTap});
  final String label;
  final Color tone;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => MouseRegion(
        cursor: SystemMouseCursors.click,
        child: GestureDetector(
          onTap: onTap,
          child: Text(label, style: TextStyle(color: tone, fontSize: 11.5)),
        ),
      );
}

class _TaskRow extends StatelessWidget {
  const _TaskRow({required this.task});

  final Map<String, dynamic> task;

  @override
  Widget build(BuildContext context) {
    final status = task['status'] as String? ?? '';
    final ok = status == 'COMPLETED' || status == 'ANSWERED';
    final duration = task['durationMs'] as int?;

    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 3),
            child: Icon(
              ok ? Icons.check_rounded : Icons.close_rounded,
              size: 13,
              color: ok ? DexColors.stateApprove : DexColors.stateError,
            ),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              task['text'] as String? ?? '',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  color: DexColors.textDim, fontSize: 12, height: 1.45),
            ),
          ),
          if (duration != null) ...[
            const SizedBox(width: 8),
            Text(
              '${(duration / 1000).toStringAsFixed(1)}s',
              style: const TextStyle(
                color: DexColors.textFaint,
                fontSize: 10.5,
                fontFamily: 'monospace',
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: DexColors.surface.withValues(alpha: 0.45),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: DexColors.border),
        ),
        child: child,
      );
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
                color: DexColors.textDim, fontSize: 12.5, height: 1.55)),
      );
}

class _Empty extends StatelessWidget {
  const _Empty(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Center(
        child: Text(text,
            style: const TextStyle(color: DexColors.textFaint, fontSize: 12)),
      );
}
