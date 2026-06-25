import { parseIntent } from '../brain/intent-analyzer.js';
import { classifyTier } from '../brain/tier-classifier.js';
import { tryDeterministic } from '../brain/deterministic.js';
import { tryParametric } from '../brain/parametric.js';
import { resolveModel } from '../llm/model-router.js';
import { getRelevantTools } from '../tools/intent-router.js';
import { PromptCacheManager } from '../llm/prompt-cache-manager.js';
import { GeminiProvider } from '../llm/providers/gemini.js';
import { ClaudeProvider } from '../llm/providers/claude.js';
import { GroqProvider } from '../llm/providers/groq.js';
import { executeTool } from '../tools/executor.js';
import { compressResult } from '../tools/result-compressor.js';
import { TIER1_ACTION_SCHEMA, TIER2_PLAN_SCHEMA } from '../llm/output-schema.js';
import { StepEvent, StepStatus, TaskIntent } from '../brain/types.js';
import { logger } from '../utils/logger.js';

const MODULE = 'ORCHESTRATOR';

export interface PendingActionPayload {
  stepId: string;
  name: string;
  args: any;
  message: string;
}

export class AgentOrchestrator {
  private cacheManager = new PromptCacheManager();

  constructor() {}

  /**
   * Helper to identify destructive commands
   */
  public isDestructiveAction(tool: string, args: any): boolean {
    const toolName = tool.toLowerCase();
    
    if (toolName === 'git' && args.op === 'push') {
      return true;
    }
    
    if (toolName === 'exec' && typeof args.c === 'string') {
      const cmd = args.c.toLowerCase();
      const destructivePatterns = [
        /\brmdir\b/i,
        /\bremove-item\b/i,
        /\bdel\s+/i,
        /\brm\s+/i,
        /\bformat\s+[a-z]:/i,
        /\bregedit\b.*\b(delete|remove|wipe)\b/i,
        /\bdisable-netadapter\b/i,
        /\bstop-service\b/i,
        /\bstop-process\b/i,
        /\bshutdown\b/i,
        /\brestart-computer\b/i,
        /\bclear-recyclebin\b/i,
      ];
      for (const pat of destructivePatterns) {
        if (pat.test(cmd)) return true;
      }
    }
    
    if (toolName === 'desktop' && typeof args.goal === 'string') {
      const goal = args.goal.toLowerCase();
      const destructivePatterns = [
        /\b(delete|uninstall|wipe|format|reset|remove)\b/i
      ];
      for (const pat of destructivePatterns) {
        if (pat.test(goal)) return true;
      }
    }

    if (toolName === 'browser' && typeof args.goal === 'string') {
      const goal = args.goal.toLowerCase();
      const destructivePatterns = [
        /\b(delete|uninstall|wipe|format|reset|remove)\b/i,
        /\b(pay|transfer|wire)\s+(\$|usd|money|funds)\b/i,
        /\blog\s*in\s+to\s+(?:my\s+)?(?:bank|banking|chase|wells|paypal|venmo)\b/i,
        /\b(tweet|post|publish)\b.*\b(public|to\s+everyone)\b/i
      ];
      for (const pat of destructivePatterns) {
        if (pat.test(goal)) return true;
      }
    }

    return false;
  }

  /**
   * Driver function to run a user query.
   */
  async runQuery(
    queryId: string,
    rawQuery: string,
    callbacks: {
      onStepEvent: (event: StepEvent) => void;
      onPendingAction: (payload: PendingActionPayload) => Promise<boolean>;
    }
  ): Promise<any> {
    logger.info(MODULE, `Starting query execution for ID: ${queryId}, Raw: "${rawQuery}"`);

    // 1. Intent parsing and Tier classification
    let intent = parseIntent(rawQuery);
    intent = classifyTier(intent);
    
    logger.info(MODULE, `Parsed intent: kind=${intent.kind}, tier=${intent.tier}`);

    // If compound, execute subIntents sequentially
    if (intent.kind === 'compound' && intent.subIntents && intent.subIntents.length > 0) {
      const results: any[] = [];
      for (let i = 0; i < intent.subIntents.length; i++) {
        const sub = intent.subIntents[i];
        logger.info(MODULE, `Running compound sub-intent ${i+1}/${intent.subIntents.length}: "${sub.raw}"`);
        const subResult = await this.runSingleIntent(queryId, sub, callbacks);
        results.push(subResult);
      }
      return results;
    }

    return this.runSingleIntent(queryId, intent, callbacks);
  }

