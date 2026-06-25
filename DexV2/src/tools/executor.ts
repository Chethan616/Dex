import { spawn, exec, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { getDexDir } from '../utils/platform.js';
import { logger } from '../utils/logger.js';

const MODULE = 'TOOL_EXECUTOR';

function getPythonPath(): string {
  // Try to use vendored python venv path
  const venvPy = path.resolve(process.cwd(), '..', 'vendor', 'browser-use', '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venvPy)) {
    return venvPy;
  }
  return 'python'; // Fallback to system Python
}

function runPowerShell(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    exec(cmd, { shell: 'powershell.exe' }, (error, stdout, stderr) => {
      if (error) {
        resolve((stdout + '\n' + stderr).trim());
      } else {
        resolve((stdout || stderr).trim());
      }
    });
  });
}

function walkDir(dir: string, results: string[]) {
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    try {
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== 'build') {
          walkDir(fullPath, results);
        }
      } else {
        results.push(fullPath);
      }
    } catch (e) {
      // Ignore reading errors for blocked system paths
    }
  }
}

export function searchFiles(query: string, searchPath: string): string[] {
  const files: string[] = [];
  try {
    walkDir(searchPath, files);
    const lowerQuery = query.toLowerCase();
    return files.filter(f => path.basename(f).toLowerCase().includes(lowerQuery));
  } catch (err) {
    return [];
  }
}

function executeSandbox(lang: 'python' | 'node', code: string): string {
  const tempDir = getDexDir();
  const ext = lang === 'python' ? '.py' : '.js';
  const tempFile = path.join(tempDir, `sandbox_${Date.now()}${ext}`);
  fs.writeFileSync(tempFile, code, 'utf-8');
  try {
    const cmd = lang === 'python' ? `python "${tempFile}"` : `node "${tempFile}"`;
    const stdout = execSync(cmd, { timeout: 30000 }).toString();
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    return stdout.trim();
  } catch (e: any) {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    return (e.stdout?.toString() || e.message || '').trim();
  }
}

function executeSql(query: string, dbPath: string): Promise<string> {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return resolve(`Database error: ${err.message}`);
    });
    db.all(query, [], (err, rows) => {
      db.close();
      if (err) {
        resolve(`Query failed: ${err.message}`);
      } else {
        resolve(JSON.stringify(rows, null, 2));
      }
    });
  });
}

function executeJq(query: string, filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    if (query === '.') return JSON.stringify(data, null, 2);
    
    const cleanQuery = query.replace(/^\./, 'data.');
    const fn = new Function('data', `try { return ${cleanQuery}; } catch(e) { return "Query error: " + e.message; }`);
    const result = fn(data);
    return typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
  } catch (e: any) {
    return `jq error: ${e.message}`;
  }
}

async function executeHttp(args: { method: string; url: string; headers?: string; body?: string }): Promise<string> {
  try {
    const headers = args.headers ? JSON.parse(args.headers) : {};
    const response = await fetch(args.url, {
      method: args.method,
      headers,
      body: args.body
    });
    const text = await response.text();
    return `HTTP ${response.status}\n${text}`;
  } catch (e: any) {
    return `HTTP Request failed: ${e.message}`;
  }
}

function callMcpTool(driverPath: string, toolName: string, args: any): Promise<string> {
  return new Promise((resolve) => {
    const python = getPythonPath();
    const serverProcess = spawn(python, [driverPath], {
      cwd: path.dirname(driverPath),
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1'
      }
    });

    let stdoutBuffer = '';
    let responseResolver: ((data: any) => void) | null = null;
    let requestId = 0;

    serverProcess.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const packet = JSON.parse(trimmed);
          if (packet.id === requestId && responseResolver) {
            responseResolver(packet);
          }
        } catch (e) {
          // Non-JSON outputs ignored
        }
      }
    });

    const sendRpc = (method: string, params: any, isNotification = false) => {
      const packet: any = {
        jsonrpc: '2.0',
        method,
        params
      };
      if (!isNotification) {
        requestId++;
        packet.id = requestId;
      }
      serverProcess.stdin.write(JSON.stringify(packet) + '\n');
    };

    const run = async () => {
      try {
        // Step 1: Handshake - initialize
        const initPromise = new Promise<any>((res) => { responseResolver = res; });
        sendRpc('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'dex-gateway', version: '2.0.0' }
        });
        await initPromise;

        // Step 2: Handshake - initialized
        sendRpc('notifications/initialized', {}, true);

        // Step 3: Call tool
        const callPromise = new Promise<any>((res) => { responseResolver = res; });
        sendRpc('tools/call', {
          name: toolName,
          arguments: args
        });
        const response = await callPromise;

        serverProcess.kill();

        if (response.error) {
          resolve(JSON.stringify({ ok: false, error: response.error.message }));
        } else if (response.result && response.result.content) {
          const textContent = response.result.content.find((c: any) => c.type === 'text');
          resolve(textContent ? textContent.text : JSON.stringify(response.result));
        } else {
          resolve(JSON.stringify(response.result || {}));
        }
      } catch (err: any) {
        serverProcess.kill();
        resolve(JSON.stringify({ ok: false, error: err.message }));
      }
    };

    run();
  });
}

