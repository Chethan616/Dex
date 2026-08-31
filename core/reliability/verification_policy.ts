import * as fs from 'fs';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { AgentResult, ExecutionStep, VerificationResult } from '../events/types';

export async function verifyStep(
  step: ExecutionStep,
  _beforeState: unknown,
  agentResult?: AgentResult,
): Promise<VerificationResult> {
  if (step.capability === 'can_control_os') return verifyOsStep(step, agentResult);
  if (step.capability === 'can_control_files') return verifyFileStep(step, agentResult);
  if (step.capability === 'can_control_app') return verifyAppStep(step, agentResult);
  if (step.capability === 'can_control_gui') return verifyGuiStep(step);
  if (step.capability === 'can_browse_web') return verifyBrowserStep(step, agentResult);
  if (step.capability.startsWith('can_access_')) return verifyWorkspaceStep(step, agentResult);
  return {
    status: 'UNVERIFIABLE',
    reason: `No verification policy for capability: ${step.capability}`,
  };
}

// ── applications (UI Automation) ─────────────────────────────────────────────

const APP_READS = new Set(['list_elements', 'read_element', 'window_state', 'wait_for']);

/**
 * The strongest verification in Dex, and the cheapest.
 *
 * The vision tier can only ask "does a file exist afterwards". This tier reads
 * the control it just touched straight back out of the accessibility tree, so
 * "the text was set" is a fact about the live UI rather than an agent's report
 * of its own success. The driver does that read-back at the moment of writing —
 * the only moment it is knowable — and this function holds it to it.
 */
function verifyAppStep(
  step: ExecutionStep,
  agentResult?: AgentResult,
): VerificationResult {
  if (APP_READS.has(step.action)) {
    const data = asRecord(agentResult?.data);
    if (step.action === 'read_element') {
      const element = asRecord(data?.element);
      const name = typeof element?.name === 'string' && element.name
        ? element.name
        : String(step.params.name ?? 'element');

      if (data?.redacted === true) {
        return {
          status: 'VERIFIED',
          reason: `Read "${name}" — sensitive value redacted`,
        };
      }

      if (data && Object.prototype.hasOwnProperty.call(data, 'value')) {
        const value = data.value;
        return {
          status: 'VERIFIED',
          reason: `Read "${name}" = ${displayValue(value)}`,
          afterState: value,
        };
      }
    }
    return { status: 'VERIFIED', reason: 'Read-only UI Automation query' };
  }

  const data = (agentResult?.data ?? {}) as {
    verified?: boolean;
    wrote?: string;
    read_back?: string;
    method?: string;
    was?: boolean;
    now?: boolean;
    element?: { name?: string };
    path?: string[];
  };

  if (step.action === 'set_text') {
    if (data.verified === true) {
      return {
        status: 'VERIFIED',
        reason: `Field read back exactly as written ("${truncate(data.wrote ?? '')}")`,
        afterState: data.read_back,
      };
    }
    // Some controls legitimately refuse to report their value back. That is
    // "could not check", not "worked" — the Orchestrator continues but the
    // owner sees the caveat instead of a false tick.
    if (!data.read_back) {
      return {
        status: 'UNVERIFIABLE',
        reason: `${step.action} completed but the control would not report its value back`,
      };
    }
    return {
      status: 'FAILED',
      reason:
        `Field does not contain what was written — wanted "${truncate(data.wrote ?? '')}", ` +
        `got "${truncate(data.read_back)}"`,
      afterState: data.read_back,
    };
  }

  if (step.action === 'toggle') {
    return data.verified
      ? { status: 'VERIFIED', reason: `Toggle is now ${data.now ? 'on' : 'off'}` }
      : {
          status: 'FAILED',
          reason: `Toggle did not change — still ${data.now ? 'on' : 'off'}`,
        };
  }

  if (step.action === 'click_element') {
    const name = data.element?.name ?? step.params.name;
    // A click is verified by the fact that a real control accepted a real
    // invocation. Whether the app then did the right thing is the *next*
    // step's business to check.
    return data.method
      ? {
          status: 'VERIFIED',
          reason: `Invoked "${name}" via ${data.method}`,
          afterState: data.method,
        }
      : { status: 'UNVERIFIABLE', reason: 'Click reported no activation method' };
  }

  if (step.action === 'select_menu') {
    return data.path?.length
      ? { status: 'VERIFIED', reason: `Menu path taken: ${data.path.join(' > ')}` }
      : { status: 'FAILED', reason: 'Menu path was not taken' };
  }

  return { status: 'UNVERIFIABLE', reason: `No verification policy for ${step.action}` };
}

