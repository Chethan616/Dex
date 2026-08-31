import 'package:flutter/material.dart';

import '../core/gateway_client.dart';
import '../core/models.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';
import '../widgets/primitives/primitives.dart';

/// The scheduler as a real destination rather than a slash-command easter egg.
///
/// Scheduling is deliberately separate from Workflows: a workflow is a saved
/// recipe, while a schedule is an unattended commitment to run one. Keeping
/// the two visible as different things makes the safety boundary legible.
class SchedulesScreen extends StatefulWidget {
  const SchedulesScreen({super.key, required this.client});

  final GatewayClient client;

  @override
  State<SchedulesScreen> createState() => _SchedulesScreenState();
}

class _SchedulesScreenState extends State<SchedulesScreen> {
  final _name = TextEditingController();
  final _when = TextEditingController();
  final _request = TextEditingController();

  @override
  void initState() {
    super.initState();
    widget.client.addListener(_onChange);
    widget.client.refreshSchedules();
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    widget.client.removeListener(_onChange);
    _name.dispose();
    _when.dispose();
    _request.dispose();
    super.dispose();
  }

  void _save() {
    final name = _name.text.trim();
    final when = _when.text.trim();
    final request = _request.text.trim();
    if (name.isEmpty || when.isEmpty || request.isEmpty) return;
    widget.client.saveSchedule(name: name, when: when, request: request);
    _name.clear();
    _when.clear();
    _request.clear();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final schedules = widget.client.schedules;

    return ListView(
      padding: const EdgeInsets.all(DexTokens.spaceXl),
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Schedules', style: DexType.title(color: t.text)),
                  const SizedBox(height: 2),
                  Text(
                    'Things Dex will do when nobody is watching.',
                    style: DexType.caption(color: t.textMuted),
                  ),
                ],
              ),
            ),
            if (schedules.isNotEmpty)
              DexTag(
                '${schedules.where((s) => s.enabled).length} active',
                tone: t.info,
              ),
          ],
        ),
        const SizedBox(height: DexTokens.spaceLg),
        DexPanel(
          accent: t.accent,
          padding: const EdgeInsets.all(DexTokens.spaceLg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Make one', style: DexType.body(strong: true, color: t.text)),
              const SizedBox(height: DexTokens.spaceXs),
              Text(
                'Use plain timing or a five-field cron expression. A schedule '
                'never waits for an approval card — steps that need one are '
                'refused at run time.',
                style: DexType.caption(color: t.textMuted),
              ),
              const SizedBox(height: DexTokens.spaceMd),
              LayoutBuilder(
                builder: (context, constraints) {
                  final narrow = constraints.maxWidth < 620;
                  final fields = [
                    SizedBox(
                      width: narrow ? double.infinity : 150,
                      child: DexField(controller: _name, hint: 'Name it'),
                    ),
                    SizedBox(
                      width: narrow ? double.infinity : 250,
                      child: DexField(
                        controller: _when,
                        hint: 'every weekday at 07:30',
                      ),
                    ),
                  ];
                  return narrow
                      ? Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            fields[0],
                            const SizedBox(height: DexTokens.spaceSm),
                            fields[1],
                          ],
                        )
                      : Row(children: [fields[0], const SizedBox(width: DexTokens.spaceSm), fields[1]]);
                },
              ),
              const SizedBox(height: DexTokens.spaceSm),
              Row(
                children: [
                  Expanded(
                    child: DexField(
                      controller: _request,
                      hint: 'What it should do',
                      onSubmitted: (_) => _save(),
                    ),
                  ),
                  const SizedBox(width: DexTokens.spaceSm),
                  DexButton(
                    label: 'Schedule',
                    icon: Icons.schedule_rounded,
                    variant: DexButtonVariant.primary,
                    enabled: !widget.client.scheduleBusy,
                    consequential: true,
                    onTap: _save,
                  ),
                ],
              ),
              const SizedBox(height: DexTokens.spaceSm),
              Text(
                'Examples: “every day at 8”, “every 30 minutes”, '
                '“every monday at 9pm”, or “0 8 * * 1-5”.',
                style: DexType.codeSm(color: t.textFaint),
              ),
            ],
          ),
        ),
        const SizedBox(height: DexTokens.spaceXl),
        if (schedules.isEmpty)
          DexPanel(
            padding: const EdgeInsets.all(DexTokens.spaceXl),
            child: Column(
              children: [
                Icon(Icons.schedule_outlined, size: 28, color: t.textFaint),
                const SizedBox(height: DexTokens.spaceMd),
                Text('Nothing scheduled.', style: DexType.body(color: t.textMuted)),
                const SizedBox(height: DexTokens.spaceXs),
                Text(
                  'Scheduled runs skip missed time while the machine sleeps '
                  'and never catch up in a burst.',
                  textAlign: TextAlign.center,
                  style: DexType.caption(color: t.textFaint),
                ),
              ],
            ),
          )
        else
          for (var i = 0; i < schedules.length; i++)
            DexEntrance(
              delay: Duration(milliseconds: (i < 8 ? i : 8) * 30),
              child: _ScheduleRow(
                schedule: schedules[i],
                client: widget.client,
              ),
            ),
      ],
    );
  }
}

