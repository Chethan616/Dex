import { describe, expect, it } from 'vitest';
import { buildTranscript, classifyTool, stepPhrase } from '../../../src/renderer/logs/transcript';
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
    expect(classifyTool('Bash', { command: 'ls -la', description: 'List files in the current directory' }).active).toBe('Listing files in the current directory');
    expect(classifyTool('Bash', { command: 'ls -la' }).kind).toBe('run');
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
