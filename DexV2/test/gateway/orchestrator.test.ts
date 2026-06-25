import { expect, test, describe, vi, beforeEach } from 'vitest';
import { AgentOrchestrator } from '../../src/gateway/orchestrator.js';
import { GeminiProvider } from '../../src/llm/providers/gemini.js';
import * as executor from '../../src/tools/executor.js';

describe('AgentOrchestrator tests', () => {
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    orchestrator = new AgentOrchestrator();
    vi.restoreAllMocks();
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
});
