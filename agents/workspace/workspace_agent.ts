import { Agent } from '../../core/orchestrator/registry';
import { AgentContext, AgentResult } from '../../core/events/types';
import { CredentialStore } from '../../core/secrets/credential_store';
import { emit } from '../../core/events/bus';
import { McpPool, McpServerSpec } from './mcp_pool';
import { READBACK_FOR, bindArgs, extractId, resolveTool } from './tool_binding';

/**
 * Which server answers for which action. Overridable per step (`params.server`)
 * so a plan can say "the Outlook one" when the owner has both.
 */
const DEFAULT_ROUTES: Record<string, string> = {
  search_email: 'google',
  read_email: 'google',
  send_email: 'google',
  list_calendar_events: 'google',
  create_calendar_event: 'google',
  search_drive: 'google',
  read_drive_file: 'google',
};

/**
 * Actions that change something outside this machine. Everything else is a
 * read, and a read is worth verifying only in the sense that it returned.
 */
const WRITES = new Set(['send_email', 'create_calendar_event']);

export interface WorkspaceOptions {
  servers: McpServerSpec[];
  routes?: Record<string, string>;
  credentials?: CredentialStore;
}

/**
 * The API hands: Gmail, Calendar, Drive, Outlook, OneDrive — through official
 * APIs, via MCP servers, never by driving a browser to a webmail page.
 *
 * The Brain plans against DEX's own action names. This agent asks the live
 * server what it actually offers and binds onto that, so a renamed tool or a
 * different provider is a resolution miss with a readable message rather than
 * a crash.
 */
export class WorkspaceAgent implements Agent {
  name = 'WorkspaceAgent';
  capabilities = ['can_access_email', 'can_access_calendar', 'can_access_drive'];

  private pool: McpPool;
  private routes: Record<string, string>;

  constructor(options: WorkspaceOptions) {
    const credentials = options.credentials ?? new CredentialStore();
    this.pool = new McpPool(
      new Map(options.servers.map((s) => [s.key, s])),
      credentials,
    );
    this.routes = { ...DEFAULT_ROUTES, ...(options.routes ?? {}) };
  }

  /**
   * Actually connect to an account, and report what came back.
   *
   * The Settings screen reported Email, calendar and files as working because
   * a client id was *stored*. Storing a credential proves somebody typed
   * something into a box: it does not prove the id is right, the secret
   * matches, the OAuth consent was granted, or that `uvx` is even installed.
   * Every one of those fails at the first real request, long after the screen
   * said connected.
   *
   * So this starts the server and asks it what it can do. Listing tools is the
   * cheapest call that exercises the whole path — spawn, handshake, credential
   * injection — and the answer is a list the owner can read rather than a
   * boolean somebody computed.
   *
   * Nothing is written and nothing is sent. A probe that posted a test email
   * would prove more and cost the owner an email.
   */
  async probe(key: string): Promise<{
    key: string;
    ok: boolean;
    account?: string;
    tools: string[];
    detail: string;
  }> {
    try {
      const tools = await this.pool.tools(key);
      const account = await this.pool.identity(key);
      const names = tools.map((tool) => tool.name).sort();

      if (names.length === 0) {
        return {
          key,
          ok: false,
          account,
          tools: [],
          detail: 'The server started but offers no tools — check its version.',
        };
      }

      return {
        key,
        ok: true,
        account,
        tools: names,
        detail: account
          ? `Connected as ${account} — ${names.length} tools available`
          : `Connected — ${names.length} tools available, no account reported`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        key,
        ok: false,
        tools: [],
        // The three ways this fails in practice, each with the thing to do
        // about it. "Failed to connect" on its own sends the owner to the logs.
        detail: /ENOENT|not recognized|spawn/i.test(message)
          ? `Could not start the server. Install its runner first — ${message}`
          : /auth|credential|token|401|403/i.test(message)
            ? `The account has not been authorised yet — ${message}`
            : message,
      };
    }
  }

