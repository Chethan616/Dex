import * as fs from 'fs';
import { execSync } from 'child_process';
import { ExecutionStep, VerificationResult } from '../events/types';

export async function verifyStep(
  step: ExecutionStep,
  _beforeState: unknown,
): Promise<VerificationResult> {
  if (step.capability === 'can_control_os') return verifyOsStep(step);
  if (step.capability === 'can_control_gui') return verifyGuiStep(step);
  return {
    status: 'UNVERIFIABLE',
    reason: `No verification policy for capability: ${step.capability}`,
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
