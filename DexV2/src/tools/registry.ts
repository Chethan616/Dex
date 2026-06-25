import { ToolDef } from '../llm/types.js';

const LOCALLY_AVAILABLE_TOOLS = new Set([
  'exec',
  'clipboard',
  'notify',
  'search',
  'schedule',
  'voice',
  'desktop',
  'browser',
  'http',
  'git',
  'sql',
  'jq',
  'code',
]);

const TOOL_REGISTRY: Record<string, ToolDef> = {
  // A. OS & Core System Tools
  exec: {
    name: 'exec',
    description: 'Execute PowerShell / command-line statements with full Admin privileges. Use for creating/saving files, launching apps, opening cmd windows, and scripts that need user input.',
    inputSchema: {
      type: 'object',
      properties: {
        c: { type: 'string', description: 'The PowerShell command to run.' }
      },
      required: ['c']
    }
  },
  clipboard: {
    name: 'clipboard',
    description: 'Read from or write to the Windows clipboard.',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['read', 'write'], description: 'Read clipboard contents or write to it.' },
        text: { type: 'string', description: 'The text to write (required if op is write).' }
      },
      required: ['op']
    }
  },
  notify: {
    name: 'notify',
    description: 'Send native Windows Toast notifications and trigger sounds.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The body text of the notification.' },
        sound: { type: 'boolean', description: 'Whether to trigger a sound beep.' }
      },
      required: ['text']
    }
  },
  search: {
    name: 'search',
    description: 'Fast recursive file searching in directories.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'File name pattern or content keyword.' },
        path: { type: 'string', description: 'Target folder path to search within.' }
      },
      required: ['query']
    }
  },
  schedule: {
    name: 'schedule',
    description: 'Manage Windows Task Scheduler jobs.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'delete', 'list'] },
        name: { type: 'string', description: 'Name of the task scheduler job.' },
        cmd: { type: 'string', description: 'Command to run (if creating).' },
        trigger: { type: 'string', description: 'Trigger expression (e.g. daily, hourly).' }
      },
      required: ['action', 'name']
    }
  },
  voice: {
    name: 'voice',
    description: 'Speak text output out loud using Windows SAPI TTS.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to speak.' }
      },
      required: ['text']
    }
  },

  // B. Core Automation Tools
  desktop: {
    name: 'desktop',
    description: 'Drive Windows GUI desktop apps via UFO automation.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'What to perform on the desktop.' },
        app: { type: 'string', description: 'Name/path of the target app.' }
      },
      required: ['goal']
    }
  },
  browser: {
    name: 'browser',
    description: 'Automate web browsing sessions via Playwright.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'Web browsing goal.' }
      },
      required: ['goal']
    }
  },
  vision: {
    name: 'vision',
    description: 'Analyze screen captures and layout elements.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'Visual question or action target description.' }
      },
      required: ['goal']
    }
  },
  http: {
    name: 'http',
    description: 'Execute raw REST API HTTP requests.',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
        url: { type: 'string', description: 'Target API endpoint URL.' },
        headers: { type: 'string', description: 'JSON string of headers.' },
        body: { type: 'string', description: 'Request payload string.' }
      },
      required: ['method', 'url']
    }
  },

  // C. Developer & Data Tools
  git: {
    name: 'git',
    description: 'Perform structured Git version control operations.',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['status', 'commit', 'push', 'pull', 'log'] },
        msg: { type: 'string', description: 'Commit message.' }
      },
      required: ['op']
    }
  },
  sql: {
    name: 'sql',
    description: 'Query SQLite, PostgreSQL, or MySQL databases.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL statement.' },
        dbPath: { type: 'string', description: 'Database path or connection string.' }
      },
      required: ['query', 'dbPath']
    }
  },
  jq: {
    name: 'jq',
    description: 'Filter and parse JSON structures.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'jq query filter.' },
        filePath: { type: 'string', description: 'Target JSON file path.' }
      },
      required: ['query', 'filePath']
    }
  },
  code: {
    name: 'code',
    description: 'Execute short, non-interactive sandboxed Python or Node.js logic. Do not use for saved scripts, GUI apps, Notepad, cmd windows, or code that asks the user for input.',
    inputSchema: {
      type: 'object',
      properties: {
        lang: { type: 'string', enum: ['python', 'node'] },
        code: { type: 'string', description: 'Code block.' }
      },
      required: ['lang', 'code']
    }
  },

  // D. Google Workspace Integrations
  gmail: {
    name: 'gmail',
    description: 'Interact with Google Gmail (read, send, search).',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['read', 'send', 'search', 'draft'] },
        q: { type: 'string', description: 'Gmail search query.' },
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        id: { type: 'string', description: 'Message ID.' }
      },
      required: ['op']
    }
  },
  gcal: {
    name: 'gcal',
    description: 'Interact with Google Calendar (list, create, check availability).',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['list', 'create', 'check'] },
        q: { type: 'string', description: 'Query string.' },
        start: { type: 'string', description: 'Start time ISO string.' },
        end: { type: 'string', description: 'End time ISO string.' },
        title: { type: 'string', description: 'Event title.' }
      },
      required: ['op']
    }
  },
  gdrive: {
    name: 'gdrive',
    description: 'Interact with Google Drive (search, upload, download).',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['search', 'upload', 'download', 'share'] },
        name: { type: 'string', description: 'File name.' },
        id: { type: 'string', description: 'File ID.' },
        dest: { type: 'string', description: 'Destination folder.' }
      },
      required: ['op']
    }
  },
  gdocs: {
    name: 'gdocs',
    description: 'Interact with Google Docs (read, append, create).',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['read', 'append', 'create'] },
        id: { type: 'string', description: 'Document ID.' },
        text: { type: 'string', description: 'Text to append/write.' },
        title: { type: 'string', description: 'Document title.' }
      },
      required: ['op']
    }
  },
  gsheets: {
    name: 'gsheets',
    description: 'Interact with Google Sheets (read, update, append).',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['read', 'update', 'append'] },
        id: { type: 'string', description: 'Spreadsheet ID.' },
        range: { type: 'string', description: 'Range reference (e.g. Sheet1!A1:B10).' },
        values: { type: 'string', description: 'JSON string of values array.' }
      },
      required: ['op']
    }
  },

  // E. Team Communication Integrations
  slack: {
    name: 'slack',
    description: 'Send or read messages from Slack channels.',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['send', 'read', 'list_channels'] },
        channel: { type: 'string', description: 'Channel name or ID.' },
        text: { type: 'string', description: 'Message body.' }
      },
      required: ['op', 'channel']
    }
  },
  teams: {
    name: 'teams',
    description: 'Interact with MS Teams chats and channels.',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['send', 'read'] },
        channel: { type: 'string', description: 'Channel/User target.' },
        text: { type: 'string', description: 'Message body.' }
      },
      required: ['op', 'channel']
    }
  },
  discord: {
    name: 'discord',
    description: 'Interact with Discord channel logs and inputs.',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['send', 'read'] },
        channel: { type: 'string', description: 'Channel name or ID.' },
        text: { type: 'string', description: 'Message body.' }
      },
      required: ['op', 'channel']
    }
  },
  whatsapp: {
    name: 'whatsapp',
    description: 'Send or read WhatsApp messages via baileys connection.',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['send', 'read'] },
        to: { type: 'string', description: 'Recipient phone number.' },
        text: { type: 'string', description: 'Message body.' }
      },
      required: ['op', 'to']
    }
  },
  telegram: {
    name: 'telegram',
    description: 'Send or read Telegram messages via grammy bot.',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['send', 'read'] },
        to: { type: 'string', description: 'Recipient chat ID.' },
        text: { type: 'string', description: 'Message body.' }
      },
      required: ['op', 'to']
    }
  },

  // F. Personal Productivity
  notion: {
    name: 'notion',
    description: 'Interact with Notion workspaces (read, append, query).',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['append', 'read', 'query'] },
        pageId: { type: 'string', description: 'Target page/database ID.' },
        text: { type: 'string', description: 'Blocks content text.' }
      },
      required: ['op', 'pageId']
    }
  },
  todoist: {
    name: 'todoist',
    description: 'Manage tasks on Todoist lists.',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['add', 'complete', 'list'] },
        text: { type: 'string', description: 'Task content.' },
        id: { type: 'string', description: 'Task ID (if completing).' }
      },
      required: ['op']
    }
  },
  spotify: {
    name: 'spotify',
    description: 'Control Spotify playback (play, pause, next, volume).',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['play', 'pause', 'next', 'search', 'volume'] },
        q: { type: 'string', description: 'Song/artist query string.' },
        volume: { type: 'string', description: 'Target volume level.' }
      },
      required: ['op']
    }
  }
};

export function isToolAvailable(name: string): boolean {
  return LOCALLY_AVAILABLE_TOOLS.has(name);
}

export function resolveToolDefs(names: string[]): ToolDef[] {
  return names
    .filter(isToolAvailable)
    .map(name => TOOL_REGISTRY[name])
    .filter((t): t is ToolDef => !!t);
}