  private async runSingleIntent(
    queryId: string,
    intent: TaskIntent,
    callbacks: {
      onStepEvent: (event: StepEvent) => void;
      onPendingAction: (payload: PendingActionPayload) => Promise<boolean>;
    }
  ): Promise<any> {
    const rawQuery = intent.raw;
    const normQuery = intent.normalized;

    // 2. Try zero-token deterministic/parametric path
    if (intent.tier === 0) {
      const action = tryDeterministic(normQuery);
      if (action) {
        return this.executeDeterministicAction(queryId, 'Deterministic Action', action, callbacks);
      }
    } else if (intent.tier === 0.5) {
      const action = tryParametric(normQuery);
      if (action) {
        return this.executeDeterministicAction(queryId, 'Parametric Action', action, callbacks);
      }
    }

    // 3. LLM Router (Flash / Reasoning)
    const { model, providerId } = resolveModel(intent.tier);
    logger.info(MODULE, `Resolved model: ${model} (provider: ${providerId})`);

    const tools = await getRelevantTools(intent);
    logger.info(MODULE, `Relevant tools count: ${tools.length}`);

    // Warm context cache if using Gemini
    let cacheKey: string | undefined;
    try {
      cacheKey = await this.cacheManager.getOrRefresh(intent.tier, providerId, tools);
    } catch (err) {
      logger.warn(MODULE, 'Prompt cache warm-up skipped or failed:', err);
    }

    // Instantiation
    let provider;
    if (providerId === 'gemini') {
      provider = new GeminiProvider();
    } else if (providerId === 'claude') {
      provider = new ClaudeProvider();
    } else {
      provider = new GroqProvider();
    }

    const messages = [
      { role: 'user', content: normQuery } as any
    ];

    const responseSchema = intent.tier === 2 ? TIER2_PLAN_SCHEMA : TIER1_ACTION_SCHEMA;

    // Emit thinking event
    callbacks.onStepEvent({
      stepId: `thinking_${Date.now()}`,
      name: 'LLM Planning',
      status: 'acting',
      why: 'Consulting the brain to generate actions'
    });

    let llmResponseText = '';
    try {
      const chatGen = provider.chat({
        messages,
        tools,
        responseSchema,
        model,
        cacheKey,
        tier: intent.tier
      });
      for await (const chunk of chatGen) {
        if (chunk.text) {
          llmResponseText += chunk.text;
        }
      }
    } catch (err: any) {
      logger.error(MODULE, 'LLM chat request failed:', err);
      callbacks.onStepEvent({
        stepId: `thinking_${Date.now()}`,
        name: 'LLM Planning',
        status: 'failed',
        error: err.message
      });
      throw err;
    }

    // Parse the JSON output
    let payload: any;
    try {
      const cleanJson = this.extractJson(llmResponseText);
      payload = JSON.parse(cleanJson);
    } catch (err: any) {
      logger.error(MODULE, `Failed to parse LLM JSON response: "${llmResponseText}"`, err);
      callbacks.onStepEvent({
        stepId: `thinking_${Date.now()}`,
        name: 'LLM Planning',
        status: 'failed',
        error: `Invalid JSON response: ${err.message}`
      });
      throw new Error(`Invalid JSON response from LLM: ${err.message}`);
    }

    callbacks.onStepEvent({
      stepId: `thinking_${Date.now()}`,
      name: 'LLM Planning',
      status: 'done',
      result: 'Plan received'
    });

    // Execute actions
    if (intent.tier === 2 && Array.isArray(payload.steps)) {
      const stepResults = [];
      for (let i = 0; i < payload.steps.length; i++) {
        const step = payload.steps[i];
        const stepId = `step_${Date.now()}_${i}`;
        const result = await this.executeAction(queryId, stepId, step.t, step.a, step.why || `Step ${i + 1}`, callbacks, step.fb);
        stepResults.push(result);
        if (result.status === 'failed') {
          break; // Stop planning sequence if any step fails
        }
      }
      return stepResults;
    } else {
      // Tier 1 single action
      const stepId = `step_${Date.now()}`;
      return this.executeAction(queryId, stepId, payload.t, payload.a, 'Single Action', callbacks, payload.fb);
    }
  }

  private sanitizeJsonString(raw: string): string {
    let clean = raw.trim();

    // Strip single-line comments: // ...
    clean = clean.replace(/\/\/.*$/gm, '');

    // Strip multi-line comments: /* ... */
    clean = clean.replace(/\/\*[\s\S]*?\*\//g, '');

    // Remove trailing commas before closing braces/brackets
    clean = clean.replace(/,(\s*[\]}])/g, '$1');

