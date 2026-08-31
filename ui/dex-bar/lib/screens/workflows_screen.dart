import 'package:flutter/material.dart';

import '../core/gateway_client.dart';
import '../core/models.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';
import '../widgets/primitives/primitives.dart';

/// Saved workflows.
///
/// `/save`, `/workflows`, and `/forget` are now ordinary UI actions. Scheduling
/// has its own destination because an unattended commitment deserves a clear
/// safety boundary rather than being hidden below a saved recipe.
class WorkflowsScreen extends StatefulWidget {
  const WorkflowsScreen({super.key, required this.client});

  final GatewayClient client;

  @override
  State<WorkflowsScreen> createState() => _WorkflowsScreenState();
}

class _WorkflowsScreenState extends State<WorkflowsScreen> {
  @override
  void initState() {
    super.initState();
    widget.client.addListener(_onChange);
    widget.client.refreshWorkflows();
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    widget.client.removeListener(_onChange);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final workflows = widget.client.workflows;

    return ListView(
      padding: const EdgeInsets.all(DexTokens.spaceXl),
      children: [
        Text('Saved workflows', style: DexType.title(color: t.text)),
        const SizedBox(height: 2),
        Text(
          'A workflow replays a task without asking the model to plan it again '
          '— faster, and the same steps every time.',
          style: DexType.caption(color: t.textMuted),
        ),
        const SizedBox(height: DexTokens.spaceMd),
        if (workflows.isEmpty)
          DexPanel(
            padding: const EdgeInsets.all(DexTokens.spaceLg),
            child: Text(
              'None saved. After a task you are happy with, type '
              '/save <name> to keep it.',
              style: DexType.caption(color: t.textFaint),
            ),
          )
        else
          for (var i = 0; i < workflows.length; i++)
            DexEntrance(
              delay: Duration(milliseconds: (i < 8 ? i : 8) * 30),
              child: _WorkflowRow(
                workflow: workflows[i],
                client: widget.client,
              ),
            ),
        const SizedBox(height: DexTokens.spaceXl),
        DexPanel(
          padding: const EdgeInsets.all(DexTokens.spaceLg),
          child: Row(
            children: [
              Icon(Icons.schedule_outlined, size: 18, color: t.info),
              const SizedBox(width: DexTokens.spaceMd),
              Expanded(
                child: Text(
                  'Need an unattended run? Create and manage it in Schedules, '
                  'where its timing and safety boundary stay visible.',
                  style: DexType.caption(color: t.textMuted),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _WorkflowRow extends StatelessWidget {
  const _WorkflowRow({required this.workflow, required this.client});

  final SavedWorkflow workflow;
  final GatewayClient client;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    return Padding(
      padding: const EdgeInsets.only(bottom: DexTokens.spaceSm),
      child: DexPanel(
        padding: const EdgeInsets.all(DexTokens.spaceLg),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(workflow.name,
                          style: DexType.body(strong: true, color: t.text)),
                      const SizedBox(width: DexTokens.spaceSm),
                      DexTag('${workflow.steps} steps', tone: t.info),
                      if (workflow.runCount > 0) ...[
                        const SizedBox(width: DexTokens.spaceXs),
                        DexTag('run ${workflow.runCount}×', tone: t.textFaint,
                            filled: false, outlined: true),
                      ],
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    workflow.description.isEmpty
                        ? workflow.triggerText
                        : workflow.description,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: DexType.caption(color: t.textMuted),
                  ),
                ],
              ),
            ),
            const SizedBox(width: DexTokens.spaceMd),
            DexButton(
              label: 'Run',
              dense: true,
              variant: DexButtonVariant.primary,
              consequential: true,
              onTap: () => client.runWorkflow(workflow, const []),
            ),
            const SizedBox(width: DexTokens.spaceXs),
            DexButton(
              label: 'Forget',
              dense: true,
              tone: t.negative,
              consequential: true,
              onTap: () => client.deleteWorkflow(workflow.name),
            ),
          ],
        ),
      ),
    );
  }
}
