import { describe, it, expect, beforeEach } from 'vitest';
import {
  setSessionMode,
  getSessionMode,
  startTurn,
  recordDecision,
  needsPrompt,
  isRiskyPath,
  isRiskyCommand,
  clearSession,
} from '../../../src/main/approvals/policy';

const SID = 's1';

describe('approvals/policy — session mode defaults', () => {
  beforeEach(() => clearSession(SID));

  it('defaults an unset session to full access — Grid view\'s unchanged behavior', () => {
    expect(getSessionMode(SID)).toBe('full');
  });

  it('remembers a mode once set', () => {
    setSessionMode(SID, 'ask');
    expect(getSessionMode(SID)).toBe('ask');
  });
});

describe('approvals/policy — registry-write is always gated', () => {
  beforeEach(() => clearSession(SID));

  it('needs a prompt even in full-access mode', () => {
    setSessionMode(SID, 'full');
    expect(needsPrompt({ sessionId: SID, category: 'registry-write' })).toBe(true);
  });

  it('needs a prompt in ask mode', () => {
    setSessionMode(SID, 'ask');
    expect(needsPrompt({ sessionId: SID, category: 'registry-write' })).toBe(true);
  });

  it('skips the prompt once a session-lifetime approval has been recorded', () => {
    setSessionMode(SID, 'full');
    recordDecision(SID, 'registry-write', true, 'session');
    expect(needsPrompt({ sessionId: SID, category: 'registry-write' })).toBe(false);
  });
});

describe('approvals/policy — new categories follow session mode', () => {
  beforeEach(() => clearSession(SID));

  it('full access never prompts for the new categories', () => {
    setSessionMode(SID, 'full');
    expect(needsPrompt({ sessionId: SID, category: 'process-launch', subject: 'reg.exe add HKCU\\Foo' })).toBe(false);
    expect(needsPrompt({ sessionId: SID, category: 'filesystem-write-unsafe-path', subject: 'C:\\Windows\\System32\\x.dll' })).toBe(false);
  });

  it('ask mode always prompts for the new categories regardless of risk', () => {
    setSessionMode(SID, 'ask');
    expect(needsPrompt({ sessionId: SID, category: 'process-launch', subject: 'echo hi' })).toBe(true);
    expect(needsPrompt({ sessionId: SID, category: 'filesystem-write-unsafe-path', subject: 'C:\\Users\\me\\Desktop\\notes.txt' })).toBe(true);
  });

  it('auto mode only prompts when the subject is flagged risky', () => {
    setSessionMode(SID, 'auto');
    expect(needsPrompt({ sessionId: SID, category: 'process-launch', subject: 'echo hi' })).toBe(false);
    expect(needsPrompt({ sessionId: SID, category: 'process-launch', subject: 'reg.exe query HKCU' })).toBe(true);
    expect(needsPrompt({ sessionId: SID, category: 'filesystem-write-unsafe-path', subject: 'C:\\Users\\me\\Desktop\\notes.txt' })).toBe(false);
    expect(needsPrompt({ sessionId: SID, category: 'filesystem-write-unsafe-path', subject: 'C:\\Windows\\System32\\x.dll' })).toBe(true);
  });

  it('auto mode with no subject given does not prompt (nothing to evaluate)', () => {
    setSessionMode(SID, 'auto');
    expect(needsPrompt({ sessionId: SID, category: 'process-launch' })).toBe(false);
  });
});

describe('approvals/policy — approval lifetimes', () => {
  beforeEach(() => clearSession(SID));

  it('"once" is not remembered — the very next check still prompts', () => {
    setSessionMode(SID, 'ask');
    recordDecision(SID, 'process-launch', true, 'once');
    expect(needsPrompt({ sessionId: SID, category: 'process-launch' })).toBe(true);
  });

  it('"turn" is remembered until startTurn() is called for that session', () => {
    setSessionMode(SID, 'ask');
    recordDecision(SID, 'process-launch', true, 'turn');
    expect(needsPrompt({ sessionId: SID, category: 'process-launch' })).toBe(false);
    startTurn(SID);
    expect(needsPrompt({ sessionId: SID, category: 'process-launch' })).toBe(true);
  });

  it('"session" survives startTurn() — only clearSession() (or a new session) resets it', () => {
    setSessionMode(SID, 'ask');
    recordDecision(SID, 'process-launch', true, 'session');
    startTurn(SID);
    expect(needsPrompt({ sessionId: SID, category: 'process-launch' })).toBe(false);
  });

  it('startTurn() only clears the calling session, not others', () => {
    setSessionMode(SID, 'ask');
    setSessionMode('s2', 'ask');
    recordDecision(SID, 'process-launch', true, 'turn');
    recordDecision('s2', 'process-launch', true, 'turn');
    startTurn(SID);
    expect(needsPrompt({ sessionId: SID, category: 'process-launch' })).toBe(true);
    expect(needsPrompt({ sessionId: 's2', category: 'process-launch' })).toBe(false);
    clearSession('s2');
  });

  it('a remembered decision covers every later check in scope, not just one', () => {
    setSessionMode(SID, 'ask');
    recordDecision(SID, 'process-launch', true, 'session');
    expect(needsPrompt({ sessionId: SID, category: 'process-launch' })).toBe(false);
    expect(needsPrompt({ sessionId: SID, category: 'process-launch' })).toBe(false);
    expect(needsPrompt({ sessionId: SID, category: 'process-launch' })).toBe(false);
  });
});

describe('approvals/policy — risk heuristics', () => {
  it('isRiskyPath flags Windows/Program Files/System32/ProgramData paths', () => {
    expect(isRiskyPath('C:\\Windows\\System32\\drivers\\etc\\hosts')).toBe(true);
    expect(isRiskyPath('C:\\Program Files\\Some App\\config.json')).toBe(true);
    expect(isRiskyPath('C:\\ProgramData\\App\\cache')).toBe(true);
    expect(isRiskyPath('C:\\Users\\me\\Documents\\report.docx')).toBe(false);
  });

  it('isRiskyCommand flags system-state commands, case-insensitively, ignoring quoting', () => {
    expect(isRiskyCommand('reg.exe add HKCU\\Software\\Foo')).toBe(true);
    expect(isRiskyCommand('REG query HKLM')).toBe(true);
    expect(isRiskyCommand('"sc.exe" stop Spooler')).toBe(true);
    expect(isRiskyCommand('shutdown /r /t 0')).toBe(true);
    expect(isRiskyCommand('echo hello')).toBe(false);
    expect(isRiskyCommand('npm install')).toBe(false);
  });
});
