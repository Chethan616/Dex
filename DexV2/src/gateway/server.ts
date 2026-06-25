import { WebSocketServer, WebSocket } from 'ws';
import { AgentOrchestrator } from './orchestrator.js';
import { logger } from '../utils/logger.js';

const MODULE = 'GATEWAY_SERVER';

export class GatewayServer {
  private wss: WebSocketServer | null = null;
  private orchestrator = new AgentOrchestrator();
  private pendingApprovals = new Map<string, (approved: boolean) => void>();

  constructor(private port: number = 18789) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.port }, () => {
        logger.info(MODULE, `WebSocket server listening on ws://127.0.0.1:${this.port}`);
        resolve();
      });

      this.wss.on('connection', (ws) => {
        logger.info(MODULE, 'New client connected');

        ws.on('message', async (data) => {
          let messageStr = '';
          try {
            messageStr = data.toString();
            const msg = JSON.parse(messageStr);
            await this.handleMessage(ws, msg);
          } catch (err: any) {
            logger.error(MODULE, `Error processing message "${messageStr}":`, err);
            ws.send(JSON.stringify({ type: 'error', error: `Malformed message: ${err.message}` }));
          }
        });

        ws.on('close', () => {
          logger.info(MODULE, 'Client disconnected');
        });
      });
    });
  }

  async stop(): Promise<void> {
    if (this.wss) {
      return new Promise<void>((resolve) => {
        this.wss!.close(() => {
          logger.info(MODULE, 'WebSocket server stopped');
          resolve();
        });
      });
    }
  }

  private async handleMessage(ws: WebSocket, msg: any) {
    const type = msg.type || (msg.method ? 'jsonrpc' : '');
    const id = msg.id || `query_${Date.now()}`;

    if (type === 'query' || (type === 'jsonrpc' && msg.method === 'query')) {
      const rawQuery = msg.query || msg.text || (msg.params && (msg.params.query || msg.params.text));
      if (!rawQuery) {
        this.sendError(ws, id, 'Missing query parameter', type === 'jsonrpc');
        return;
      }

      logger.info(MODULE, `Received query [${id}]: "${rawQuery}"`);
      
      try {
        const result = await this.orchestrator.runQuery(id, rawQuery, {
          onStepEvent: (event) => {
            if (ws.readyState === WebSocket.OPEN) {
              if (type === 'jsonrpc') {
                ws.send(JSON.stringify({
                  jsonrpc: '2.0',
                  method: 'step_event',
                  params: { queryId: id, step: event }
                }));
              } else {
                ws.send(JSON.stringify({
                  type: 'step_event',
                  id,
                  step: event
                }));
              }
            }
          },
          onPendingAction: (payload) => {
            return new Promise<boolean>((resolve) => {
              this.pendingApprovals.set(id, resolve);

              if (ws.readyState === WebSocket.OPEN) {
                if (type === 'jsonrpc') {
                  ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'pending_action',
                    params: {
                      queryId: id,
                      stepId: payload.stepId,
                      name: payload.name,
                      args: payload.args,
                      message: payload.message
                    }
                  }));
                } else {
                  ws.send(JSON.stringify({
                    type: 'pending_action',
                    id,
                    stepId: payload.stepId,
                    name: payload.name,
                    args: payload.args,
                    message: payload.message
                  }));
                }
              } else {
                resolve(false); // Disconnected
              }
            });
          }
        });

        // Format a text reply suitable for simple channel bots
        let replyText = '';
        if (result) {
          if (Array.isArray(result)) {
            replyText = result.map(r => r.result || r.error || JSON.stringify(r)).join('\n');
          } else {
            replyText = result.result || result.error || JSON.stringify(result);
          }
        }

        if (ws.readyState === WebSocket.OPEN) {
          if (type === 'jsonrpc') {
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              id,
              result
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'reply',
              id,
              result,
              text: replyText
            }));
          }
        }
      } catch (err: any) {
        if (ws.readyState === WebSocket.OPEN) {
          this.sendError(ws, id, err.message, type === 'jsonrpc');
        }
      }
    } else if (type === 'approve' || (type === 'jsonrpc' && msg.method === 'approve')) {
      const targetQueryId = msg.queryId || (msg.params && msg.params.queryId) || id;
      logger.info(MODULE, `Received approval for query ID: ${targetQueryId}`);
      const resolver = this.pendingApprovals.get(targetQueryId);
      if (resolver) {
        this.pendingApprovals.delete(targetQueryId);
        resolver(true);
      } else {
        logger.warn(MODULE, `No pending approval found for query ID: ${targetQueryId}`);
      }
    } else if (type === 'deny' || (type === 'jsonrpc' && msg.method === 'deny')) {
      const targetQueryId = msg.queryId || (msg.params && msg.params.queryId) || id;
      logger.info(MODULE, `Received denial for query ID: ${targetQueryId}`);
      const resolver = this.pendingApprovals.get(targetQueryId);
      if (resolver) {
        this.pendingApprovals.delete(targetQueryId);
        resolver(false);
      } else {
        logger.warn(MODULE, `No pending approval found for query ID: ${targetQueryId}`);
      }
    } else {
      this.sendError(ws, id, `Unsupported method/type: ${msg.type || msg.method}`, type === 'jsonrpc');
    }
  }

  private sendError(ws: WebSocket, id: string, message: string, isJsonRpc: boolean) {
    if (isJsonRpc) {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message }
      }));
    } else {
      ws.send(JSON.stringify({
        type: 'error',
        id,
        error: message
      }));
    }
  }
}
