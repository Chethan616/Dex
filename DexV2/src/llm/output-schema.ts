export const ALL_TOOLS = [
  'exec', 'desktop', 'browser', 'msg', 'clipboard', 'notify', 'search',
  'schedule', 'voice', 'code', 'vision', 'http', 'git', 'sql', 'jq',
  'gmail', 'gcal', 'gdrive', 'gdocs', 'gsheets', 'slack', 'teams',
  'discord', 'whatsapp', 'telegram', 'notion', 'todoist', 'spotify'
] as const;

export const TIER1_ACTION_SCHEMA = {
  type: 'object',
  properties: {
    t: { type: 'string', enum: ALL_TOOLS },
    a: { type: 'object', additionalProperties: { type: 'string' } },
    fb: { type: 'string', enum: ALL_TOOLS },
  },
  required: ['t', 'a'],
  additionalProperties: false,
} as const;

export const TIER2_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          t: { type: 'string', enum: ALL_TOOLS },
          a: { type: 'object', additionalProperties: { type: 'string' } },
          why: { type: 'string', maxLength: 50 },
          fb: { type: 'string', enum: ALL_TOOLS },
        },
        required: ['t', 'a'],
        additionalProperties: false,
      },
    },
  },
  required: ['steps'],
  additionalProperties: false,
} as const;