class _ScheduleRow extends StatelessWidget {
  const _ScheduleRow({required this.schedule, required this.client});

  final ScheduleRecord schedule;
  final GatewayClient client;

  @override
  Widget build(BuildContext context) {
    final t = context.dex;
    final tone = schedule.enabled ? t.positive : t.textFaint;
    final last = schedule.runCount == 0
        ? 'Never run'
        : '${schedule.runCount} run${schedule.runCount == 1 ? '' : 's'}'
            '${schedule.failCount == 0 ? '' : ' · ${schedule.failCount} failed'}';

    return Padding(
      padding: const EdgeInsets.only(bottom: DexTokens.spaceSm),
      child: DexPanel(
        padding: const EdgeInsets.all(DexTokens.spaceLg),
        accent: schedule.enabled ? tone : null,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 3),
              child: Icon(Icons.schedule_rounded, size: 17, color: tone),
            ),
            const SizedBox(width: DexTokens.spaceMd),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(schedule.name, style: DexType.body(strong: true, color: t.text)),
                      const SizedBox(width: DexTokens.spaceSm),
                      DexTag(schedule.enabled ? 'Active' : 'Paused', tone: tone),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(schedule.description, style: DexType.caption(color: t.textMuted)),
                  const SizedBox(height: DexTokens.spaceXs),
                  Text(
                    schedule.request,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: DexType.body(color: t.text),
                  ),
                  const SizedBox(height: DexTokens.spaceSm),
                  Wrap(
                    spacing: DexTokens.spaceSm,
                    runSpacing: DexTokens.spaceXs,
                    children: [
                      Text(last, style: DexType.caption(color: t.textFaint)),
                      if (schedule.nextRun != null)
                        Text(
                          'next ${_when(schedule.nextRun!)}',
                          style: DexType.codeSm(color: t.info),
                        ),
                      if (schedule.lastStatus != null)
                        Text(
                          'last ${schedule.lastStatus}',
                          style: DexType.caption(
                            color: schedule.lastStatus == 'COMPLETED' ? t.positive : t.warn,
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: DexTokens.spaceMd),
            Wrap(
              spacing: DexTokens.spaceXs,
              children: [
                DexButton(
                  label: schedule.enabled ? 'Pause' : 'Resume',
                  dense: true,
                  enabled: !client.scheduleBusy,
                  consequential: true,
                  onTap: () => client.setScheduleEnabled(schedule.name, !schedule.enabled),
                ),
                DexButton(
                  label: 'Delete',
                  dense: true,
                  tone: t.negative,
                  variant: DexButtonVariant.ghost,
                  enabled: !client.scheduleBusy,
                  consequential: true,
                  onTap: () => client.deleteSchedule(schedule.name),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  static String _when(DateTime date) {
    final local = date.toLocal();
    final hour = local.hour % 12 == 0 ? 12 : local.hour % 12;
    final minute = local.minute.toString().padLeft(2, '0');
    final suffix = local.hour >= 12 ? 'pm' : 'am';
    return '${local.month}/${local.day} $hour:$minute$suffix';
  }
}
