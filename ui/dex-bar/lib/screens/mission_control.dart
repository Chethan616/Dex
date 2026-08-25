import 'package:flutter/material.dart';

import '../core/gateway_client.dart';
import '../core/models.dart';
import '../theme/tokens.dart';
import '../widgets/access_chip.dart';
import '../widgets/plan_view.dart';
import '../widgets/step_stream.dart';

/// Expanded view: plan DAG, live stream, evidence, and task history.
class MissionControl extends StatefulWidget {
  const MissionControl({super.key, required this.client, required this.onClose});

  final GatewayClient client;
  final VoidCallback onClose;

  @override
  State<MissionControl> createState() => _MissionControlState();
}

class _MissionControlState extends State<MissionControl> {
  TaskRun? _selected;

  GatewayClient get client => widget.client;

  TaskRun? get _run => _selected ?? client.current ?? (client.history.isNotEmpty ? client.history.first : null);

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final run = _run;

    return Column(
      children: [
        _Header(client: client, onClose: widget.onClose),
        Divider(height: 1, color: t.border),
        if (client.lastNotice != null) _Notice(client: client),
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                width: 240,
                child: _HistoryList(
                  client: client,
                  selected: run,
                  onSelect: (r) => setState(() => _selected = r),
                ),
              ),
              VerticalDivider(width: 1, color: t.border),
              Expanded(
                child: run == null
                    ? _Empty(tokens: t)
                    : _RunDetail(client: client, run: run),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.client, required this.onClose});

  final GatewayClient client;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final connected = client.connection == CoreConnection.connected;

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: DexTokens.spaceLg,
        vertical: DexTokens.spaceMd,
      ),
      child: Row(
        children: [
          Text('DEX', style: DexType.sans(size: 15, color: t.text, weight: FontWeight.w700, spacing: 1.2)),
          const SizedBox(width: DexTokens.spaceSm),
          Text('Mission Control', style: DexType.sans(size: 13, color: t.textMuted)),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: t.surfaceRaised,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: t.border),
            ),
            child: Text(
              connected ? 'core connected' : 'core offline',
              style: DexType.mono(
                size: 10.5,
                color: connected ? t.eventColor('done') : t.eventColor('failed'),
              ),
            ),
          ),
          if (client.preApprovals.isNotEmpty) ...[
            const SizedBox(width: DexTokens.spaceSm),
            Tooltip(
              message:
                  'Pre-approved this session:\n${client.preApprovals.join('\n')}\n\nClick to revoke.',
              textStyle: DexType.sans(size: 11, color: t.text),
              decoration: BoxDecoration(
                color: t.surfaceRaised,
                borderRadius: BorderRadius.circular(DexTokens.radiusSm),
                border: Border.all(color: t.border),
              ),
              child: MouseRegion(
                cursor: SystemMouseCursors.click,
                child: GestureDetector(
                  onTap: client.clearPreApprovals,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: t.tierColor(3).withValues(alpha: 0.10),
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(color: t.tierColor(3).withValues(alpha: 0.4)),
                    ),
                    child: Text(
                      '${client.preApprovals.length} pre-approved',
                      style: DexType.sans(
                        size: 11.5,
                        color: t.tierColor(3),
                        weight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
          const SizedBox(width: DexTokens.spaceSm),
          AccessChip(
            enabled: client.fullAccess,
            serviceState: client.daemonService,
            onToggle: client.setFullAccess,
          ),
          const SizedBox(width: DexTokens.spaceSm),
          MouseRegion(
            cursor: SystemMouseCursors.click,
            child: GestureDetector(
              onTap: onClose,
              child: Icon(Icons.close_rounded, size: 17, color: t.textMuted),
            ),
          ),
        ],
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.client});

  final GatewayClient client;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return Container(
      width: double.infinity,
      color: t.accentMuted,
      padding: const EdgeInsets.symmetric(
        horizontal: DexTokens.spaceLg,
        vertical: DexTokens.spaceSm,
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              client.lastNotice!,
              style: DexType.sans(size: 12, color: t.text),
            ),
          ),
          MouseRegion(
            cursor: SystemMouseCursors.click,
            child: GestureDetector(
              onTap: client.dismissNotice,
              child: Icon(Icons.close_rounded, size: 14, color: t.textMuted),
            ),
          ),
        ],
      ),
    );
  }
}

class _HistoryList extends StatelessWidget {
  const _HistoryList({required this.client, required this.selected, required this.onSelect});

  final GatewayClient client;
  final TaskRun? selected;
  final ValueChanged<TaskRun> onSelect;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final runs = <TaskRun>[
      if (client.current != null) client.current!,
      ...client.history.where((h) => h != client.current),
    ];

