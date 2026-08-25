import * as fs from 'fs';
import { execSync } from 'child_process';
import { AgentResult, ExecutionStep, VerificationResult } from '../events/types';

export async function verifyStep(
  step: ExecutionStep,
  _beforeState: unknown,
  agentResult?: AgentResult,
): Promise<VerificationResult> {
  if (step.capability === 'can_control_os') return verifyOsStep(step);
  if (step.capability === 'can_control_gui') return verifyGuiStep(step);
  if (step.capability === 'can_browse_web') return verifyBrowserStep(step, agentResult);
  if (step.capability.startsWith('can_access_')) return verifyWorkspaceStep(step, agentResult);
  return {
    status: 'UNVERIFIABLE',
    reason: `No verification policy for capability: ${step.capability}`,
  };
}

// ── web ──────────────────────────────────────────────────────────────────────

const BROWSER_READS = new Set(['navigate', 'read_page', 'extract']);

/**
 * The browser process runs the actual check against the live DOM before the
 * page is torn down — that is the only moment the truth is still on screen.
 * What arrives here is the recorded outcome of that check, so this function's
 * job is to insist a check happened at all rather than to trust the agent.
 */
function verifyBrowserStep(
  step: ExecutionStep,
  agentResult?: AgentResult,
): VerificationResult {
  if (BROWSER_READS.has(step.action)) {
    return { status: 'VERIFIED', reason: 'Read-only browsing — nothing changed to verify' };
  }

  const data = (agentResult?.data ?? {}) as {
    verification?: { passed: boolean; checks?: Array<{ check: string; passed: boolean }> } | null;
    url?: string;
    text?: string;
    title?: string;
  };

  if (data.verification) {
    const failed = (data.verification.checks ?? [])
      .filter((c) => !c.passed)
      .map((c) => c.check);

    if (data.verification.passed) {
      return {
        status: 'VERIFIED',
        reason: `Live page confirmed: ${(data.verification.checks ?? [])
          .map((c) => c.check)
          .join('; ')}`,
        afterState: data.url,
      };
    }
    return {
      status: 'FAILED',
      reason: `Page did not confirm: ${failed.join('; ') || 'no checks passed'}`,
      afterState: data.url,
    };
  }

  // click / type return a fresh snapshot; if the plan said what to expect,
  // check it here rather than taking the click's word for it.
  const expected = expectations(step);
  if (expected.length > 0 && (data.url !== undefined || data.text !== undefined)) {
    const checks = expected.map((e) => ({
      check: e.label,
      passed: e.test(data.url ?? '', data.text ?? ''),
    }));
    const failed = checks.filter((c) => !c.passed).map((c) => c.check);
    return failed.length === 0
      ? {
          status: 'VERIFIED',
          reason: `Page confirmed: ${checks.map((c) => c.check).join('; ')}`,
          afterState: data.url,
        }
      : {
          status: 'FAILED',
          reason: `Page did not confirm: ${failed.join('; ')}`,
          afterState: data.url,
        };
  }

  return {
    status: 'UNVERIFIABLE',
    reason:
      'No verification hints on this step — add verify_url_contains, ' +
      'verify_text_on_page or verify_selector so success can be checked',
  };
}

function expectations(
  step: ExecutionStep,
): Array<{ label: string; test: (url: string, text: string) => boolean }> {
  const params = step.params as {
    verify_url_contains?: string;
    verify_text_on_page?: string;
  };
  const out: Array<{ label: string; test: (url: string, text: string) => boolean }> = [];

  if (params.verify_url_contains) {
    const needle = params.verify_url_contains.toLowerCase();
    out.push({
      label: `url contains "${params.verify_url_contains}"`,
      test: (url) => url.toLowerCase().includes(needle),
    });
  }
  if (params.verify_text_on_page) {
    const needle = params.verify_text_on_page.toLowerCase();
    out.push({
      label: `page shows "${params.verify_text_on_page}"`,
      test: (_url, text) => text.toLowerCase().includes(needle),
    });
  }
  return out;
}

// ── workspace ────────────────────────────────────────────────────────────────

/**
 * A SaaS API returning 200 is not proof the owner's calendar has an event on
 * it. The Workspace Agent fetches the created resource back through a
 * different tool; this reads that verdict and refuses to upgrade "could not
 * check" into "worked".
 */
