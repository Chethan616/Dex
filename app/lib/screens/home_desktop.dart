// The three-zone desktop layout from design.md section 5:
//   Devices | Conversation | Live/Action
//
// v1: fixed widths, not resizable. Phase 7 candidate: drag handles for
// pane resize, save sizes to a tiny preferences file.

import 'package:flutter/material.dart';

import '../core/models/device.dart';
import '../core/models/message.dart';
import '../core/models/skill.dart';
import '../core/models/tool_activity.dart';
import '../core/state/conversation_store.dart';
import '../theme/motion.dart';
import '../theme/tokens.dart';
import '../widgets/action_preview_card.dart';
import '../widgets/action_step.dart';
import '../widgets/activity_card.dart';
import '../widgets/agent_status_pill.dart';
import '../widgets/command_bar.dart';
import '../widgets/connection_banner.dart';
import '../widgets/device_chip.dart';
import '../widgets/message_agent_prose.dart';
import '../widgets/message_human.dart';
import '../widgets/skill_list_item.dart';
import '../widgets/tool_chip.dart';

class HomeDesktop extends StatelessWidget {
  const HomeDesktop({super.key, required this.store});
  final ConversationStore store;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: store,
      builder: (context, _) {
        return Scaffold(
          backgroundColor: DexColors.bg,
          body: SafeArea(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // ===================== LEFT RAIL =====================
                _LeftRail(),
                const VerticalDivider(width: 1, color: DexColors.border),

                // ===================== CONVERSATION =====================
                Expanded(
                  flex: 3,
                  child: _ConversationColumn(store: store),
                ),
                const VerticalDivider(width: 1, color: DexColors.border),

                // ===================== LIVE / ACTION =====================
                SizedBox(
                  width: 360,
                  child: _LivePanel(store: store),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Left rail -- devices + skills
// ---------------------------------------------------------------------------
class _LeftRail extends StatelessWidget {
  // v1 hardcodes the local device + a single visible skill. The data shape
  // is already a list so Phase 7 can wire these to real gateway calls
  // without touching widgets.
  static const _device = Device(
    id: 'local',
    name: 'This PC',
    state: DeviceConnection.online,
    capabilities: <String>['desktop', 'files', 'web'],
  );
  static const _skills = <Skill>[
    Skill(
      name: 'windows-desktop-control',
      description: 'Click and type in real Windows apps via UFO².',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 220,
      child: Container(
        color: DexColors.bg,
        padding: const EdgeInsets.all(DexSpace.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Devices', style: DexType.caption(color: DexColors.textFaint)),
            const SizedBox(height: DexSpace.sm),
            const DeviceChip(device: _device),

            const SizedBox(height: DexSpace.xl),
            Text('Skills', style: DexType.caption(color: DexColors.textFaint)),
            const SizedBox(height: DexSpace.sm),
            ..._skills.map((s) => SkillListItem(skill: s)),

            const Spacer(),
            Text(
              'Dex · v1',
              style: DexType.caption(color: DexColors.textFaint),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Center -- conversation
// ---------------------------------------------------------------------------
class _ConversationColumn extends StatefulWidget {
  const _ConversationColumn({required this.store});
  final ConversationStore store;
  @override
  State<_ConversationColumn> createState() => _ConversationColumnState();
}

class _ConversationColumnState extends State<_ConversationColumn> {
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    widget.store.addListener(_autoscroll);
  }

  @override
  void dispose() {
    widget.store.removeListener(_autoscroll);
    _scroll.dispose();
    super.dispose();
  }

  void _autoscroll() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: DexMotion.respecting(context, DexMotion.fast),
        curve: DexMotion.respectingCurve(context, DexMotion.easeOut),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = widget.store.messages;
    return Stack(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            DexSpace.xxl, DexSpace.lg, DexSpace.xxl, 80, // bottom padding for command bar
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // header
              Row(
                children: [
                  Flexible(
                    child: Text(
                      'Conversation',
                      style: DexType.heading(color: DexColors.text),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: DexSpace.md),
                  AgentStatusPill(state: widget.store.state),
                ],
              ),
              const SizedBox(height: DexSpace.sm),
              ConnectionBanner(client: widget.store.client),
              const Divider(),
              Expanded(
                child: messages.isEmpty
                    ? const _EmptyState()
                    : ListView.builder(
                        controller: _scroll,
                        itemCount: messages.length,
                        itemBuilder: (_, i) => _renderMessage(messages[i]),
                      ),
              ),
            ],
          ),
        ),
        // floating command bar
        Positioned(
          left: DexSpace.xxl,
          right: DexSpace.xxl,
          bottom: DexSpace.lg,
          child: CommandBar(
            onSubmit: (t) => widget.store.sendHumanMessage(t),
            onStop: widget.store.stop,
            onClear: widget.store.clearMessages,
            isBusy: widget.store.isBusy,
          ),
        ),
      ],
    );
  }

  Widget _renderMessage(Message m) {
    switch (m.speaker) {
      case MessageSpeaker.human:
        return MessageHuman(message: m);
      case MessageSpeaker.agent:
        return MessageAgentProse(message: m);
      case MessageSpeaker.toolChip:
        return ToolChip(message: m);
      case MessageSpeaker.action:
        final steps = m.steps ?? const [];
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: DexSpace.sm),
          child: Container(
            decoration: BoxDecoration(
              color: DexColors.surface,
              borderRadius: DexRadius.rmd,
              border: Border.all(color: DexColors.border),
            ),
            padding: const EdgeInsets.all(DexSpace.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Action', style: DexType.label(color: DexColors.textDim)),
                const SizedBox(height: DexSpace.sm),
                ...steps.map((s) => ActionStepLine(step: s)),
              ],
            ),
          ),
        );
    }
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            'A calm cockpit for commanding agents.',
            style: DexType.heading(color: DexColors.textDim),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: DexSpace.sm),
          Text(
            'Type a command below. Dex will explain its plan before doing anything.',
            style: DexType.body(color: DexColors.textFaint),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Right panel -- live / Action Preview
// ---------------------------------------------------------------------------
class _LivePanel extends StatelessWidget {
  const _LivePanel({required this.store});
  final ConversationStore store;

  @override
  Widget build(BuildContext context) {
    final preview = store.pending;
    final activities = store.activities;
    final running = store.currentActivity;
    final completed = activities.where((a) => a.state != ToolActivityState.running).toList();
    return Container(
      color: DexColors.bg,
      padding: const EdgeInsets.all(DexSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Live', style: DexType.caption(color: DexColors.textFaint)),
          const SizedBox(height: DexSpace.sm),
          // Pending Action Preview keeps top priority (amber).
          if (preview != null) ...[
            ActionPreviewCard(
              preview: preview,
              onApprove: store.approve,
              onDeny: store.deny,
            ),
            const SizedBox(height: DexSpace.md),
          ],
          // Currently-running activity (or empty hint).
          if (running != null)
            ActivityCard(activity: running)
          else if (preview == null && activities.isEmpty)
            _CollapsedLive(state: store.state),
          // Last few completed activities collapsed to one-liners.
          if (completed.isNotEmpty) ...[
            Padding(
              padding: const EdgeInsets.symmetric(vertical: DexSpace.sm),
              child: Text(
                'Recent',
                style: DexType.caption(color: DexColors.textFaint),
              ),
            ),
            Expanded(
              child: ListView(
                children: completed
                    .take(15)
                    .map((a) => ActivityCard(activity: a, compact: true))
                    .toList(growable: false),
              ),
            ),
          ] else
            const Spacer(),
        ],
      ),
    );
  }
}

class _CollapsedLive extends StatelessWidget {
  const _CollapsedLive({required this.state});
  // We don't render state-specific copy in v1, but keep the param so the
  // widget can grow without a signature change.
  // ignore: unused_field
  final Object state;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DexSpace.lg),
      decoration: BoxDecoration(
        color: DexColors.surface,
        borderRadius: DexRadius.rmd,
        border: Border.all(color: DexColors.border),
      ),
      child: Center(
        child: Text(
          'No pending action.',
          style: DexType.body(color: DexColors.textDim),
        ),
      ),
    );
  }
}
