/**
 * A model id as a person would say it, for the composer's engine chip:
 * "claude-haiku-4-5-20251001" → "Haiku 4.5", "openai/gpt-5.1-codex" →
 * "GPT-5.1 Codex". Anything else passes through without its date stamp.
 */
const cap = (word: string) => (word ? word[0].toUpperCase() + word.slice(1) : word);

export function friendlyModel(id: string | undefined | null): string | null {
  if (!id) return null;
  const base = (id.includes('/') ? id.split('/').pop() ?? id : id).trim();
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(base);
  if (claude) return `${cap(claude[1].toLowerCase())} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`;
  const claudeOld = /^claude-(\d+)(?:-(\d))?-([a-z]+)(?:-\d{8})?$/i.exec(base);
  if (claudeOld) return `${cap(claudeOld[3].toLowerCase())} ${claudeOld[1]}${claudeOld[2] ? `.${claudeOld[2]}` : ''}`;
  const gpt = /^gpt-([\d.]+[a-z]?)(?:-(.+))?$/i.exec(base);
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].split('-').map(cap).join(' ')}` : ''}`;
  return base.replace(/-\d{8}$/, '');
}