function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)';
  const raw = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  return truncate(raw.replace(/\s+/g, ' ').trim(), 180);
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

async function verifyOsStep(step: ExecutionStep, agentResult?: AgentResult): Promise<VerificationResult> {
  switch (step.action) {
    case 'set_dns':
      return verifyDns(
        step.params as { primary?: string; secondary?: string; dhcp?: boolean; adapter?: string },
        agentResult,
      );
    case 'set_power_plan':
      return verifyPowerPlan(step.params as { plan: string });
    case 'set_volume':
      return verifyVolume(step, agentResult);
    case 'set_wifi':
      return verifyWifi(step.params as { enabled?: boolean });
    case 'get_dns':
    case 'get_power_plan':
    case 'get_volume':
    case 'get_wifi_status':
    case 'list_processes':
      return { status: 'VERIFIED', reason: 'Read-only action — no state to verify' };
    case 'kill_process':
      return verifyProcessGone(step.params as { name?: string; pid?: number });
    case 'launch_app':
      return verifyAppOpen(step, agentResult);
    case 'close_app':
      return verifyAppClosed(step, agentResult);
    default:
      return {
        status: 'UNVERIFIABLE',
        reason: `No verification logic for action: ${step.action}`,
      };
  }
}

function verifyFileStep(step: ExecutionStep, agentResult?: AgentResult): VerificationResult {
  switch (step.action) {
    case 'find_files':
      return verifyFileSearch(agentResult);
    case 'write_file':
      return verifyFileWrite(agentResult);
    case 'run_program':
      return verifyProgram(agentResult);
    default:
      return {
        status: 'UNVERIFIABLE',
        reason: `No verification logic for file action: ${step.action}`,
      };
  }
}

function verifyFileSearch(agentResult?: AgentResult): VerificationResult {
  const data = asRecord(agentResult?.data);
  const rawMatches = Array.isArray(data?.matches) ? data.matches : [];
  const matches = rawMatches
    .map((item) => asRecord(item)?.path)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const count = typeof data?.count === 'number' ? data.count : matches.length;
  const opened = typeof data?.opened_location === 'string' ? data.opened_location : '';
  const shown = matches.slice(0, 5).join(', ');
  const suffix = shown ? `: ${shown}${matches.length > 5 ? ', …' : ''}` : '';
  const location = opened ? `; opened ${opened}` : '';
  return {
    status: 'VERIFIED',
    reason: `Found ${count} matching file${count === 1 ? '' : 's'}${suffix}${location}`,
    afterState: matches,
  };
}

function verifyFileWrite(agentResult?: AgentResult): VerificationResult {
  const data = asRecord(agentResult?.data);
  const file = typeof data?.path === 'string' ? data.path : '';
  if (!file || !fs.existsSync(file)) {
    return { status: 'FAILED', reason: `Written file was not found: ${file || '(no path)'}` };
  }

  try {
    const bytes = fs.readFileSync(file);
    const expectedBytes = typeof data?.bytes === 'number' ? data.bytes : bytes.length;
    const expectedHash = typeof data?.sha256 === 'string' ? data.sha256 : '';
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== expectedBytes || (expectedHash && actualHash !== expectedHash)) {
      return {
        status: 'FAILED',
        reason: `File read-back differs from what was written: ${file}`,
        afterState: { bytes: bytes.length, sha256: actualHash },
      };
    }
    return {
      status: 'VERIFIED',
      reason: `Wrote and read back ${file} (${bytes.length} bytes)`,
      afterState: { bytes: bytes.length, sha256: actualHash },
    };
  } catch (err) {
    return { status: 'UNVERIFIABLE', reason: `Could not read back ${file}: ${err}` };
  }
}

function verifyProgram(agentResult?: AgentResult): VerificationResult {
  const data = asRecord(agentResult?.data);
  const file = typeof data?.path === 'string' ? data.path : 'program';
  if (data?.background === true) {
    const pid = Number(data.pid);
    if (!Number.isInteger(pid) || pid <= 0) {
      return { status: 'FAILED', reason: `${file} returned no running process id` };
    }
    try {
      const listing = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
      });
      return listing.includes(String(pid))
        ? { status: 'VERIFIED', reason: `Running ${file} (pid ${pid})`, afterState: pid }
        : { status: 'FAILED', reason: `${file} exited before verification`, afterState: pid };
    } catch (err) {
      return { status: 'UNVERIFIABLE', reason: `Could not verify ${file}: ${err}` };
    }
  }

  return Number(data?.returncode) === 0
    ? { status: 'VERIFIED', reason: `Ran ${file} successfully`, afterState: data?.stdout }
    : { status: 'FAILED', reason: `${file} returned a non-zero exit code` };
}