    return clean;
  }

  private extractJson(text: string): string {
    const startIdx = text.indexOf('{');
    const endIdx = text.lastIndexOf('}');
    let rawJson = text.trim();
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      rawJson = text.substring(startIdx, endIdx + 1);
    }
    return this.sanitizeJsonString(rawJson);
  }

  private async executeDeterministicAction(
    queryId: string,
    name: string,
    action: any,
    callbacks: {
      onStepEvent: (event: StepEvent) => void;
      onPendingAction: (payload: PendingActionPayload) => Promise<boolean>;
    }
  ): Promise<any> {
    const stepId = `det_${Date.now()}`;
    
    // Map tool field to registry/executor tool name
    let toolName = '';
    let args: any = {};

    if (action.tool === 'shell') {
      toolName = 'exec';
      args = { c: action.cmd };
    } else if (action.tool === 'desktop') {
      toolName = 'desktop';
      args = { goal: action.goal, app: action.app };
    } else if (action.tool === 'browser') {
      toolName = 'browser';
      args = { goal: action.goal };
    } else if (action.tool === 'msg') {
      const ch = action.ch || 'whatsapp';
      toolName = ch;
      if (ch === 'whatsapp' || ch === 'telegram') {
        args = { op: 'send', to: action.to, text: action.txt };
      } else {
        args = { op: 'send', channel: action.to, text: action.txt };
      }
    }

    return this.executeAction(queryId, stepId, toolName, args, name, callbacks);
  }

  private async executeAction(
    queryId: string,
    stepId: string,
    toolName: string,
    args: any,
    why: string,
    callbacks: {
      onStepEvent: (event: StepEvent) => void;
      onPendingAction: (payload: PendingActionPayload) => Promise<boolean>;
    },
    fallbackTool?: string
  ): Promise<any> {
    // 1. Emit acting event
    callbacks.onStepEvent({
      stepId,
      name: `${toolName} action`,
      status: 'acting',
      why
    });

    // 2. Destructive safety check
    const isDestructive = this.isDestructiveAction(toolName, args);
    if (isDestructive) {
      logger.warn(MODULE, `Action "${toolName}" with args ${JSON.stringify(args)} classified as DESTRUCTIVE.`);
      
      // Halt and await approval
      callbacks.onStepEvent({
        stepId,
        name: `${toolName} action`,
        status: 'acting',
        why: 'Halted: Action is destructive. Awaiting confirmation...'
      });

      const approved = await callbacks.onPendingAction({
        stepId,
        name: toolName,
        args,
        message: `The agent wants to run a potentially destructive action: "${toolName}" with arguments: ${JSON.stringify(args)}. Do you approve?`
      });

      if (!approved) {
        logger.info(MODULE, `Action "${toolName}" DENIED by user.`);
        const eventResult = {
          stepId,
          name: `${toolName} action`,
          status: 'failed' as StepStatus,
          error: 'Action denied by user'
        };
        callbacks.onStepEvent(eventResult);
        return eventResult;
      }
      logger.info(MODULE, `Action "${toolName}" APPROVED by user.`);
    }

    // 3. Execution
    try {
      let resultText = await executeTool(toolName, args);
      
      // Compress large results
      const compressed = compressResult(resultText, toolName);

      const eventResult = {
        stepId,
        name: `${toolName} action`,
        status: 'done' as StepStatus,
        result: compressed
      };
      callbacks.onStepEvent(eventResult);
      return eventResult;
    } catch (err: any) {
      logger.error(MODULE, `Tool execution failed for "${toolName}":`, err);

      if (fallbackTool) {
        logger.info(MODULE, `Attempting fallback tool: "${fallbackTool}"`);
        callbacks.onStepEvent({
          stepId,
          name: `${toolName} action`,
          status: 'acting',
          why: `Primary tool failed, attempting fallback: ${fallbackTool}`
        });

        try {
          let resultText = await executeTool(fallbackTool, args);
          const compressed = compressResult(resultText, fallbackTool);

          const eventResult = {
            stepId,
            name: `${toolName} action (fallback)`,
            status: 'done' as StepStatus,
            result: compressed
          };
          callbacks.onStepEvent(eventResult);
          return eventResult;
        } catch (fbErr: any) {
          logger.error(MODULE, `Fallback execution failed for "${fallbackTool}":`, fbErr);
          const eventResult = {
            stepId,
            name: `${toolName} action`,
            status: 'failed' as StepStatus,
            error: `Both primary and fallback failed. Fallback error: ${fbErr.message}`
          };
          callbacks.onStepEvent(eventResult);
          return eventResult;
        }
      }

      const eventResult = {
        stepId,
        name: `${toolName} action`,
        status: 'failed' as StepStatus,
        error: err.message
      };
      callbacks.onStepEvent(eventResult);
      return eventResult;
    }
  }
}
