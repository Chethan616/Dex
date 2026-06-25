export const ALL_TOOLS = [
  'exec', 'desktop', 'browser', 'msg', 'clipboard', 'notify', 'search',
  'schedule', 'voice', 'code', 'vision', 'http', 'git', 'sql', 'jq',
  'gmail', 'gcal', 'gdrive', 'gdocs', 'gsheets', 'slack', 'teams',
  'discord', 'whatsapp', 'telegram', 'notion', 'todoist', 'spotify'
] as const;

function buildToolEnum(toolNames: readonly string[]): string[] {
  const filtered = Array.from(new Set(toolNames.filter(Boolean)));
  return filtered.length > 0 ? filtered : ['exec'];
}

export function buildTier1ActionSchema(toolNames: readonly string[]) {
  const allowedTools = buildToolEnum(toolNames);
  return {
    type: 'object',
    properties: {
      t: { type: 'string', enum: allowedTools },
      a: { type: 'object', additionalProperties: { type: 'string' } },
      fb: { type: 'string', enum: allowedTools },
    },
    required: ['t', 'a'],
    additionalProperties: false,
  } as const;
}

export function buildTier2PlanSchema(toolNames: readonly string[]) {
  const allowedTools = buildToolEnum(toolNames);
  return {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            t: { type: 'string', enum: allowedTools },
            a: { type: 'object', additionalProperties: { type: 'string' } },
            why: { type: 'string', maxLength: 50 },
            fb: { type: 'string', enum: allowedTools },
          },
          required: ['t', 'a'],
          additionalProperties: false,
        },
      },
    },
    required: ['steps'],
    additionalProperties: false,
  } as const;
}

export const TIER1_ACTION_SCHEMA = buildTier1ActionSchema(ALL_TOOLS);

export const TIER2_PLAN_SCHEMA = buildTier2PlanSchema(ALL_TOOLS);
