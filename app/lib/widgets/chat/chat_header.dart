// Top bar of the active chat view. Centered title (current conversation
// name) and the agent status pill.
//
// There was an Invite button here. It invited nobody — Dex has a single owner
// by design, and there is no second party for it to reach. A control that
// cannot do anything is worse than a missing one: it is a promise.

import 'package:flutter/material.dart';

import '../../core/models/agent_state.dart';
import '../../theme/tokens.dart';
import '../agent_status_pill.dart';

class ChatHeader extends StatelessWidget {
  const ChatHeader({
    super.key,
    required this.title,
    required this.state,
  });

  final String title;
  final AgentState state;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DexSpace.lg, DexSpace.md, DexSpace.lg, DexSpace.md,
      ),
      child: Row(
        children: [
          const SizedBox(width: 80),
          Expanded(
            child: Center(
              child: Text(
                title,
                style: DexType.label(color: DexColors.text),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
          AgentStatusPill(state: state),
          const SizedBox(width: DexSpace.sm),
        ],
      ),
    );
  }
}
