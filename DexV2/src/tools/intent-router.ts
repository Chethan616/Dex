import { TaskIntent } from '../brain/types.js';
import { ToolDef } from '../llm/types.js';
import { resolveToolDefs } from './registry.js';
import { getEmbedding, cosineSimilarity } from '../brain/intent-embedder.js';

export const TOOL_CLUSTERS: Record<string, string[]> = {
  // OS & Core
  "file-ops":       ["exec", "search", "clipboard"],
  "system-config":  ["exec", "schedule"],
  "visual/screen":  ["vision", "desktop"],
  "calculation":    ["code", "exec"],
  
  // Comms
  "messaging-wa":   ["whatsapp", "exec"],
  "messaging-tg":   ["telegram", "exec"],
  "messaging-slack":["slack", "exec"],
  "messaging-teams":["teams", "exec"],
  "messaging-discord":["discord", "exec"],
  
  // Workspace
  "email":          ["gmail", "exec"],
  "calendar":       ["gcal", "exec"],
  "docs":           ["gdocs", "gdrive", "exec"],
  "sheets":         ["gsheets", "gdrive", "exec"],
  
  // Dev
  "vcs/git":        ["git", "exec"],
  "api/web":        ["http", "browser", "jq"],
  "database":       ["sql", "exec"],

  // Productivity
  "productivity-notion": ["notion", "exec"],
  "productivity-todoist": ["todoist", "exec"],
  "productivity-spotify": ["spotify", "exec"],
  
  // Fallbacks
  "gui-automation": ["desktop", "vision", "exec"],
  "web-browsing":   ["browser", "vision", "exec"],
};

export const CENTROIDS: Record<string, string[]> = {
  "file-ops": [
    "find a file named invoice.pdf",
    "search for folder documents",
    "copy this text to my clipboard",
    "search files"
  ],
  "system-config": [
    "schedule a task to run tomorrow",
    "set a cron job",
    "create a scheduled event"
  ],
  "visual/screen": [
    "analyze the screen layout",
    "what do you see on my screen",
    "take a screenshot and look at it"
  ],
  "calculation": [
    "run some python code to calculate the average",
    "compute the sum of these numbers",
    "run a python script"
  ],
  "messaging-wa": [
    "send a message on whatsapp",
    "text mom on whatsapp",
    "read my whatsapp messages"
  ],
  "messaging-tg": [
    "message on telegram",
    "send a telegram to John"
  ],
  "messaging-slack": [
    "post to slack channel general",
    "message on slack"
  ],
  "messaging-teams": [
    "send a teams message",
    "contact HR on teams"
  ],
  "messaging-discord": [
    "post a message to discord server",
    "message in discord"
  ],
  "email": [
    "send an email to my boss",
    "check my gmail inbox",
    "write an email"
  ],
  "calendar": [
    "add a meeting to my calendar",
    "schedule an appointment",
    "check calendar availability"
  ],
  "docs": [
    "create a google document",
    "append text to google docs",
    "read my doc file"
  ],
  "sheets": [
    "update the google sheet",
    "read spreadsheet cells",
    "append row to excel sheet"
  ],
  "vcs/git": [
    "git commit changes",
    "push branch to origin",
    "git status check"
  ],
  "api/web": [
    "fetch json from REST API",
    "send HTTP post request",
    "scrape a website via api"
  ],
  "database": [
    "run a select query on sqlite",
    "query postgres database",
    "check sql table schema"
  ],
  "productivity-notion": [
    "create a page in notion",
    "append text blocks to notion"
  ],
  "productivity-todoist": [
    "add a task to my todoist",
    "complete the task in todoist"
  ],
  "productivity-spotify": [
    "play some music on spotify",
    "pause spotify player",
    "skip to next song",
    "what is playing right now",
    "tell me what is playing"
  ],
  "gui-automation": [
    "open notepad and click file",
    "start application and press keys",
    "automate windows desktop UI"
  ],
  "web-browsing": [
    "open website and search",
    "browse the web",
    "navigate to login page on the web browser"
  ]
};

let centroidEmbeddings: Record<string, Float32Array[]> | null = null;

