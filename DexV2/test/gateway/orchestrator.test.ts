import { expect, test, describe, vi, beforeEach } from 'vitest';
import { AgentOrchestrator } from '../../src/gateway/orchestrator.js';
import { GeminiProvider } from '../../src/llm/providers/gemini.js';
import * as executor from '../../src/tools/executor.js';

describe('AgentOrchestrator tests', () => {
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    orchestrator = new AgentOrchestrator();
    vi.restoreAllMocks();
    process.env.DEX_PROVIDER_MODE = 'auto';
    process.env.GEMINI_API_KEY = 'mock-gemini-key';
    delete process.env.GROQ_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  test('Tier 0: open notepad executes deterministic tool directly without LLM', async () => {
    const mockExecute = vi.spyOn(executor, 'executeTool').mockResolvedValue('Notepad started');
    const stepEvents: any[] = [];

    const result = await orchestrator.runQuery('q0', 'open notepad', {
      onStepEvent: (e) => stepEvents.push(e),
      onPendingAction: async () => true
    });

    expect(mockExecute).toHaveBeenCalledWith('exec', { c: 'Start-Process notepad' });
    expect(result.status).toBe('done');
    expect(stepEvents.some(e => e.status === 'acting')).toBe(true);
    expect(stepEvents.some(e => e.status === 'done')).toBe(true);
  });

  test('Tier 0.5: set volume to 50 executes parametric tool directly', async () => {
    const mockExecute = vi.spyOn(executor, 'executeTool').mockResolvedValue('Volume set');
    const stepEvents: any[] = [];

    await orchestrator.runQuery('q0.5', 'set volume to 50', {
      onStepEvent: (e) => stepEvents.push(e),
      onPendingAction: async () => true
    });

    expect(mockExecute).toHaveBeenCalledWith('exec', expect.objectContaining({
      c: expect.stringContaining('$vol=50')
    }));
  });

  test('Tier 0: desktop recipe launches the app and then uses desktop automation with clear step labels', async () => {
    const mockExecute = vi.spyOn(executor, 'executeTool')
      .mockResolvedValueOnce('Paint launched')
      .mockResolvedValueOnce('Drawing complete');
    const stepEvents: any[] = [];

    const result = await orchestrator.runQuery('q_recipe', 'draw a red square in paint', {
      onStepEvent: (e) => stepEvents.push(e),
      onPendingAction: async () => true
    });

    expect(mockExecute).toHaveBeenNthCalledWith(1, 'exec', { c: 'Start-Process "mspaint"' });
    expect(mockExecute).toHaveBeenNthCalledWith(2, 'desktop', {
      goal: expect.stringContaining('draw a red square'),
      app_hint: 'Paint',
    });
    expect(stepEvents.some(e => e.name === 'Launch Paint')).toBe(true);
    expect(stepEvents.some(e => e.name === 'Paint Drawing Recipe')).toBe(true);
    expect(result.status).toBe('done');
  });

  test('Tier 1: executes LLM-driven single action', async () => {
    // Mock LLM chat generator returning execution plan
    const mockChat = vi.spyOn(GeminiProvider.prototype, 'chat').mockImplementation(async function* () {
      yield { text: JSON.stringify({ t: 'exec', a: { c: 'echo "hello"' } }) };
    });

    const mockExecute = vi.spyOn(executor, 'executeTool').mockResolvedValue('hello');
    const stepEvents: any[] = [];

    const result = await orchestrator.runQuery('q1', 'print hello', {
      onStepEvent: (e) => stepEvents.push(e),
      onPendingAction: async () => true
    });

    expect(mockChat).toHaveBeenCalled();
    expect(mockExecute).toHaveBeenCalledWith('exec', { c: 'echo "hello"' });
    expect(result.status).toBe('done');
    expect(result.result).toBe('hello');
  });

  test('Tier 1: adapts code args when falling back to exec', async () => {
    vi.spyOn(GeminiProvider.prototype, 'chat').mockImplementation(async function* () {
      yield { text: JSON.stringify({ t: 'code', a: { lang: 'python', code: 'print("hello")' }, fb: 'exec' }) };
    });

    const mockExecute = vi.spyOn(executor, 'executeTool')
      .mockRejectedValueOnce(new Error('sandbox failed'))
      .mockResolvedValueOnce('hello');

    const result = await orchestrator.runQuery('q_fb', 'run this python', {
      onStepEvent: () => {},
      onPendingAction: async () => true
    });

    expect(mockExecute).toHaveBeenNthCalledWith(1, 'code', { lang: 'python', code: 'print("hello")' });
    expect(mockExecute).toHaveBeenNthCalledWith(2, 'exec', {
      c: expect.stringContaining('base64')
    });
    expect(result.status).toBe('done');
    expect(result.result).toBe('hello');
  });

  test('Tier 1: normalizes exec cmd aliases from LLM output', async () => {
    vi.spyOn(GeminiProvider.prototype, 'chat').mockImplementation(async function* () {
      yield { text: JSON.stringify({ t: 'exec', a: { cmd: 'echo "hello"' } }) };
    });

    const mockExecute = vi.spyOn(executor, 'executeTool').mockResolvedValue('hello');

    const result = await orchestrator.runQuery('q_cmd_alias', 'print hello', {
      onStepEvent: () => {},
      onPendingAction: async () => true
    });

    expect(mockExecute).toHaveBeenCalledWith('exec', { cmd: 'echo "hello"', c: 'echo "hello"' });
    expect(result.status).toBe('done');
  });

  test('Tier 2: recovers malformed planner JSON for Python script automation', async () => {
    const mockChat = vi.spyOn(GeminiProvider.prototype, 'chat')
      .mockImplementationOnce(async function* () {
        yield { text: '{\n  "steps": [\n    {\n      "t": "exec",\n      "a": {\n        },\n' };
      })
      .mockImplementationOnce(async function* () {
        yield { text: 'n = int(input("Enter a number: "))\nprint(n)\ninput("Press Enter to exit...")' };
      });
    const mockExecute = vi.spyOn(executor, 'executeTool').mockResolvedValue('started');

    const result = await orchestrator.runQuery(
      'q_script_recovery',
      'write a py program to check fbanocci of a number in notepad and save it in downloads and run it in cmd i will give input myself',
      {
        onStepEvent: () => {},
        onPendingAction: async () => true
      }
    );

    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(mockExecute).toHaveBeenCalledWith('exec', {
      c: expect.stringContaining('Downloads\\fbanocci.py')
    });
    expect(mockExecute).toHaveBeenCalledWith('exec', {
      c: expect.stringContaining('Start-Process notepad.exe')
    });
    expect(mockExecute).toHaveBeenCalledWith('exec', {
      c: expect.stringContaining('Start-Process cmd.exe')
    });
    expect(result[0].status).toBe('done');
  });

  test('Safety gate: destructive action triggers onPendingAction and halts on denial', async () => {
    // Mock LLM chat generator returning delete command
    vi.spyOn(GeminiProvider.prototype, 'chat').mockImplementation(async function* () {
      yield { text: JSON.stringify({ t: 'exec', a: { c: 'rmdir /s /q testdir' } }) };
    });

    const mockExecute = vi.spyOn(executor, 'executeTool').mockResolvedValue('deleted');
    
    // Test case 1: Denied by user
    const stepEvents1: any[] = [];
    const pendingSpy1 = vi.fn().mockResolvedValue(false); // Denied

    const result1 = await orchestrator.runQuery('q_deny', 'force wipe testdir', {
      onStepEvent: (e) => stepEvents1.push(e),
      onPendingAction: pendingSpy1
    });

    expect(pendingSpy1).toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled(); // Should not be called
    expect(result1.status).toBe('failed');
    expect(result1.error).toBe('Action denied by user');

    // Test case 2: Approved by user
    const stepEvents2: any[] = [];
    const pendingSpy2 = vi.fn().mockResolvedValue(true); // Approved

    const result2 = await orchestrator.runQuery('q_approve', 'force wipe testdir', {
      onStepEvent: (e) => stepEvents2.push(e),
      onPendingAction: pendingSpy2
    });

    expect(pendingSpy2).toHaveBeenCalled();
    expect(mockExecute).toHaveBeenCalledWith('exec', { c: 'rmdir /s /q testdir' });
    expect(result2.status).toBe('done');
  });

  test('Safety gate marks DNS changes as destructive', () => {
    expect(
      orchestrator.isDestructiveAction('exec', {
        c: "Set-DnsClientServerAddress -InterfaceAlias Ethernet -ServerAddresses ('1.1.1.1','8.8.4.4')"
      })
    ).toBe(true);
  });

  test('Tier 1: empty LLM response throws a descriptive error message', async () => {
    vi.spyOn(GeminiProvider.prototype, 'chat').mockImplementation(async function* () {
      // Yield nothing, representing empty/blocked response
    });

    const stepEvents: any[] = [];

    await expect(
      orchestrator.runQuery('q_empty', 'some query', {
        onStepEvent: (e) => stepEvents.push(e),
        onPendingAction: async () => true
      })
    ).rejects.toThrow(/The LLM returned an empty response.*GEMINI_API_KEY/);

    expect(stepEvents.some(e => e.status === 'failed' && e.error && e.error.includes('empty response'))).toBe(true);
  });
});
