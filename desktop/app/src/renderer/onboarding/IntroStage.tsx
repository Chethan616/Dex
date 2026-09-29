/**
 * The intro's picture: your DEX in the middle of the kind of work it does,
 * each task with its own little bot — the way the task list shows them.
 * Drawn live (bot-avatars + CSS) rather than a painting, so it follows the
 * theme, and the bot in the middle is the one picked on the next step.
 */
import React from 'react';
import { AgentAvatar, DexAvatar, useDexProfile, type AgentAvatarProps } from '../components/lib';

type Bot = NonNullable<AgentAvatarProps['type']>;

// `spare` stands in when your own DEX is already that bot.
const TASKS: Array<{ bot: Bot; spare: Bot; title: string; where: string }> = [
  { bot: 'cat', spare: 'star', title: 'Answered 3 emails', where: 'Gmail' },
  { bot: 'cloud', spare: 'drop', title: 'Booked a call at 4 pm', where: 'Calendar · Meet' },
  { bot: 'mech', spare: 'hexagon', title: 'Made a mushroom house', where: 'Blender · 3D' },
  { bot: 'ghost', spare: 'pebble', title: 'Sent the PDF to Mom', where: 'WhatsApp · from your phone' },
];

export function IntroStage(): React.ReactElement {
  const [profile] = useDexProfile();
  const style = { '--stage-glow': profile.color ?? '#6d8196' } as React.CSSProperties;
  return (
    <div className="intro-stage" style={style} aria-hidden="true">
      <div className="intro-stage__dots" />
      <svg className="intro-stage__orbit" viewBox="0 0 380 380">
        <circle cx="190" cy="190" r="104" />
        <circle cx="190" cy="190" r="158" />
      </svg>
      <div className="intro-stage__hero">
        <DexAvatar size={120} interactive />
      </div>
      {TASKS.map((t, i) => (
        <div key={t.title} className={`intro-task intro-task--${i}`} style={{ '--i': i } as React.CSSProperties}>
          <AgentAvatar type={t.bot === profile.bot ? t.spare : t.bot} size={28} interactive={false} />
          <span className="intro-task__text">
            <span className="intro-task__title">{t.title}</span>
            <span className="intro-task__where">{t.where}</span>
          </span>
          <span className="intro-task__done">
            <svg viewBox="0 0 16 16" width="10" height="10">
              <path d="M3.5 8.4l2.7 2.7L12.5 5" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      ))}
    </div>
  );
}
