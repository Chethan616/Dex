import { expect, test, describe, vi, beforeEach, afterEach } from 'vitest';
import { GatewayServer } from '../../src/gateway/server.js';
import { AgentOrchestrator } from '../../src/gateway/orchestrator.js';
import WebSocket from 'ws';

describe('GatewayServer WebSocket integration tests', () => {
  let server: GatewayServer;
  const TEST_PORT = 18788;

  beforeEach(async () => {
    vi.restoreAllMocks();
    server = new GatewayServer(TEST_PORT);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  test('server handles simple query with step events and reply', () => {
    return new Promise<void>((resolve, reject) => {
      // Mock orchestrator runQuery to avoid real OS/LLM execution
      const mockRunQuery = vi.spyOn(AgentOrchestrator.prototype, 'runQuery')
        .mockImplementation(async (id, raw, callbacks) => {
          callbacks.onStepEvent({
            stepId: 's1',
            name: 'mock acting',
            status: 'acting'
          });
          return { status: 'done', result: 'mock output' };
        });

      const client = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
      const receivedMessages: any[] = [];

      client.on('open', () => {
        client.send(JSON.stringify({
          type: 'query',
          id: 'query_123',
          query: 'hello test'
        }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        receivedMessages.push(msg);

        if (msg.type === 'reply') {
          try {
            expect(mockRunQuery).toHaveBeenCalledWith('query_123', 'hello test', expect.any(Object));
            expect(receivedMessages).toContainEqual(expect.objectContaining({
              type: 'step_event',
              id: 'query_123'
            }));
            expect(msg).toEqual({
              type: 'reply',
              id: 'query_123',
              result: { status: 'done', result: 'mock output' }
            });
            client.close();
            resolve();
          } catch (err) {
            client.close();
            reject(err);
          }
        }
      });

      client.on('error', (err) => {
        reject(err);
      });
    });
  });

  test('server handles approval flow via pending_action', () => {
    return new Promise<void>((resolve, reject) => {
      // Mock orchestrator runQuery to simulate waiting for approval
      vi.spyOn(AgentOrchestrator.prototype, 'runQuery')
        .mockImplementation(async (id, raw, callbacks) => {
          const approved = await callbacks.onPendingAction({
            stepId: 's2',
            name: 'destructive_tool',
            args: {},
            message: 'approve me'
          });
          return { status: approved ? 'done' : 'denied' };
        });

      const client = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
      let pendingReceived = false;

      client.on('open', () => {
        client.send(JSON.stringify({
          type: 'query',
          id: 'query_approve',
          query: 'run destructive task'
        }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'pending_action') {
          pendingReceived = true;
          // Send back approval response
          client.send(JSON.stringify({
            type: 'approve',
            id: 'query_approve'
          }));
        } else if (msg.type === 'reply') {
          try {
            expect(pendingReceived).toBe(true);
            expect(msg.result.status).toBe('done');
            client.close();
            resolve();
          } catch (err) {
            client.close();
            reject(err);
          }
        }
      });

      client.on('error', (err) => {
        reject(err);
      });
    });
  });
});
