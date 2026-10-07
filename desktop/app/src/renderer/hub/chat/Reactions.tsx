/**
 * DEX's reaction on your message (shared/reactions.ts): a small emoji
 * tucked onto the bubble's corner, the way Grok and WhatsApp show one
 * (UI/g1.png). You don't react — DEX does, sparingly: 👍 to "ok go on" after
 * it asked you something, ❤️ to a thank-you.
 */
import React, { memo } from 'react';
import { agentEmojis, type Reaction } from '../../../shared/reactions';

export const ReactionBadge = memo(function ReactionBadge({ reactions }: { reactions: Reaction[] | undefined }): React.ReactElement | null {
  const emojis = agentEmojis(reactions);
  if (emojis.length === 0) return null;
  return (
    <span className="cx-react-badge" role="img" aria-label={`DEX reacted ${emojis.join(' ')}`} title="DEX reacted">
      {emojis.map((e) => <span key={e} className="cx-react-badge__emoji">{e}</span>)}
    </span>
  );
});