/**
 * The audio handler reads the endpoint back after setting it, so this checks a
 * fact rather than an intention. Windows snaps to the nearest representable
 * step, so an exact match is not required — being within a step of what was
 * asked for is the honest bar.
 */
function verifyVolume(step: ExecutionStep, agentResult?: AgentResult): VerificationResult {
  const data = agentResult?.data as { level?: number; requested?: number } | undefined;
  if (data?.level == null) {
    return { status: 'UNVERIFIABLE', reason: 'Volume handler returned no read-back' };
  }

  const wanted = Number(data.requested ?? step.params.level);
  const actual = Number(data.level);

  return Math.abs(actual - wanted) <= 1
    ? { status: 'VERIFIED', reason: `Endpoint reports ${actual}%`, afterState: actual }
    : {
        status: 'FAILED',
        reason: `Asked for ${wanted}% but the endpoint reports ${actual}%`,
        afterState: actual,
      };
}

/**
 * Read DNS back per adapter, not as one blob of text.
 *
 * This used to ask whether the primary appeared anywhere in the whole netsh
 * output. On this machine Ethernet is statically set to 8.8.8.8 while Wi-Fi
 * takes its DNS from DHCP, so "set Wi-Fi to 8.8.8.8" would have verified off
 * Ethernet's pre-existing value while Wi-Fi was untouched. A check that passes
 * without the action having happened is worse than no check, because it is
 * trusted.
 */
