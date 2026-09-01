// The Action Preview -- the soul of the Dex UI. A pending desktop task the
// agent has explained but not yet executed. The Flutter app renders it in
// the right panel with an amber border and two large buttons.
//
// v1 wiring: created when the agent's chat-layer message includes an explicit
// plan + "Approve?" prompt. The Flutter app parses these out of the streamed
// reply (see PreviewExtractor in core/state). Phase 7 upgrades this to a
// strict MCP-side gate.

import 'action_step.dart';

class ActionPreview {
  /// Stable id; ties the preview to the agent's pending tool call so an
  /// Approve response can be delivered through the right channel back to
  /// the Dex brain.
  final String id;

  /// One-line title rendered above the steps. E.g. "Calculator -- compute 12 x 9".
  final String title;

  /// Optional app hint for the chip on the card.
  final String? appHint;

  /// The planned step list, mono, in order.
  final List<ActionStep> steps;

  /// When the agent posted this preview (so it can age out if the user
  /// ignores it for too long).
  final DateTime ts;

  /// True if this preview represents a gateway approval request that must
  /// be resolved via Gateway RPC rather than chat inject injection.
  final bool isApprovalRequest;

  const ActionPreview({
    required this.id,
    required this.title,
    required this.steps,
    required this.ts,
    this.appHint,
    this.isApprovalRequest = false,
  });
}
