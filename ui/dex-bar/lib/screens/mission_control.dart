import 'package:flutter/material.dart';

import '../core/gateway_client.dart';
import '../core/models.dart';
import '../core/theme_controller.dart';
import '../theme/tokens.dart';
import '../widgets/access_chip.dart';
import '../widgets/plan_view.dart';
import '../widgets/primitives/primitives.dart';
import '../widgets/step_stream.dart';

/// Expanded view: plan DAG, live stream, evidence, and task history.
class MissionControl extends StatefulWidget {
  const MissionControl({
    super.key,
    required this.client,
    required this.onClose,
    this.theme,
  });

  final GatewayClient client;
  final VoidCallback onClose;
  final ThemeController? theme;

  @override
  State<MissionControl> createState() => _MissionControlState();
}

class _MissionControlState extends State<MissionControl> {
  TaskRun? _selected;

  GatewayClient get client => widget.client;

  TaskRun? get _run =>
      _selected ??
      client.current ??
      (client.history.isNotEmpty ? client.history.first : null);

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final run = _run;

    return Column(
      children: [
        _Header(client: client, onClose: widget.onClose, theme: widget.theme),
        Divider(height: 1, color: t.border),
        if (client.lastNotice != null) _Notice(client: client),
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                width: 250,
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
  const _Header({required this.client, required this.onClose, this.theme});

  final GatewayClient client;
  final VoidCallback onClose;
  final ThemeController? theme;

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
          Text('DEX', style: DexType.display(color: t.text, strong: true)),
          const SizedBox(width: DexTokens.spaceSm),
          Text('Mission Control', style: DexType.body(color: t.textMuted)),
          const Spacer(),
          DexTag.round(
            connected ? 'core connected' : 'core offline',
            tone: connected ? t.positive : t.negative,
            filled: false,
          ),
          if (client.preApprovals.isNotEmpty) ...[
            const SizedBox(width: DexTokens.spaceSm),
            Tooltip(
              message: 'Pre-approved this session:\n'
                  '${client.preApprovals.join('\n')}\n\nClick to revoke.',
              child: DexButton(
                label: '${client.preApprovals.length} pre-approved',
                variant: DexButtonVariant.primary,
                tone: t.tierColor(3),
                dense: true,
                onTap: client.clearPreApprovals,
              ),
            ),
          ],
          const SizedBox(width: DexTokens.spaceSm),
          AccessChip(
            enabled: client.fullAccess,
            serviceState: client.daemonService,
            onToggle: client.setFullAccess,
          ),
          const SizedBox(width: DexTokens.spaceXs),
          if (theme != null)
            DexIconButton(
              icon: theme!.icon,
              tooltip: '${theme!.label}\nClick to change.',
              size: 16,
              onTap: theme!.cycle,
            ),
          DexIconButton(
            icon: Icons.close_rounded,
            tooltip: 'Close  (Ctrl+M)',
            size: 17,
            onTap: onClose,
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
      padding: const EdgeInsets.fromLTRB(
        DexTokens.spaceLg,
        DexTokens.spaceSm,
        DexTokens.spaceSm,
        DexTokens.spaceSm,
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(client.lastNotice!, style: DexType.body(color: t.text)),
          ),
          DexIconButton(
            icon: Icons.close_rounded,
            tooltip: 'Dismiss',
            size: 14,
            onTap: client.dismissNotice,
          ),
        ],
      ),
    );
  }
}

class _HistoryList extends StatelessWidget {
  const _HistoryList({
    required this.client,
    required this.selected,
    required this.onSelect,
  });

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
        child: Text('No tasks yet', style: DexType.body(color: t.textFaint)),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: DexTokens.spaceSm),
      itemCount: runs.length,
      itemBuilder: (context, i) {
        final run = runs[i];
        final isSelected = identical(run, selected);
        final color = switch (run.phase) {
          TaskPhase.done => t.positive,
          TaskPhase.failed => t.negative,
          TaskPhase.cancelled => t.attention,
          TaskPhase.awaiting => t.attention,
          _ => t.info,
        };

        return Padding(
          padding: const EdgeInsets.fromLTRB(
            DexTokens.spaceSm,
            2,
            DexTokens.spaceSm,
            2,
          ),
          child: FocusRing(
            enabled: true,
            onTap: () => onSelect(run),
            semanticLabel: run.prompt,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
              decoration: BoxDecoration(
                color: isSelected ? t.surfaceRaised : Colors.transparent,
                borderRadius: BorderRadius.circular(DexTokens.radiusSm),
                border: Border.all(
                  color: isSelected ? t.border : Colors.transparent,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(top: 5),
                        child: Container(
                          width: 6,
                          height: 6,
                          decoration: BoxDecoration(
                            color: color,
                            shape: BoxShape.circle,
                          ),
                        ),
                      ),
                      const SizedBox(width: DexTokens.spaceSm),
                      Expanded(
                        child: Text(
                          run.prompt,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: DexType.body(color: t.text),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Padding(
                    padding: const EdgeInsets.only(left: 14),
                    child: Text(
                      '${run.status ?? run.phase.name} · '
                      '${(run.elapsed.inMilliseconds / 1000).toStringAsFixed(1)}s',
                      style: DexType.codeSm(color: t.textFaint),
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
                      ? Text(
                          'No plan yet',
                          style: DexType.body(color: t.textFaint),
                        )
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
          style: DexType.body(color: t.textFaint),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(DexTokens.spaceLg),
      itemCount: client.evidence.length,
      itemBuilder: (context, i) {
        final e = client.evidence[i];
        // UNVERIFIABLE is not a lesser success — it is Dex saying it could not
        // check. It gets the same warn tone as a retry, never the done tone.
        final color = switch (e.status) {
          'VERIFIED' => t.positive,
          'FAILED' => t.negative,
          _ => t.warn,
        };

        return DexPanel(
          raised: false,
          margin: const EdgeInsets.only(bottom: DexTokens.spaceSm),
          padding: const EdgeInsets.all(DexTokens.spaceMd),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  DexTag(e.status, tone: color),
                  const SizedBox(width: DexTokens.spaceSm),
                  Expanded(
                    child: Text(
                      '${e.stepId} · ${e.action}',
                      overflow: TextOverflow.ellipsis,
                      style: DexType.code(color: t.text),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: DexTokens.spaceSm),
              SelectableText(e.reason, style: DexType.codeSm(color: t.textMuted)),
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
                    style: DexType.codeSm(color: t.textFaint),
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
          Icon(
            Icons.dashboard_customize_outlined,
            size: 26,
            color: tokens.textFaint,
          ),
          const SizedBox(height: DexTokens.spaceMd),
          Text(
            'Run a task to see its plan, stream and evidence',
            style: DexType.body(color: tokens.textFaint),
          ),
        ],
      ),
    );
  }
}
