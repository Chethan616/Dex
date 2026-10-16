import { describe, expect, it } from 'vitest';
import { buildTranscript, classifyTool, stepPhrase, unwrapShell } from '../../../src/renderer/logs/transcript';
import { expandSlashCommand } from '../../../src/shared/slashCommands';

// The steps of a real task (a university portal, then the timetable), as the
// phone's live update showed them: "Ran browser-harness-js <<'EOF'".
const harness = (body: string, description?: string) => ({
  command: `browser-harness-js <<'EOF'\n${body}\nEOF`,
  ...(description ? { description } : {}),
});

describe('steps in plain words', () => {
  it('says a browser step with the comment that opens its code', () => {
    const m = classifyTool('Bash', harness("// Click on Academics menu\nawait session.Input.dispatchMouseEvent({ x: 104, y: 65, type: 'mousePressed' })"));
    expect(m).toMatchObject({ kind: 'browse', active: 'Clicking on Academics menu', done: 'Clicked on Academics menu', display: '' });
  });

  it('falls back to the call’s description, then to what the code does', () => {
    expect(classifyTool('Bash', { command: "browser-harness-js 'await connectToAssignedTarget()'", description: 'Connect to the assigned browser target' }).active)
      .toBe('Connecting to the assigned browser target');
    expect(classifyTool('Bash', { command: "browser-harness-js 'await connectToAssignedTarget()'" }).done).toBe('Opened its browser tab');
    expect(classifyTool('Bash', harness("await session.Page.navigate({ url: 'https://vtop.vit.ac.in/vtop/content' })")).active).toBe('Opening vtop.vit.ac.in');
    expect(classifyTool('Bash', harness('const { data } = await session.Page.captureScreenshot({ format: "png" })')).done).toBe('Looked at the page');
  });

  it('calls a look at a screenshot what it is', () => {
    expect(classifyTool('Read', { file_path: '/tmp/vtop-academics-menu.png' })).toMatchObject({ kind: 'browse', active: 'Looking at the page', display: '' });
    expect(classifyTool('Read', { file_path: 'C:\\Users\\Alex\\Pictures\\cat.jpg' }).done).toBe('Looked at cat.jpg');
    expect(classifyTool('Read', { file_path: 'notes.md' }).kind).toBe('read');
  });

  it('names DEX’s own tools and keeps plain shell commands described', () => {
    expect(classifyTool('Bash', { command: 'dex-ui choose "Which one?" "A" "B"' }).active).toBe('Asking you');
    expect(classifyTool('Bash', { command: "dex-workflow create <<'EOF'\n{}\nEOF" }).done).toBe('Updated your routines');
    expect(classifyTool('PowerShell', { command: 'dex-remember note "Prefers aisle seats"' }).done).toBe('Remembered “Prefers aisle seats”');
    expect(classifyTool('Bash', { command: 'dex-remember site portal.example.edu "uni portal"' }).done).toBe('Remembered it');
    expect(classifyTool('Bash', { command: 'ls -la', description: 'List files in the current directory' }).active).toBe('Listing files in the current directory');
    expect(classifyTool('Bash', { command: 'ls -la' }).active).toBe('Looking through files');
    expect(classifyTool('Bash', { command: 'Get-Process | Sort-Object CPU' }).done).toBe('Checked what’s running');
    expect(classifyTool('Bash', { command: 'whoami /all' })).toMatchObject({ kind: 'run', done: 'Ran a command', display: '' });
  });

  it('keeps words it has no tense for as they are', () => {
    expect(stepPhrase('Semester dropdown, second try.')).toEqual({ active: 'Semester dropdown, second try', done: 'Semester dropdown, second try' });
    expect(stepPhrase('  ')).toBeNull();
  });
});

describe('a command task in the chat', () => {
  it('shows what the user typed as the first message', () => {
    const t = buildTranscript(expandSlashCommand('/workflow').prompt, []);
    expect(t.blocks[0]).toMatchObject({ kind: 'user', text: '/workflow' });
  });
});

// Codex runs every command through PowerShell (bash -lc elsewhere) and never
// describes its calls; these are the shapes from a real Codex task.
describe('Codex steps', () => {
  const ps = (script: string) => ({ command: `"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "${script}"` });

  it('sees through the shell wrapper', () => {
    expect(unwrapShell(ps('Get-Content -Raw .\\AGENTS.md').command)).toBe('Get-Content -Raw .\\AGENTS.md');
    expect(unwrapShell("/bin/bash -lc 'ls -la'")).toBe('ls -la');
    expect(unwrapShell('"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -Command "git status"')).toBe('git status');
  });

  it('says what the step does', () => {
    expect(classifyTool('Bash', ps('Get-Content -Raw .\\AGENTS.md')).done).toBe('Read its instructions');
    expect(classifyTool('Bash', ps("$p = Join-Path $env:DEX_SITE_MEMORY_DIR 'github.com.md'; if (Test-Path $p) { Get-Content -Raw $p }")).active).toBe('Checking its notes on github.com');
    expect(classifyTool('Bash', ps("browser-harness-js 'await connectToAssignedTarget()'")).done).toBe('Opened its browser tab');
    expect(classifyTool('Bash', ps("browser-harness-js <<'EOF'\nawait connectToAssignedTarget()\nawait session.Page.navigate({url:'https://github.com/search?q=author%3AChethan616'})")).active).toBe('Opening github.com');
    expect(classifyTool('Bash', ps('Get-Content -Raw C:\\Users\\Alex\\notes.txt')).done).toBe('Read notes.txt');
    expect(classifyTool('Bash', ps('git status')).active).toBe('Using git');
  });

  it('sees through dex-sh too (a touchpad task)', () => {
    expect(classifyTool('Bash', ps('dex-sh powershell "Get-PnpDevice -Class HIDClass | Format-Table Status,FriendlyName -AutoSize" 20')).done).toBe('Checked devices');
    expect(classifyTool('Bash', ps("dex-sh bash \"dex-state plan 'Restore touchpad gestures' 'Inspect the touchpad'\"")).active).toBe('Updating its plan');
    expect(classifyTool('Bash', ps("dex-sh powershell \"Start-Process 'ms-settings:devices-touchpad'\"")).done).toBe('Opened Settings');
    expect(classifyTool('MCP', {}).done).toBe('Used a connector');
  });

  it('calls a connector by name and a picture what it is', () => {
    expect(classifyTool('mcp__kiwi__search-flight', {}).display).toContain('search flight');
    expect(classifyTool('view_image', { path: 'C:\\Users\\Alex\\AppData\\Local\\Temp\\shot.png' }).active).toBe('Looking at the page');
  });
});


describe('tense across a sentence', () => {
  it('turns every verb, not just the first', () => {
    expect(stepPhrase('Go to VTOP and take a screenshot')).toEqual({ active: 'Going to VTOP and taking a screenshot', done: 'Went to VTOP and took a screenshot' });
    expect(stepPhrase('Navigate main tab to example.com and get title')?.done).toBe('Navigated main tab to example.com and got title');
    expect(stepPhrase('Parse JSON output, then decode the image')?.done).toBe('Parsed JSON output, then decoded the image');
  });
});
