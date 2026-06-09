// The active-conversation surface. ChatHeader on top, scrolling message list
// in the middle, docked DexComposer at the bottom.

import 'package:flutter/material.dart';

import '../../core/models/agent_state.dart';
import '../../core/models/message.dart';
import '../../core/state/conversation_store.dart';
import '../../theme/motion.dart';
import '../../theme/tokens.dart';
import '../action_step.dart';
import '../composer/add_menu.dart';
import '../composer/dex_composer.dart';
import '../connection_banner.dart';
import '../message_agent_prose.dart';
import '../message_human.dart';
import '../tool_chip.dart';
import 'chat_header.dart';
import 'day_separator.dart';

class ChatView extends StatefulWidget {
  const ChatView({
    super.key,
    required this.store,
    required this.title,
    this.onInvite,
    this.onVision,
    this.onVoice,
    this.onAddAction,
  });

  final ConversationStore store;
  final String title;
  final VoidCallback? onInvite;
  final VoidCallback? onVision;
  final VoidCallback? onVoice;
  final ValueChanged<ComposerAddAction>? onAddAction;

  @override
  State<ChatView> createState() => _ChatViewState();
}

class _ChatViewState extends State<ChatView> {
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ChatHeader(
          title: widget.title,
          state: widget.store.state,
          onInvite: widget.onInvite,
        ),
        ConnectionBanner(client: widget.store.client),
        const Divider(height: 1, color: DexColors.border),
        Expanded(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 880),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: DexSpace.lg),
                child: ListView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.only(
                    top: DexSpace.md, bottom: DexSpace.md,
                  ),
                  itemCount: messages.length + 1,
                  itemBuilder: (_, i) {
                    if (i == 0) return const DaySeparator(label: 'Today');
                    return _renderMessage(messages[i - 1]);
                  },
                ),
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(
            DexSpace.lg, 0, DexSpace.lg, DexSpace.lg,
          ),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 880),
              child: DexComposer(
                onSubmit: widget.store.sendHumanMessage,
                isBusy: widget.store.isBusy,
                onStop: widget.store.stop,
                onVision: widget.onVision,
                onVoice: widget.onVoice,
                onAddAction: widget.onAddAction,
              ),
            ),
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