function verifyWorkspaceStep(
  step: ExecutionStep,
  agentResult?: AgentResult,
): VerificationResult {
  const data = (agentResult?.data ?? {}) as {
    readBack?: { verified: boolean; method: string; id?: string };
    tool?: string;
  };

  if (!data.readBack) {
    return {
      status: 'UNVERIFIABLE',
      reason: `${step.action} returned no read-back information`,
    };
  }

  if (data.readBack.verified) {
    return {
      status: 'VERIFIED',
      reason: data.readBack.id
        ? `${data.readBack.method} confirmed ${data.readBack.id}`
        : data.readBack.method,
      afterState: data.readBack.id,
    };
  }

  // Deliberately UNVERIFIABLE, not FAILED: the write may well have landed. The
  // Orchestrator will let the task continue and the owner will see the caveat,
  // which beats retrying and sending the same email twice.
  return {
    status: 'UNVERIFIABLE',
    reason: `Could not confirm ${step.action} — ${data.readBack.method}`,
    afterState: data.readBack.id,
  };
}

function verifyOsStep(step: ExecutionStep): VerificationResult {
  switch (step.action) {
    case 'set_dns':
      return verifyDns(step.params as { primary: string; secondary?: string });
    case 'set_power_plan':
      return verifyPowerPlan(step.params as { plan: string });
    case 'set_volume':
      return { status: 'UNVERIFIABLE', reason: 'Volume read-back not yet implemented' };
    case 'set_wifi':
      return { status: 'UNVERIFIABLE', reason: 'WiFi state read-back not yet implemented' };
    case 'get_dns':
    case 'get_power_plan':
    case 'get_volume':
    case 'get_wifi_status':
    case 'list_processes':
      return { status: 'VERIFIED', reason: 'Read-only action — no state to verify' };
    case 'kill_process':
      return verifyProcessGone(step.params as { name?: string; pid?: number });
    default:
      return {
        status: 'UNVERIFIABLE',
        reason: `No verification logic for action: ${step.action}`,
      };
  }
}

function verifyDns(params: { primary: string; secondary?: string }): VerificationResult {
  try {
    const output = execSync('netsh interface ipv4 show dnsservers', {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (output.includes(params.primary)) {
      return {
        status: 'VERIFIED',
        reason: `DNS primary ${params.primary} confirmed in netsh output`,
        afterState: output.trim(),
      };
    }
    return {
      status: 'FAILED',
      reason: `Expected DNS ${params.primary} not found in current DNS config`,
      afterState: output.trim(),
    };
  } catch (err) {
    return {
      status: 'UNVERIFIABLE',
      reason: `Could not read DNS state: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function verifyPowerPlan(params: { plan: string }): VerificationResult {
  try {
    const output = execSync('powercfg /getactivescheme', {
      encoding: 'utf8',
      timeout: 10000,
    }).toLowerCase();
    const planName = params.plan.replace(/_/g, ' ');
    if (output.includes(planName)) {
      return {
        status: 'VERIFIED',
        reason: `Power plan "${params.plan}" is active`,
        afterState: output.trim(),
      };
    }
    return {
      status: 'FAILED',
      reason: `Power plan "${params.plan}" not active`,
      afterState: output.trim(),
    };
  } catch (err) {
    return {
      status: 'UNVERIFIABLE',
      reason: `Could not read power plan state: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function verifyGuiStep(step: ExecutionStep): VerificationResult {
  const params = step.params as {
    verify_file?: string;
    verify_text_in_file?: { path: string; text: string };
  };

  if (params.verify_file) {
    if (!fs.existsSync(params.verify_file)) {
      return { status: 'FAILED', reason: `Expected file not found: ${params.verify_file}` };
    }
    const hint = params.verify_text_in_file;
    if (hint) {
      try {
        const content = fs.readFileSync(hint.path || params.verify_file, 'utf8');
        if (!content.includes(hint.text)) {
          return {
            status: 'FAILED',
            reason: `File exists but does not contain expected text: "${hint.text}"`,
          };
        }
      } catch (err) {
        return { status: 'UNVERIFIABLE', reason: `Cannot read file: ${err}` };
      }
    }
    return { status: 'VERIFIED', reason: `File exists: ${params.verify_file}` };
  }

  return {
    status: 'UNVERIFIABLE',
    reason: 'No GUI verification hints provided (add verify_file to step params)',
  };
}

function verifyProcessGone(params: { name?: string; pid?: number }): VerificationResult {
  try {
    const list = execSync('tasklist /fo csv /nh', { encoding: 'utf8', timeout: 10000 });
    if (params.name && list.toLowerCase().includes(params.name.toLowerCase())) {
      return { status: 'FAILED', reason: `Process "${params.name}" still running` };
    }
    if (params.pid && list.includes(String(params.pid))) {
      return { status: 'FAILED', reason: `PID ${params.pid} still running` };
    }
    return { status: 'VERIFIED', reason: 'Process no longer in task list' };
  } catch (err) {
    return {
      status: 'UNVERIFIABLE',
      reason: `Could not check process list: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