export async function executeTool(name: string, args: any): Promise<string> {
  logger.info(MODULE, `Executing tool "${name}" with args: ${JSON.stringify(args)}`);
  
  switch (name) {
    case 'exec':
      if (typeof args?.c !== 'string') {
        throw new Error(`Missing or invalid command argument 'c' for exec tool.`);
      }
      return runPowerShell(args.c);

    case 'clipboard':
      if (typeof args?.op !== 'string') {
        throw new Error(`Missing or invalid operation argument 'op' for clipboard tool.`);
      }
      if (args.op === 'read') {
        return runPowerShell('Get-Clipboard');
      } else {
        const text = args.text || '';
        // Escape quotes and backslashes for PowerShell Set-Clipboard statement
        const escaped = text.replace(/`/g, '``').replace(/"/g, '`"');
        return runPowerShell(`Set-Clipboard -Value "${escaped}"`);
      }

    case 'notify': {
      if (typeof args?.text !== 'string') {
        throw new Error(`Missing or invalid notification argument 'text' for notify tool.`);
      }
      const text = args.text || '';
      const title = 'Dex Agent';
      const escapedText = text.replace(/"/g, '`"');
      const soundCmd = args.sound ? '[console]::beep(1000, 300);' : '';
      const psCommand = `
        [System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null;
        $bal = New-Object System.Windows.Forms.NotifyIcon;
        $bal.Icon = [System.Drawing.SystemIcons]::Information;
        $bal.BalloonTipTitle = "${title}";
        $bal.BalloonTipText = "${escapedText}";
        $bal.Visible = $true;
        $bal.ShowBalloonTip(3000);
        ${soundCmd}
      `;
      return runPowerShell(psCommand);
    }

    case 'voice': {
      if (typeof args?.text !== 'string') {
        throw new Error(`Missing or invalid argument 'text' for voice tool.`);
      }
      const text = args.text || '';
      const escapedText = text.replace(/"/g, '`"');
      const psCommand = `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak("${escapedText}")`;
      return runPowerShell(psCommand);
    }

    case 'search': {
      if (typeof args?.query !== 'string') {
        throw new Error(`Missing or invalid argument 'query' for search tool.`);
      }
      const pathArg = args.path || process.cwd();
      const results = searchFiles(args.query, pathArg);
      return results.join('\n') || 'No files found matching the query.';
    }

    case 'schedule': {
      if (typeof args?.action !== 'string' || typeof args?.name !== 'string') {
        throw new Error(`Missing or invalid action/name arguments for schedule tool.`);
      }
      // Manage Windows Task Scheduler
      let cmd = '';
      if (args.action === 'create') {
        cmd = `Register-ScheduledTask -TaskName "${args.name}" -Action (New-ScheduledTaskAction -Execute "${args.cmd}") -Trigger (New-ScheduledTaskTrigger -${args.trigger || 'Daily'})`;
      } else if (args.action === 'delete') {
        cmd = `Unregister-ScheduledTask -TaskName "${args.name}" -Confirm:$false`;
      } else {
        cmd = `Get-ScheduledTask | Where-Object {$_.TaskName -like "*${args.name || ''}*"} | Format-Table TaskName, State`;
      }
      return runPowerShell(cmd);
    }

    case 'code':
      if (typeof args?.lang !== 'string' || typeof args?.code !== 'string') {
        throw new Error(`Missing or invalid lang/code arguments for code sandbox tool.`);
      }
      return executeSandbox(args.lang, args.code);

    case 'sql':
      if (typeof args?.query !== 'string' || typeof args?.dbPath !== 'string') {
        throw new Error(`Missing or invalid query/dbPath arguments for sql tool.`);
      }
      return executeSql(args.query, args.dbPath);

    case 'jq':
      if (typeof args?.query !== 'string' || typeof args?.filePath !== 'string') {
        throw new Error(`Missing or invalid query/filePath arguments for jq tool.`);
      }
      return executeJq(args.query, args.filePath);

    case 'http':
      if (typeof args?.method !== 'string' || typeof args?.url !== 'string') {
        throw new Error(`Missing or invalid method/url arguments for http tool.`);
      }
      return executeHttp(args);

    case 'git': {
      if (typeof args?.op !== 'string') {
        throw new Error(`Missing or invalid argument 'op' for git tool.`);
      }
      let gitCmd = `git ${args.op}`;
      if (args.op === 'commit' && args.msg) {
        gitCmd = `git commit -m "${args.msg.replace(/"/g, '\\"')}"`;
      }
      return runPowerShell(gitCmd);
    }

    case 'desktop': {
      if (typeof args?.goal !== 'string') {
        throw new Error(`Missing or invalid argument 'goal' for desktop tool.`);
      }
      const driverPath = path.resolve(process.cwd(), 'drivers', 'windows-desktop', 'server.py');
      return callMcpTool(driverPath, 'run_desktop_task', args);
    }

    case 'browser': {
      if (typeof args?.goal !== 'string') {
        throw new Error(`Missing or invalid argument 'goal' for browser tool.`);
      }
      const driverPath = path.resolve(process.cwd(), 'drivers', 'browser-control', 'server.py');
      return callMcpTool(driverPath, 'run_browser_task', args);
    }

    default:
      return `Tool "${name}" is not implemented locally yet.`;
  }
}
