// Top bar of the active chat view. Centered title (current conversation
// name), Invite/Share button on the right, agent status pill alongside.

import 'package:flutter/material.dart';
import 'package:flutter_lucide/flutter_lucide.dart';

import '../../core/models/agent_state.dart';
import '../../theme/tokens.dart';
import '../agent_status_pill.dart';

class ChatHeader extends StatelessWidget {
  const ChatHeader({
    super.key,
    required this.title,
    required this.state,
    this.onInvite,
  });

  final String title;
  final AgentState state;
  final VoidCallback? onInvite;

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
          if (onInvite != null)
            OutlinedButton.icon(
              onPressed: onInvite,
              icon: const Icon(LucideIcons.user_plus, size: 14),
              label: Text('Invite',
                  style: DexType.label(color: DexColors.text)),
              style: OutlinedButton.styleFrom(
                foregroundColor: DexColors.text,
                side: const BorderSide(color: DexColors.border),
                padding: const EdgeInsets.symmetric(
                  horizontal: DexSpace.md, vertical: DexSpace.sm,
                ),
                shape: const RoundedRectangleBorder(
                  borderRadius: DexRadius.rsm,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