function verifyDns(
  params: { primary?: string; secondary?: string; dhcp?: boolean; adapter?: string },
  agentResult?: AgentResult,
): VerificationResult {
  let table: Record<string, { source: string; servers: string[] }>;
  try {
    table = parseDnsTable(
      execSync('netsh interface ipv4 show dnsservers', {
        encoding: 'utf8',
        timeout: 10000,
      }),
    );
  } catch (err) {
    return {
      status: 'UNVERIFIABLE',
      reason: `Could not read DNS state: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Check exactly the adapters the handler says it configured. Falling back to
  // "every adapter" would reintroduce the bug in a quieter form.
  const data = agentResult?.data as { adapters?: string[] } | undefined;
  const adapters = data?.adapters ?? (params.adapter ? [params.adapter] : []);
  if (adapters.length === 0) {
    return {
      status: 'UNVERIFIABLE',
      reason: 'set_dns did not report which adapters it configured',
    };
  }

  const wrong: string[] = [];
  for (const adapter of adapters) {
    const entry = table[adapter];
    if (!entry) {
      wrong.push(`${adapter}: not present in netsh output`);
      continue;
    }
    if (params.dhcp) {
      if (entry.source !== 'dhcp') wrong.push(`${adapter}: still ${entry.source}`);
    } else if (!params.primary) {
      wrong.push(`${adapter}: no primary was requested`);
    } else if (!entry.servers.includes(params.primary)) {
      wrong.push(
        `${adapter}: expected ${params.primary}, found ${
          entry.servers.length ? entry.servers.join(', ') : 'nothing'
        }`,
      );
    }
  }

  const state = Object.fromEntries(adapters.map((a) => [a, table[a]]));

  return wrong.length === 0
    ? {
        status: 'VERIFIED',
        reason: params.dhcp
          ? `${adapters.join(', ')} back on DHCP`
          : `${params.primary} confirmed on ${adapters.join(', ')}`,
        afterState: state,
      }
    : { status: 'FAILED', reason: wrong.join('; '), afterState: state };
}

/**
 * A disabled wireless adapter disappears from `netsh wlan show interfaces`
 * entirely — the command reports there is no wireless interface on the system.
 * That absence is the read-back, and it is independent of what the handler
 * claimed, which is the point.
 */
function verifyWifi(params: { enabled?: boolean }): VerificationResult {
  const wanted = params.enabled !== false;
  let output = '';
  try {
    output = execSync('netsh wlan show interfaces', {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // netsh exits non-zero when the WLAN service has nothing to report, which
    // is exactly the "disabled" observation rather than a failure to observe.
    output = (err as { stdout?: string }).stdout ?? '';
  }

  const present = /^\s*Name\s*:/m.test(output);

  if (present === wanted) {
    return {
      status: 'VERIFIED',
      reason: wanted
        ? 'A wireless interface is present and enabled'
        : 'No wireless interface is present — adapter is disabled',
      afterState: output.trim().slice(0, 400),
    };
  }

  return {
    status: 'FAILED',
    reason: wanted
      ? 'Asked to enable wifi but no wireless interface is present'
      : 'Asked to disable wifi but a wireless interface is still present',
    afterState: output.trim().slice(0, 400),
  };
}

/**
 * netsh groups DNS under "Configuration for interface <name>", then reports
 * either a DHCP line or a static one, with additional servers on their own
 * continuation lines.
 */
function parseDnsTable(raw: string): Record<string, { source: string; servers: string[] }> {
  const table: Record<string, { source: string; servers: string[] }> = {};
  let current: string | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const header = line.trim().match(/^Configuration for interface "(.+)"$/);
    if (header) {
      current = header[1];
      table[current] = { source: 'unknown', servers: [] };
      continue;
    }
    if (!current) continue;

    const addresses = (value: string) =>
      value.match(/\d+\.\d+\.\d+\.\d+/g) ?? [];

    if (line.includes('through DHCP')) {
      table[current].source = 'dhcp';
      table[current].servers = addresses(line);
    } else if (line.includes('Statically Configured')) {
      table[current].source = 'static';
      table[current].servers = addresses(line);
    } else if (/^\s+\d+\.\d+\.\d+\.\d+\s*$/.test(line)) {
      table[current].servers.push(line.trim());
    }
  }

  return table;
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

/**
 * A launch is verified by a window existing, not by the launcher returning.
 *
 * Packaged apps make that distinction matter: `calc.exe` starts Calculator and
 * exits immediately, so a process check finds nothing while the app is plainly
 * on screen. The window is the thing the owner asked for.
 */
async function verifyAppOpen(step: ExecutionStep, agentResult?: AgentResult): Promise<VerificationResult> {
  const requested = String((step.params as { name?: string }).name ?? '');
  const launched = String((agentResult?.data as { launched?: string })?.launched ?? requested);

  const needles = [requested, launched.replace(/\.exe$/i, '')]
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);

  // A launcher returning and a window being visible are different events.
  // Poll the read-only window list for a short bounded period so a slow app is
  // not started again while the first instance is still appearing.
  const deadline = Date.now() + 5_000;
  let titles: string[] | null = null;
  while (Date.now() <= deadline) {
    titles = windowTitles();
    if (titles === null) {
      return { status: 'UNVERIFIABLE', reason: 'Could not read the window list' };
    }
    const hit = titles.find((t) => needles.some((n) => t.toLowerCase().includes(n)));
    if (hit) {
      return { status: 'VERIFIED', reason: `Window open: "${hit}"`, afterState: hit };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return {
    status: 'FAILED',
    reason: `${requested} was launched but no window appeared`,
    afterState: titles?.slice(0, 8) ?? [],
  };
}

/** The mirror image: the window is gone. */
function verifyAppClosed(step: ExecutionStep, agentResult?: AgentResult): VerificationResult {
  const requested = String((step.params as { name?: string }).name ?? '')
    .replace(/\.exe$/i, '')
    .trim()
    .toLowerCase();

  const titles = windowTitles();
  if (titles === null) {
    return { status: 'UNVERIFIABLE', reason: 'Could not read the window list' };
  }

  const still = titles.find((t) => requested && t.toLowerCase().includes(requested));
  if (!still) {
    const closed = (agentResult?.data as { closed?: unknown })?.closed;
    return {
      status: 'VERIFIED',
      reason: `No window matching "${requested}" remains`,
      afterState: closed,
    };
  }

  // close_app asks politely rather than killing, so an unsaved-changes prompt
  // legitimately keeps the window up. That is not a failure to report as one —
  // the owner has been asked a question and needs to answer it.
  return {
    status: 'UNVERIFIABLE',
    reason: `"${still}" is still open — it may be asking about unsaved changes`,
    afterState: still,
  };
}

/** Visible top-level window titles, or null if they cannot be read. */
function windowTitles(): string[] | null {
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-Process | Where-Object { $_.MainWindowTitle } | ' +
        'Select-Object -ExpandProperty MainWindowTitle"',
      { encoding: 'utf8', timeout: 15000, windowsHide: true },
    );
    return out.split(String.fromCharCode(10))
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
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
