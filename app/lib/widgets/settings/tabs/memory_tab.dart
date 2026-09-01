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
          'A workflow replays a task without asking the model to plan it '
          'again — faster, and the same steps every time.',
        ),
        const SizedBox(height: 12),
        if (workflows.isEmpty)
          const _Card(
            child: Text(
              'None saved. After a task you are happy with, ask Dex to save it.',
              style: TextStyle(color: DexColors.textFaint, fontSize: 12),
            ),
          )
        else
          for (final w in workflows)
            _WorkflowRow(
              workflow: w,
              onForget: () => client.forgetWorkflow(w['name'] as String? ?? ''),
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
  const _WorkflowRow({required this.workflow, required this.onForget});

  final Map<String, dynamic> workflow;
  final VoidCallback onForget;

  @override
  Widget build(BuildContext context) {
    final runs = workflow['runCount'] as int? ?? 0;
    return _Card(
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      workflow['name'] as String? ?? '',
                      style: const TextStyle(
                        color: DexColors.text,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '${workflow['steps'] ?? 0} steps'
                      '${runs > 0 ? '  ·  run $runs×' : ''}',
                      style: const TextStyle(
                          color: DexColors.textFaint, fontSize: 11),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  (workflow['description'] as String?)?.isNotEmpty == true
                      ? workflow['description'] as String
                      : workflow['triggerText'] as String? ?? '',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      color: DexColors.textDim, fontSize: 11.5, height: 1.4),
                ),
              ],
            ),
          ),
          MouseRegion(
            cursor: SystemMouseCursors.click,
            child: GestureDetector(
              onTap: onForget,
              child: const Text('Forget',
                  style: TextStyle(color: DexColors.stateError, fontSize: 11.5)),
            ),
          ),
        ],
      ),
    );
  }
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