    if (runs.isEmpty) {
      return Center(
        child: Text('No tasks yet', style: DexType.sans(size: 12, color: t.textFaint)),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: DexTokens.spaceSm),
      itemCount: runs.length,
      itemBuilder: (context, i) {
        final run = runs[i];
        final isSelected = identical(run, selected);
        final color = switch (run.phase) {
          TaskPhase.done => t.eventColor('done'),
          TaskPhase.failed => t.eventColor('failed'),
          TaskPhase.cancelled => t.eventColor('cancelled'),
          TaskPhase.awaiting => t.eventColor('awaiting'),
          _ => t.eventColor('executing'),
        };

        return MouseRegion(
          cursor: SystemMouseCursors.click,
          child: GestureDetector(
            onTap: () => onSelect(run),
            child: Container(
              margin: const EdgeInsets.fromLTRB(DexTokens.spaceSm, 2, DexTokens.spaceSm, 2),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
              decoration: BoxDecoration(
                color: isSelected ? t.surfaceRaised : Colors.transparent,
                borderRadius: BorderRadius.circular(DexTokens.radiusSm),
                border: Border.all(color: isSelected ? t.border : Colors.transparent),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 6,
                        height: 6,
                        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                      ),
                      const SizedBox(width: DexTokens.spaceSm),
                      Expanded(
                        child: Text(
                          run.prompt,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: DexType.sans(size: 12.5, color: t.text),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Padding(
                    padding: const EdgeInsets.only(left: 14),
                    child: Text(
                      '${run.status ?? run.phase.name} · ${(run.elapsed.inMilliseconds / 1000).toStringAsFixed(1)}s',
                      style: DexType.mono(size: 10, color: t.textFaint),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _RunDetail extends StatelessWidget {
  const _RunDetail({required this.client, required this.run});

  final GatewayClient client;
  final TaskRun run;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final requestId = run.requestId;

    return DefaultTabController(
      length: 3,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            dividerColor: t.border,
            indicatorColor: t.accent,
            indicatorSize: TabBarIndicatorSize.label,
            labelColor: t.text,
            unselectedLabelColor: t.textMuted,
            labelStyle: DexType.sans(size: 12.5, weight: FontWeight.w500),
            unselectedLabelStyle: DexType.sans(size: 12.5),
            onTap: (i) {
              if (i == 2 && requestId.isNotEmpty) client.loadEvidence(requestId);
            },
            tabs: const [
              Tab(text: 'Stream'),
              Tab(text: 'Plan'),
              Tab(text: 'Evidence'),
            ],
          ),
          Expanded(
            child: TabBarView(
              children: [
                StepStream(events: run.events),
                SingleChildScrollView(
                  padding: const EdgeInsets.all(DexTokens.spaceLg),
                  child: run.plan == null
                      ? Text('No plan yet', style: DexType.sans(size: 12, color: t.textFaint))
                      : PlanView(plan: run.plan!, events: run.events),
                ),
                _EvidencePanel(client: client, requestId: requestId),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _EvidencePanel extends StatelessWidget {
  const _EvidencePanel({required this.client, required this.requestId});

  final GatewayClient client;
  final String requestId;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;

    if (client.evidenceForRequest != requestId || client.evidence.isEmpty) {
      return Center(
        child: Text(
          'No evidence recorded for this task',
          style: DexType.sans(size: 12, color: t.textFaint),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(DexTokens.spaceLg),
      itemCount: client.evidence.length,
      itemBuilder: (context, i) {
        final e = client.evidence[i];
        final color = switch (e.status) {
          'VERIFIED' => t.eventColor('done'),
          'FAILED' => t.eventColor('failed'),
          _ => t.eventColor('selecting'),
        };

        return Container(
          margin: const EdgeInsets.only(bottom: DexTokens.spaceSm),
          padding: const EdgeInsets.all(DexTokens.spaceMd),
          decoration: BoxDecoration(
            color: t.surface,
            borderRadius: BorderRadius.circular(DexTokens.radiusMd),
            border: Border.all(color: t.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: 0.14),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      e.status,
                      style: DexType.mono(size: 9.5, color: color, weight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(width: DexTokens.spaceSm),
                  Text(
                    '${e.stepId} · ${e.action}',
                    style: DexType.mono(size: 11.5, color: t.text),
                  ),
                ],
              ),
              const SizedBox(height: DexTokens.spaceSm),
              SelectableText(e.reason, style: DexType.mono(size: 11, color: t.textMuted)),
              if (e.afterState != null) ...[
                const SizedBox(height: DexTokens.spaceSm),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(DexTokens.spaceSm),
                  decoration: BoxDecoration(
                    color: t.surfaceRaised,
                    borderRadius: BorderRadius.circular(DexTokens.radiusSm),
                  ),
                  child: SelectableText(
                    e.afterState.toString(),
                    maxLines: 12,
                    style: DexType.mono(size: 10.5, color: t.textFaint),
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.tokens});

  final DexTokens tokens;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.dashboard_customize_outlined, size: 28, color: tokens.textFaint),
          const SizedBox(height: DexTokens.spaceMd),
          Text(
            'Run a task to see its plan, stream and evidence',
            style: DexType.sans(size: 12.5, color: tokens.textFaint),
          ),
        ],
      ),
    );
  }
}
