/**
 * A task's own bot, wearing the task's live mood (botMood.ts) — for lists and
 * headers, where a hook can't sit inside a `map`.
 */
import React from 'react';
import { AgentAvatar, type AgentAvatarProps } from './AgentAvatar';
import { useBotMood, type MoodSource } from './botMood';

export interface TaskAvatarProps extends Omit<AgentAvatarProps, 'mood' | 'status' | 'sessionId' | 'engineId'> {
  session: MoodSource & { id: string; engine?: string | null };
}

export const TaskAvatar = React.forwardRef<HTMLCanvasElement, TaskAvatarProps>(function TaskAvatar({ session, ...rest }, ref) {
  const mood = useBotMood(session);
  return <AgentAvatar ref={ref} {...rest} sessionId={session.id} engineId={session.engine} status={session.status} mood={mood} />;
});
