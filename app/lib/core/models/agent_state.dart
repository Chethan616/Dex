// Agent state -- the persistent "what is Dex doing right now?" answer.
// Drives the status pill, the active glyph on action steps, and any UI
// that needs to render the agent's overall mode.

import '../../theme/tokens.dart';

enum AgentState { idle, thinking, acting, awaiting, error }

extension AgentStateX on AgentState {
  DexAgentStateToken get token => switch (this) {
        AgentState.idle => DexAgentStateToken.idle,
        AgentState.thinking => DexAgentStateToken.thinking,
        AgentState.acting => DexAgentStateToken.acting,
        AgentState.awaiting => DexAgentStateToken.awaiting,
        AgentState.error => DexAgentStateToken.error,
      };

  String get word => DexStateGlyph.word(token);
  String get glyph => DexStateGlyph.glyph(token);
}
