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
import { buildTier1ActionSchema, buildTier2PlanSchema } from '../llm/output-schema.js';
import { StepEvent, StepStatus, TaskIntent } from '../brain/types.js';
import { logger } from '../utils/logger.js';

const MODULE = 'ORCHESTRATOR';

function providerEnvVar(providerId: 'gemini' | 'claude' | 'groq'): string {
  if (providerId === 'gemini') return 'GEMINI_API_KEY';
  if (providerId === 'claude') return 'ANTHROPIC_API_KEY';
  return 'GROQ_API_KEY';
}

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
        /\bset-dnsclientserveraddress\b/i,
        /\bregedit\b.*\b(delete|remove|wipe)\b/i,
        /\breg\s+(?:add|delete)\b/i,
        /\b(?:new-itemproperty|set-itemproperty|remove-itemproperty)\b/i,
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
      {
        role: 'user',
        content: `User task: ${normQuery}\nReturn only a JSON execution plan for Dex. Do not answer the task directly, and do not include prose, markdown, or code fences.`
      } as any
    ];

    const allowedToolNames = tools.map(tool => tool.name);
    const responseSchema = intent.tier === 2
      ? buildTier2PlanSchema(allowedToolNames)
      : buildTier1ActionSchema(allowedToolNames);

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
        tier: intent.tier,
        maxTokens: intent.tier === 2 ? 1024 : 512
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
    if (!llmResponseText.trim()) {
      const errorMsg = `The LLM returned an empty response. Please verify that your ${providerEnvVar(providerId)} is valid and that the provider did not block or rate-limit the request.`;
      callbacks.onStepEvent({
        stepId: `thinking_${Date.now()}`,
        name: 'LLM Planning',
        status: 'failed',
        error: errorMsg
      });
      throw new Error(errorMsg);
    }

    let payload: any;
    try {
      payload = this.parseJsonPayload(llmResponseText);
    } catch (err: any) {
      logger.warn(MODULE, `LLM JSON parse failed; attempting local recovery for response: "${llmResponseText}"`, err);
      payload = await this.synthesizeFallbackPayload(rawQuery, normQuery, provider, model);
      if (!payload) {
        callbacks.onStepEvent({
          stepId: `thinking_${Date.now()}`,
          name: 'LLM Planning',
          status: 'failed',
          error: `Invalid JSON response: ${err.message}`
        });
        throw new Error(`Invalid JSON response from LLM: ${err.message}`);
      }
    }

    const recoveredPayload = await this.repairUnusablePayload(payload, rawQuery, normQuery, provider, model);
    payload = recoveredPayload || payload;

    if (!this.payloadHasUsableActions(payload)) {
      const errorMsg = 'The LLM returned a plan with missing tool arguments, and Dex could not recover a safe local plan.';
      callbacks.onStepEvent({
        stepId: `thinking_${Date.now()}`,
        name: 'LLM Planning',
        status: 'failed',
        error: errorMsg
      });
      throw new Error(errorMsg);
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

  private repairJsonLikeString(raw: string): string {
    let repaired = raw;

    // Some text-only models omit commas between object properties even when
    // the surrounding shape is otherwise valid JSON.
    repaired = repaired.replace(
      /(["}\]])(\s*\r?\n\s*)("[^"]+"\s*:)/g,
      '$1,$2$3'
    );

    return this.sanitizeJsonString(repaired);
  }

  private parseJsonPayload(text: string): any {
    const cleanJson = this.extractJson(text);

    try {
      return JSON.parse(cleanJson);
    } catch (firstErr) {
      const repaired = this.repairJsonLikeString(cleanJson);
      if (repaired !== cleanJson) {
        return JSON.parse(repaired);
      }
      throw firstErr;
    }
  }

  private codeToExecCommand(lang: string, code: string): string | null {
    const encoded = Buffer.from(code, 'utf-8').toString('base64');
    const normalizedLang = lang.toLowerCase();

    if (normalizedLang === 'python' || normalizedLang === 'py') {
      return `python -c "import base64; exec(base64.b64decode('${encoded}').decode('utf-8'))"`;
    }

    if (normalizedLang === 'node' || normalizedLang === 'javascript' || normalizedLang === 'js') {
      return `node -e "eval(Buffer.from('${encoded}', 'base64').toString('utf8'))"`;
    }

    return null;
  }

  private hasUsableAction(toolName: string, args: any): boolean {
    const normalizedArgs = this.normalizeToolArgs(toolName, args);

    if (toolName === 'exec') {
      return typeof normalizedArgs?.c === 'string' && normalizedArgs.c.trim().length > 0;
    }

    if (toolName === 'desktop' || toolName === 'browser' || toolName === 'vision') {
      return typeof normalizedArgs?.goal === 'string' && normalizedArgs.goal.trim().length > 0;
    }

    return !!args && typeof args === 'object' && Object.keys(args).length > 0;
  }

  private async repairUnusablePayload(payload: any, rawQuery: string, normQuery: string, provider: any, model: string): Promise<any | null> {
    if (!this.payloadHasUsableActions(payload)) {
      return this.synthesizeFallbackPayload(rawQuery, normQuery, provider, model);
    }

    return null;
  }

  private payloadHasUsableActions(payload: any): boolean {
    if (payload?.steps && Array.isArray(payload.steps)) {
      return payload.steps.length > 0 && payload.steps.every((step: any) => step?.t && this.hasUsableAction(step.t, step.a));
    }

    return !!payload?.t && this.hasUsableAction(payload.t, payload.a);
  }

  private async synthesizeFallbackPayload(rawQuery: string, normQuery: string, provider: any, model: string): Promise<any | null> {
    const appPayload = this.synthesizeAppPayload(normQuery);
    if (appPayload) {
      return appPayload;
    }

    const scriptPayload = await this.synthesizePythonScriptPayload(rawQuery, normQuery, provider, model);
    if (scriptPayload) {
      return scriptPayload;
    }

    return null;
  }

  private synthesizeAppPayload(normQuery: string): any | null {
    const appMatch = normQuery.match(/^(open|launch|start|close|kill|stop)\s+(.+)$/i);
    if (!appMatch) {
      return null;
    }

    const verb = appMatch[1].toLowerCase();
    const appName = appMatch[2].trim();
    if (!appName) {
      return null;
    }

    if (verb === 'open' || verb === 'launch' || verb === 'start') {
      return { t: 'exec', a: { c: `Start-Process "${appName}"` } };
    }

    return { t: 'exec', a: { c: `Stop-Process -Name "${appName}" -Force -ErrorAction SilentlyContinue` } };
  }

  private async synthesizePythonScriptPayload(rawQuery: string, normQuery: string, provider: any, model: string): Promise<any | null> {
    const text = `${rawQuery} ${normQuery}`.toLowerCase();
    const wantsPythonScript =
      /\b(py|python)\b/.test(text) &&
      /\b(program|script|code)\b/.test(text) &&
      /\b(download|downloads)\b/.test(text) &&
      /\b(cmd|command prompt|run)\b/.test(text);

    if (!wantsPythonScript) {
      return null;
    }

    const code = await this.generatePythonCode(rawQuery, provider, model) || this.generateLocalPythonTemplate(normQuery);
    if (!code) {
      return null;
    }

    const fileName = this.pythonFileNameFromQuery(normQuery);
    const escapedCode = code.replace(/'@/g, "'`@");
    const cmd = [
      `$script = Join-Path $env:USERPROFILE 'Downloads\\${fileName}'`,
      `@'\n${escapedCode}\n'@ | Set-Content -LiteralPath $script -Encoding UTF8`,
      'Start-Process notepad.exe -ArgumentList @($script)',
      'Start-Process cmd.exe -ArgumentList @(\'/k\', "python `"$script`"")',
    ].join('; ');

    return { steps: [{ t: 'exec', a: { c: cmd }, why: 'Recover script automation' }] };
  }

  private async generatePythonCode(rawQuery: string, provider: any, model: string): Promise<string | null> {
    let codeText = '';
    try {
      const chatGen = provider.chat({
        messages: [{
          role: 'user',
          content: [
            'Write a complete, beginner-friendly Python console program for this user request.',
            'Return only Python source code. Do not include markdown, prose, or code fences.',
            'The program should ask the user for input at runtime and pause before exiting.',
            `User request: ${rawQuery}`,
          ].join('\n')
        }],
        model,
        tier: 1,
        maxTokens: 1200
      });

      for await (const chunk of chatGen) {
        if (chunk.text) {
          codeText += chunk.text;
        }
      }
    } catch (err) {
      logger.warn(MODULE, 'Fallback Python code generation failed:', err);
      return null;
    }

    return this.extractPythonCode(codeText);
  }

  private extractPythonCode(text: string): string | null {
    let code = text.trim();
    const fenced = code.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
    if (fenced) {
      code = fenced[1].trim();
    }

    if (!code || !/\b(input|print)\s*\(/.test(code)) {
      return null;
    }

    return code;
  }

  private generateLocalPythonTemplate(normQuery: string): string | null {
    const text = normQuery.toLowerCase();

    if (/\bfib(?:o|a)?n?a?c?c?i\b|\bfbanocci\b|\bfibonacci\b/.test(text)) {
      return [
        'def fibonacci(n):',
        '    sequence = []',
        '    a, b = 0, 1',
        '    for _ in range(n):',
        '        sequence.append(a)',
        '        a, b = b, a + b',
        '    return sequence',
        '',
        'count = int(input("Enter how many Fibonacci numbers to generate: "))',
        'if count <= 0:',
        '    print("Please enter a positive number.")',
        'else:',
        '    print("Fibonacci sequence:")',
        '    print(fibonacci(count))',
        'input("Press Enter to exit...")',
      ].join('\n');
    }

    if (/\bprime\b/.test(text)) {
      return [
        'def is_prime(n):',
        '    if n <= 1:',
        '        return False',
        '    if n == 2:',
        '        return True',
        '    if n % 2 == 0:',
        '        return False',
        '    for i in range(3, int(n ** 0.5) + 1, 2):',
        '        if n % i == 0:',
        '            return False',
        '    return True',
        '',
        'number = int(input("Enter a number: "))',
        'if is_prime(number):',
        '    print(f"{number} is a prime number.")',
        'else:',
        '    print(f"{number} is not a prime number.")',
        'input("Press Enter to exit...")',
      ].join('\n');
    }

    if (/\bfactorial\b/.test(text)) {
      return [
        'number = int(input("Enter a non-negative number: "))',
        'if number < 0:',
        '    print("Factorial is not defined for negative numbers.")',
        'else:',
        '    result = 1',
        '    for i in range(2, number + 1):',
        '        result *= i',
        '    print(f"The factorial of {number} is {result}.")',
        'input("Press Enter to exit...")',
      ].join('\n');
    }

    return null;
  }

  private pythonFileNameFromQuery(normQuery: string): string {
    const taskMatch = normQuery.match(/\b(?:to|for)\s+(.+?)(?:\s+in\s+notepad|\s+and\s+save|\s+save|\s+run|$)/i);
    const base = (taskMatch?.[1] || 'generated program')
      .replace(/\b(?:a|an|the|number|program|script|code|of|for|to|check)\b/gi, ' ')
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();

    return `${base || 'generated_program'}.py`;
  }

  private normalizeToolArgs(toolName: string, args: any): any {
    if (!args || typeof args !== 'object') {
      return args;
    }

    switch (toolName) {
      case 'exec': {
        if (typeof args.c === 'string') return args;
        if (typeof args.cmd === 'string') return { ...args, c: args.cmd };
        if (typeof args.command === 'string') return { ...args, c: args.command };
        if (typeof args.lang === 'string' && typeof args.code === 'string') {
          const c = this.codeToExecCommand(args.lang, args.code);
          if (c) return { c };
        }
        return args;
      }

      case 'desktop':
      case 'browser':
      case 'vision': {
        const normalized = { ...args };
        if (typeof normalized.task === 'string' && typeof normalized.goal !== 'string') {
          normalized.goal = normalized.task;
        }
        if (typeof normalized.query === 'string' && typeof normalized.goal !== 'string') {
          normalized.goal = normalized.query;
        }
        if (typeof normalized.app === 'string' && typeof normalized.app_hint !== 'string') {
          normalized.app_hint = normalized.app;
        }
        if (typeof normalized.goal === 'string') return normalized;
        return args;
      }

      default:
        return args;
    }
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
    const displayName = action.label || name;

    if (action.tool === 'shell') {
      toolName = 'exec';
      args = { c: action.cmd };
    } else if (action.tool === 'desktop') {
      toolName = 'desktop';
      const normalizedArgs = this.normalizeToolArgs('desktop', {
        goal: action.goal,
        app_hint: action.app_hint,
      });

      if (action.cmd || action.app) {
        const launchCommand = action.cmd || `Start-Process "${action.app}"`;
        const launchStep = await this.executeAction(
          queryId,
          `${stepId}_launch`,
          'exec',
          { c: launchCommand },
          `Open ${action.app_hint || action.app || 'desktop app'}`,
          callbacks,
          undefined,
          `Launch ${action.app_hint || action.app || 'Desktop App'}`
        );

        if (launchStep.status !== 'done') {
          return launchStep;
        }
      }

      args = normalizedArgs;
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

    return this.executeAction(queryId, stepId, toolName, args, name, callbacks, undefined, displayName);
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
    fallbackTool?: string,
    displayName?: string
  ): Promise<any> {
    const normalizedArgs = this.normalizeToolArgs(toolName, args);
    const eventName = displayName || `${toolName} action`;

    // 1. Emit acting event
    callbacks.onStepEvent({
      stepId,
      name: eventName,
      status: 'acting',
      why
    });

    // 2. Destructive safety check
    const isDestructive = this.isDestructiveAction(toolName, normalizedArgs);
    if (isDestructive) {
      logger.warn(MODULE, `Action "${toolName}" with args ${JSON.stringify(normalizedArgs)} classified as DESTRUCTIVE.`);
      
      // Halt and await approval
      callbacks.onStepEvent({
        stepId,
        name: eventName,
        status: 'acting',
        why: 'Halted: Action is destructive. Awaiting confirmation...'
      });

      const approved = await callbacks.onPendingAction({
        stepId,
        name: toolName,
        args: normalizedArgs,
        message: `The agent wants to run a potentially destructive action: "${toolName}" with arguments: ${JSON.stringify(normalizedArgs)}. Do you approve?`
      });

      if (!approved) {
        logger.info(MODULE, `Action "${toolName}" DENIED by user.`);
        const eventResult = {
          stepId,
          name: eventName,
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
      let resultText = await executeTool(toolName, normalizedArgs);
      
      // Compress large results
      const compressed = compressResult(resultText, toolName);

      const eventResult = {
        stepId,
        name: eventName,
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
          name: eventName,
          status: 'acting',
          why: `Primary tool failed, attempting fallback: ${fallbackTool}`
        });

        try {
          const fallbackArgs = this.normalizeToolArgs(fallbackTool, normalizedArgs);
          let resultText = await executeTool(fallbackTool, fallbackArgs);
          const compressed = compressResult(resultText, fallbackTool);

          const eventResult = {
            stepId,
            name: `${eventName} (fallback)`,
            status: 'done' as StepStatus,
            result: compressed
          };
          callbacks.onStepEvent(eventResult);
          return eventResult;
        } catch (fbErr: any) {
          logger.error(MODULE, `Fallback execution failed for "${fallbackTool}":`, fbErr);
          const eventResult = {
            stepId,
            name: eventName,
            status: 'failed' as StepStatus,
            error: `Both primary and fallback failed. Fallback error: ${fbErr.message}`
          };
          callbacks.onStepEvent(eventResult);
          return eventResult;
        }
      }

      const eventResult = {
        stepId,
        name: eventName,
        status: 'failed' as StepStatus,
        error: err.message
      };
      callbacks.onStepEvent(eventResult);
      return eventResult;
    }
  }
}
