import * as fs from 'fs';
import * as path from 'path';
import { ExecutionPlan } from '../events/types';
import { logDirectory } from './file_log';

/**
 * A durable record of every plan the Brain produced and the Orchestrator
 * actually started running — one JSON object per line, not the general
 * core.log's free-text tee.
 *
 * This did not exist before: `Orchestrator.execute()` published a
 * 'planning' event with the full plan attached, but the only subscriber
 * (ws_server.ts) forwards it to the live UI and forgets it the moment
 * nobody is connected. So the one artifact that would actually show a
 * *pattern* across many tasks — the Brain kept re-deriving a redundant
 * step, an adapter's account-extraction kept missing one phrasing, a
 * routing rule kept getting ignored — never survived past the session
 * that produced it. Fixing that one plan fixes that one task; a log of
 * every approved plan is what turns into fixing the *agent*.
 *
 * JSONL, not the pretty-printed shape a human reads live: this is meant
 * to be grepped and scripted against later, not read top to bottom.
 */

const MAX_BYTES = 5 * 1024 * 1024;

export function logApprovedPlan(plan: ExecutionPlan): void {
  try {
    const dir = logDirectory();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'plans.log');

    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
      fs.renameSync(file, `${file}.1`);
    }

    const record = {
      timestamp: new Date().toISOString(),
      requestId: plan.requestId,
      sessionId: plan.sessionId ?? '',
      unattended: plan.unattended === true,
      intent: plan.intent,
      steps: plan.steps.map((step) => ({
        id: step.id,
        capability: step.capability,
        action: step.action,
        params: step.params,
        dependsOn: step.dependsOn,
        confirmationTier: step.confirmationTier,
      })),
    };

    fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
  } catch {
    // A missing/locked plans.log must never be why a task itself fails —
    // this is a record of what ran, not part of running it.
  }
}