async function getCentroidEmbeddings(): Promise<Record<string, Float32Array[]>> {
  if (!centroidEmbeddings) {
    centroidEmbeddings = {};
    for (const [cluster, texts] of Object.entries(CENTROIDS)) {
      centroidEmbeddings[cluster] = await Promise.all(
        texts.map(text => getEmbedding(text))
      );
    }
  }
  return centroidEmbeddings;
}

export function classifyClusterByRules(normalized: string): string | null {
  const norm = normalized.toLowerCase();
  
  if (/\bwhatsapp|wa\b/.test(norm)) return 'messaging-wa';
  if (/\btelegram|tg\b/.test(norm)) return 'messaging-tg';
  if (/\bslack\b/.test(norm)) return 'messaging-slack';
  if (/\bteams\b/.test(norm)) return 'messaging-teams';
  if (/\bdiscord\b/.test(norm)) return 'messaging-discord';
  
  if (/\bnotion\b/.test(norm)) return 'productivity-notion';
  if (/\btodoist\b/.test(norm)) return 'productivity-todoist';
  if (/\bspotify|play music|song|playing|track|music\b/.test(norm)) return 'productivity-spotify';
  
  if (/\bgmail|email|mail|inbox\b/.test(norm)) return 'email';
  if (/\bcalendar|gcal|meeting|appointment\b/.test(norm)) return 'calendar';
  if (/\bgdoc|gdocs|google doc|google document\b/.test(norm)) return 'docs';
  if (/\bgsheet|gsheets|spreadsheet|google sheet|excel\b/.test(norm)) return 'sheets';
  
  if (/\bgit\b|\bgithub\b|\bcommit\b|\bpush\b|\bpull\b|\bclone\b/.test(norm)) return 'vcs/git';
  if (/\bsql\b|\bpostgres\b|\bmysql\b|\bsqlite\b|\bdatabase\b|\bquery\b/.test(norm)) return 'database';
  
  if (/\bcalculate\b|\bmath\b|\beval\b|\brun python\b|\brun node\b/.test(norm)) return 'calculation';
  if (/\btask scheduler\b|\bcron\b|\bschedule task\b/.test(norm)) return 'system-config';
  if (/\bsearch file\b|\bfind file\b|\bclipboard\b|\bcopy to\b/.test(norm)) return 'file-ops';
  if (/\bscreenshot\b|\bscreen capture\b|\blook at screen\b/.test(norm)) return 'visual/screen';
  
  if (/\bbrowser\b|\bchrome\b|\bfirefox\b|\bedge\b|\bwebsite\b|\bweb page\b|\bsearch the web\b/.test(norm)) return 'web-browsing';
  if (/\bclick\b|\btype\b|\bopen app\b|\bdesktop\b/.test(norm)) return 'gui-automation';

  return null;
}

export async function classifyCluster(normalized: string): Promise<string> {
  const ruleMatch = classifyClusterByRules(normalized);
  if (ruleMatch) {
    return ruleMatch;
  }
  
  try {
    const queryEmb = await getEmbedding(normalized);
    const centroids = await getCentroidEmbeddings();
    
    let bestCluster = 'gui-automation';
    let maxSim = -1;
    
    for (const [cluster, embs] of Object.entries(centroids)) {
      for (const emb of embs) {
        const sim = cosineSimilarity(queryEmb, emb);
        if (sim > maxSim) {
          maxSim = sim;
          bestCluster = cluster;
        }
      }
    }
    
    return bestCluster;
  } catch (err) {
    return 'gui-automation';
  }
}

export async function getRelevantTools(intent: TaskIntent): Promise<ToolDef[]> {
  const query = intent.normalized || intent.raw;
  const cluster = await classifyCluster(query);
  
  const toolNames = [...(TOOL_CLUSTERS[cluster] || ["exec", "desktop", "browser"])];
  
  const rawLower = intent.raw.toLowerCase();
  if (rawLower.includes("notify") || rawLower.includes("tell me") || rawLower.includes("toast")) {
    if (!toolNames.includes("notify")) {
      toolNames.push("notify");
    }
  }
  if (rawLower.includes("speak") || rawLower.includes("say") || rawLower.includes("voice")) {
    if (!toolNames.includes("voice")) {
      toolNames.push("voice");
    }
  }
  
  const uniqueNames = Array.from(new Set(toolNames));
  return resolveToolDefs(uniqueNames).slice(0, 5);
}