  async execute(
    action: string,
    params: Record<string, unknown>,
    requestId: string,
    stepId: string,
    ctx?: AgentContext,
  ): Promise<AgentResult> {
    if (action === 'list_tools') return this.listTools(params, requestId, stepId);

    const server = String(params.server ?? this.routes[action] ?? '');
    if (!server) {
      return {
        success: false,
        error: `WorkspaceAgent: unknown action "${action}"`,
        retryable: false,
      };
    }

    ctx?.report?.(`I am connecting to ${server} to complete this step.`);

    let tools;
    try {
      tools = await this.pool.tools(server);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit('failed', `Workspace (${server}): ${message}`, requestId, stepId);
      return { success: false, error: message, retryable: true };
    }

    const resolved = resolveTool(action, tools);
    if ('error' in resolved) {
      emit('failed', `Workspace: ${resolved.error}`, requestId, stepId);
      // A missing tool is not a transient failure — retrying calls the same
      // tools/list and gets the same answer.
      return { success: false, error: resolved.error, retryable: false };
    }

    const identity = await this.pool.identity(server);
    const { args, missing } = bindArgs(resolved.tool, params, identity);

    if (missing.length > 0) {
      const error =
        `${resolved.tool.name} requires ${missing.join(', ')}, and the plan did not ` +
        `supply ${missing.length > 1 ? 'them' : 'it'}`;
      emit('failed', `Workspace: ${error}`, requestId, stepId);
      return { success: false, error, retryable: false };
    }

    emit('executing', `${server}:${resolved.tool.name}`, requestId, stepId);
    ctx?.report?.(`I am asking ${server} for ${resolved.tool.name}.`);

    let outcome;
    try {
      outcome = await this.pool.callTool(server, resolved.tool.name, args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit('failed', `Workspace ${resolved.tool.name}: ${message}`, requestId, stepId);
      return { success: false, error: message, retryable: true };
    }

    if (outcome.isError) {
      const message = summarize(outcome.content) || `${resolved.tool.name} reported an error`;
      emit('failed', `Workspace ${resolved.tool.name}: ${message}`, requestId, stepId);
      return { success: false, error: message, retryable: true };
    }

    const data: Record<string, unknown> = {
      server,
      tool: resolved.tool.name,
      content: outcome.content,
      summary: summarize(outcome.content),
    };

    if (WRITES.has(action)) {
      data.readBack = await this.readBack(action, server, outcome.content, requestId, stepId);
    } else {
      data.readBack = { verified: true, method: 'read-only action' };
    }

    return { success: true, data };
  }

  /**
   * Confirms a write by fetching it back through a different tool.
   *
   * "The send tool returned 200" is the sending tool's opinion of itself. This
   * asks the server for the thing that is supposed to now exist. When the
   * result carries no id there is nothing to ask about, and this reports
   * exactly that rather than assuming the best.
   */
  private async readBack(
    action: string,
    server: string,
    content: unknown,
    requestId: string,
    stepId: string,
  ): Promise<{ verified: boolean; method: string; id?: string }> {
    const id = extractId(content);
    if (!id) {
      return {
        verified: false,
        method: 'no resource id in the response — nothing to read back',
      };
    }

    const readAction = READBACK_FOR[action];
    if (!readAction) return { verified: false, method: 'no read-back tool for this action', id };

    try {
      const tools = await this.pool.tools(server);
      const resolved = resolveTool(readAction, tools);
      if ('error' in resolved) {
        return { verified: false, method: `no read-back tool: ${resolved.error}`, id };
      }

      const identity = await this.pool.identity(server);
      const { args, missing } = bindArgs(resolved.tool, { id, query: id, max: 5 }, identity);
      if (missing.length > 0) {
        return { verified: false, method: `read-back needs ${missing.join(', ')}`, id };
      }

      const outcome = await this.pool.callTool(server, resolved.tool.name, args);
      const found = !outcome.isError && summarize(outcome.content).includes(id);

      emit(
        found ? 'done' : 'retrying',
        found
          ? `Read-back confirmed ${id} via ${resolved.tool.name}`
          : `Read-back could not find ${id} — treating as unverified`,
        requestId,
        stepId,
      );

      return { verified: found, method: `${resolved.tool.name} read-back`, id };
    } catch (err) {
      return {
        verified: false,
        method: `read-back failed: ${err instanceof Error ? err.message : String(err)}`,
        id,
      };
    }
  }

  private async listTools(
    params: Record<string, unknown>,
    requestId: string,
    stepId: string,
  ): Promise<AgentResult> {
    const server = String(params.server ?? 'google');
    try {
      const tools = await this.pool.tools(server);
      emit('done', `${server}: ${tools.length} tools`, requestId, stepId);
      return {
        success: true,
        data: tools.map((t) => ({ name: t.name, description: t.description })),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, retryable: true };
    }
  }

  async close(): Promise<void> {
    await this.pool.close();
  }
}

/** MCP content blocks are a list; the text ones are what a person can read. */
export function summarize(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        const record = block as Record<string, unknown>;
        if (typeof record.text === 'string') return record.text;
        return JSON.stringify(record);
      })
      .join('\n')
      .trim();
  }
  if (content == null) return '';
  return JSON.stringify(content);
}
