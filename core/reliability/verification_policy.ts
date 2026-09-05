import * as fs from 'fs';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { AgentResult, ExecutionStep, VerificationResult } from '../events/types';
import { meaningOf } from './exit_codes';

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
  if (step.capability === 'can_deliver') return verifyDelivery(agentResult);
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

  if (step.action === 'draw_strokes') {
    const drawing = data as unknown as { drawn?: number; points?: number; cancelled?: boolean };
    if (drawing.cancelled) {
      return { status: 'FAILED', reason: `Stopped after ${drawing.drawn ?? 0} strokes` };
    }
    // Verified by strokes actually delivered, not by the call returning. A
    // drawing that reports zero strokes drew nothing, whatever it says.
    return (drawing.drawn ?? 0) > 0
      ? {
          status: 'VERIFIED',
          reason: `Drew ${drawing.drawn} strokes (${drawing.points ?? 0} points)`,
          afterState: drawing.drawn,
        }
      : { status: 'FAILED', reason: 'No strokes were drawn' };
  }

  if (step.action === 'set_value') {
    const slider = data as unknown as {
      verified?: boolean; was?: number; now?: number;
      set?: number; wanted?: number; clamped?: boolean; range?: [number, number];
    };
    if (slider.verified) {
      const note = slider.clamped
        ? ` (asked for ${slider.wanted}, clamped into ${slider.range?.join('-')})`
        : '';
      return {
        status: 'VERIFIED',
        reason: `Slider read back at ${slider.now}${note}`,
        afterState: slider.now,
      };
    }
    // A slider bound to something that rejects the value snaps straight back,
    // and the only thing that sees it is the read-back.
    return {
      status: 'FAILED',
      reason: `Slider did not hold the value — set ${slider.set}, reads ${slider.now}`,
      afterState: slider.now,
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

const BROWSER_READS = new Set([
  'navigate', 'read_page', 'extract', 'screenshot', 'session_status', 'map_page',
]);

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

  // Opening the owner's browser.
  //
  // No page changed, so there is no DOM to check. What there is to check is
  // whether the extension attached, because that is the entire point of the
  // step - a window that opened and did not attach has not made the next step
  // possible, and calling it verified would hide that.
  if (step.action === 'open_browser') {
    const data = (agentResult?.data ?? {}) as Record<string, unknown>;
    return data.attached === true
      ? { status: 'VERIFIED', reason: 'The browser opened and the extension attached' }
      : {
          status: 'UNVERIFIABLE',
          reason:
            'The browser opened, but the Dex extension has not attached to it. ' +
            'Load it once from chrome://extensions and it stays.',
        };
  }

  // Signing in is verified by asking the site, not by the owner saying they
  // did it. `sign_in` re-checks the session after the hand-off and only
  // succeeds when the site agrees, so what arrives here is already evidence.
  if (step.action === 'sign_in') {
    const session = (agentResult?.data ?? {}) as { signed_in?: boolean; host?: string };
    return session.signed_in
      ? {
          status: 'VERIFIED',
          reason: `${session.host ?? 'The site'} reports a signed-in session`,
          afterState: session.host,
        }
      : { status: 'FAILED', reason: 'Still not signed in after the hand-off' };
  }

  // A download is verified by a file existing with bytes in it. "The click
  // worked" is a claim about a click; a file on disk is the thing that was
  // asked for.
  if (step.action === 'download_current') {
    const download = (agentResult?.data ?? {}) as {
      downloaded?: boolean; path?: string; bytes?: number; reason?: string;
    };
    if (!download.downloaded || !download.path) {
      return {
        status: 'FAILED',
        reason: download.reason ?? 'Nothing was downloaded',
      };
    }
    if (!fs.existsSync(download.path)) {
      return {
        status: 'FAILED',
        reason: `The download reported ${download.path}, but nothing is there`,
      };
    }
    const size = fs.statSync(download.path).size;
    return size > 0
      ? {
          status: 'VERIFIED',
          reason: `${download.path} — ${Math.round(size / 1024)} KB on disk`,
          afterState: download.path,
        }
      : { status: 'FAILED', reason: `${download.path} is empty` };
  }

  // A route is only worth anything if it has steps in it.
  if (step.action === 'learn_route') {
    const route = (agentResult?.data ?? {}) as { steps?: unknown[]; goal?: string };
    const count = route.steps?.length ?? 0;
    return count > 0
      ? {
          status: 'VERIFIED',
          reason: `Recorded ${count} step(s) to "${route.goal}"`,
          afterState: count,
        }
      : { status: 'FAILED', reason: 'Nothing was recorded' };
  }

  const data = (agentResult?.data ?? {}) as {
    verification?: { passed: boolean; checks?: Array<{ check: string; passed: boolean }> } | null;
    /** What the run says it altered. Absent means the run does not report it. */
    changed?: string[];
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

  // What the run says it changed.
  //
  // Before this, a run_task with no verify hints was always UNVERIFIABLE — the
  // most common shape of web step, and the one Dex could say least about. The
  // run now reports what it altered, and a run that changed nothing while being
  // asked to change something is a failure with evidence rather than a shrug.
  const changed = Array.isArray(data.changed) ? (data.changed as string[]) : undefined;
  if (changed !== undefined) {
    if (changed.length > 0) {
      return {
        status: 'VERIFIED',
        reason: `Changed: ${changed.slice(0, 3).join('; ')}`,
        afterState: typeof data.url === 'string' ? data.url : undefined,
      };
    }
    if (asksForAChange(step)) {
      return {
        status: 'FAILED',
        reason:
          'The task asked for something to change and the run changed nothing — ' +
          'it only read pages.',
        afterState: typeof data.url === 'string' ? data.url : undefined,
      };
    }
    // Reading was the job. Nothing changed and nothing was meant to.
    return {
      status: 'VERIFIED',
      reason: 'Read-only browsing — nothing was changed, and nothing was asked to be',
      afterState: typeof data.url === 'string' ? data.url : undefined,
    };
  }

  return {
    status: 'UNVERIFIABLE',
    reason:
      'No verification hints on this step — add verify_url_contains, ' +
      'verify_text_on_page or verify_selector so success can be checked',
  };
}

/**
 * Does this task ask for something to happen, or only to be read?
 *
 * On the verb, because that is what the owner wrote and it is the only
 * statement of intent the step carries. "What is in my inbox" changing nothing
 * is correct; "send that email" changing nothing is not.
 */
function asksForAChange(step: ExecutionStep): boolean {
  const task = String((step.params as { task?: unknown }).task ?? '').toLowerCase();
  return /(change|set|update|edit|post|send|share|reply|comment|like|follow|unfollow|remove|delete|unpin|pin|add|buy|order|book|submit|upload|download|save|rename|clear)/.test(
    task,
  );
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
    case 'get_env':
    case 'classify_command':
    case 'get_display':
    case 'get_brightness':
    case 'find_program':
    case 'get_keyboard_backlight':
      return { status: 'VERIFIED', reason: 'Read-only action — no state to verify' };

    // The lighting interface is write-only: there is no way to read a colour
    // back off the keyboard. So the honest verdict is UNVERIFIABLE with the
    // reason said out loud, not VERIFIED because the write returned true.
    // Brightness on a provider that can read it back is checked in the handler,
    // which raises when the value did not take.
    case 'set_keyboard_backlight':
      return {
        status: 'UNVERIFIABLE',
        reason:
          'The keyboard accepted the change. Lighting cannot be read back, so ' +
          'Dex cannot confirm it is visible — look at the keyboard',
      };

    // Both read the value back from the OS rather than trusting the handler's
    // own report. set_display already tests the mode before applying it, but
    // "the driver accepted it" and "the display is now in it" are different
    // claims and only the second one is evidence.
    case 'set_display':
      return verifyDisplay(agentResult);

    case 'set_brightness':
      return verifyBrightness(agentResult);

    case 'set_env':
      return verifyEnv(step.params as { name?: string; value?: unknown; scope?: string });

    // Verified by its own exit code, which is the only evidence there is.
    //
    // A command's effect is whatever it did, and Dex cannot know what that was
    // supposed to be. What it can do is refuse to call a non-zero exit a
    // success — which is exactly the failure mode `set_dns` had for months,
    // where a program wrote its error to stdout, exited 1, and was reported as
    // having worked.
    case 'run_command':
    case 'run_shell':
      return verifyCommand(agentResult);
    case 'kill_process':
      return verifyProcessGone(step.params as { name?: string; pid?: number });
    case 'launch_app':
      return verifyAppOpen(step, agentResult);
    case 'close_app':
      return verifyAppClosed(step, agentResult);
    // A capture is verified by the file being on disk, not by the handler
    // saying it saved one. This is the same rule as every other write here:
    // a return value is a claim, and the filesystem is the evidence.
    case 'capture_screen':
      return verifyCapturedFile(agentResult);
    default:
      return {
        status: 'UNVERIFIABLE',
        reason: `No verification logic for action: ${step.action}`,
      };
  }
}

/**
 * A screenshot exists, or it did not happen.
 *
 * Checked on disk and for a non-zero size. An empty PNG is the shape this
 * fails in when a capture runs from the wrong session — the file appears, the
 * handler reports success, and the picture is of nothing.
 */
function verifyCapturedFile(agentResult?: AgentResult): VerificationResult {
  const data = agentResult?.data as { path?: string; bytes?: number } | undefined;
  const target = data?.path;
  if (!target) {
    return { status: 'FAILED', reason: 'The capture reported no file path' };
  }
  if (!fs.existsSync(target)) {
    return { status: 'FAILED', reason: `No file at ${target}` };
  }
  const size = fs.statSync(target).size;
  if (size === 0) {
    return { status: 'FAILED', reason: `${target} is empty — nothing was captured` };
  }
  return { status: 'VERIFIED', reason: `Captured ${Math.round(size / 1024)} KB to ${target}` };
}

function verifyFileStep(step: ExecutionStep, agentResult?: AgentResult): VerificationResult {
  switch (step.action) {
    case 'find_files':
      return verifyFileSearch(agentResult);
    case 'write_file':
      return verifyFileWrite(agentResult);
    case 'describe_file':
      return verifyDescription(agentResult);
    case 'run_program':
      return verifyProgram(agentResult);

    // The new file operations, all verified the same way: the thing they
    // claim to have produced has to be on disk, at the size they reported.
    case 'download_file':
    case 'copy_file':
    case 'move_file':
      return verifyFileExists(agentResult);

    case 'delete_file':
      return verifyFileGone(agentResult);

    // Reads. Nothing changed, so there is nothing to check — but the data
    // itself is what the owner asked for, and the Orchestrator collects it.
    case 'read_file':
    case 'read_document':
    case 'list_dir':
    case 'hash_file':
      return { status: 'VERIFIED', reason: 'Read-only action — no state to verify' };

    case 'rename_files':
      return verifyRename(agentResult);

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
  const searched = typeof data?.searched === 'string' ? data.searched : '';

  // "No matches" is only an answer when the whole scope was actually looked
  // at. While the index is still building, the same empty result means "not
  // found yet", and reporting that as VERIFIED is how a search of one folder
  // came back as a confident statement about the entire PC.
  if (count === 0 && data?.partial === true) {
    return {
      status: 'UNVERIFIABLE',
      reason: `No matches yet — ${searched || 'the file index is still being built'}`,
      afterState: matches,
    };
  }

  const how = searched ? ` (${searched})` : '';
  return {
    status: 'VERIFIED',
    reason: `Found ${count} matching file${count === 1 ? '' : 's'}${suffix}${location}${how}`,
    afterState: matches,
  };
}

/**
 * A description is verified by there being one.
 *
 * Nothing here can check whether the model described the image *correctly* —
 * that is the owner's judgement, and claiming otherwise would be the kind of
 * verification that only ever passes. What it can check is that something was
 * actually read: a step that returned an empty description succeeded as far
 * as the agent was concerned and told the owner nothing.
 */
function verifyDescription(agentResult?: AgentResult): VerificationResult {
  const data = asRecord(agentResult?.data);
  const description = typeof data?.description === 'string' ? data.description : '';
  const text = typeof data?.text === 'string' ? data.text : '';
  const name = typeof data?.name === 'string' ? data.name : 'the file';
  const kind = typeof data?.kind === 'string' ? data.kind : 'file';

  if (kind === 'unreadable') {
    return {
      status: 'UNVERIFIABLE',
      reason: description || `${name} could not be read`,
    };
  }

  const body = description || text;
  if (!body.trim()) {
    return { status: 'FAILED', reason: `Nothing came back about ${name}` };
  }

  return {
    status: 'VERIFIED',
    reason: kind === 'image'
      ? `Looked at ${name} and described it in ${body.trim().split(/\s+/).length} words`
      : `Read ${body.length.toLocaleString()} characters from ${name}`,
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
  const data = agentResult?.data as { launched?: string; image?: string } | undefined;
  const launched = String(data?.launched ?? requested);

  const needles = [requested, launched.replace(/\.exe$/i, ''), data?.image ?? '']
    .map((n) => normaliseTitle(n))
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
    const hit = titles.find((t) =>
      needles.some((n) => normaliseTitle(t).includes(n)),
    );
    if (hit) {
      return { status: 'VERIFIED', reason: `Window open: "${hit}"`, afterState: hit };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  // No window. Before calling that a failure, ask whether the process is
  // there — because for several real applications it will be.
  //
  // Edge is the case that forced this. Its launcher hands off to an existing
  // background instance and exits immediately, and the window then appears
  // under a different process, sometimes after more than five seconds. Dex
  // launched Edge correctly, Edge opened, and the step was reported FAILED.
  //
  // A running process with no window yet is genuinely "could not check", which
  // is what UNVERIFIABLE means here. Nothing running at all is still a failure,
  // so the check that catches a launch doing nothing is unchanged — it now just
  // uses more evidence rather than less.
  const image = String(data?.image ?? '').replace(/\.exe$/i, '');
  if (image && processRunning(image)) {
    return {
      status: 'UNVERIFIABLE',
      reason: `${requested} is running, but no window had appeared within 5s — `
        + 'some applications hand off to a background instance and open late',
      afterState: image,
    };
  }

  return {
    status: 'FAILED',
    reason: `${requested} was launched but neither a window nor a process appeared`,
    afterState: titles?.slice(0, 8) ?? [],
  };
}

/** Is anything by this image name running? Windowless counts. */
function processRunning(image: string): boolean {
  try {
    const list = execSync(`tasklist /fi "IMAGENAME eq ${image}.exe" /fo csv /nh`, {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    return list.toLowerCase().includes(`${image.toLowerCase()}.exe`);
  } catch {
    return false;
  }
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

/**
 * A command is verified by its exit code and nothing else.
 *
 * Dex cannot know what `git commit` was supposed to achieve, so it does not
 * pretend to. What it will not do is call a failure a success — the shape of
 * bug that let `set_dns` report VERIFIED for months while never once running,
 * because the handler only raised when stderr was non-empty and netsh writes
 * its errors to stdout.
 *
 * A non-zero exit is reported with the program's own message, because that
 * message is almost always the actual answer: "not a git repository",
 * "no such file", "permission denied".
 */
function verifyCommand(agentResult?: AgentResult): VerificationResult {
  const data = agentResult?.data as
    | { returncode?: number; stderr?: string; stdout?: string; command?: unknown }
    | undefined;

  if (data?.returncode == null) {
    return { status: 'UNVERIFIABLE', reason: 'The command returned no exit code' };
  }

  if (data.returncode === 0) {
    return { status: 'VERIFIED', reason: 'The command completed', afterState: 0 };
  }

  // Some programs use a non-zero exit to report a fact rather than a failure.
  //
  // Asked to set up a C compiler, Dex ran winget, got 2316632107 — "already
  // installed, nothing to upgrade" — called it a failure, retried the identical
  // command, and spent a minute and forty-four seconds arriving at the state
  // the plan wanted in the first place. See exit_codes.ts for the table.
  const meaning = meaningOf(data.command, data.returncode);
  if (meaning) {
    return {
      status: 'VERIFIED',
      reason: `The command reported: ${meaning.reason}`,
      afterState: data.returncode,
    };
  }

  const said = (data.stderr || data.stdout || '').trim().split('\n')[0].slice(0, 200);
  return {
    status: 'FAILED',
    reason: said
      ? `Exit ${data.returncode}: ${said}`
      : `The command exited with code ${data.returncode}`,
    afterState: data.returncode,
  };
}

/**
 * Read the variable back from the registry, not from the handler's own report.
 *
 * The handler returns what it wrote; the registry says what is stored. Those
 * are the same thing right up until a write silently fails, and only the second
 * one is evidence.
 */
function verifyEnv(
  params: { name?: string; value?: unknown; scope?: string },
): VerificationResult {
  const name = String(params.name ?? '');
  if (!name) return { status: 'UNVERIFIABLE', reason: 'No variable named' };

  const scope = String(params.scope ?? 'user').toLowerCase();
  const key =
    scope === 'machine'
      ? 'HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
      : 'HKCU\Environment';

  let stored: string | null = null;
  try {
    const output = execSync(`reg query "${key}" /v "${name}"`, {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = output.match(/REG_(?:EXPAND_)?SZ\s+(.*)$/m);
    stored = match ? match[1].trim() : null;
  } catch {
    stored = null;
  }

  // A removal is verified by absence, which is what the missing key means.
  if (params.value === null || params.value === undefined) {
    return stored === null
      ? { status: 'VERIFIED', reason: `${name} is no longer set` }
      : { status: 'FAILED', reason: `${name} is still set to ${stored}` };
  }

  if (stored === null) {
    return { status: 'FAILED', reason: `${name} is not in the registry after the write` };
  }

  const wanted = String(params.value);
  // An append lands inside a longer value, so containment is the right test
  // there; an exact set should match outright.
  return stored === wanted || stored.includes(wanted)
    ? { status: 'VERIFIED', reason: `${name} reads back as ${truncate(stored)}`, afterState: stored }
    : {
        status: 'FAILED',
        reason: `${name} reads back as ${truncate(stored)}, not ${truncate(wanted)}`,
        afterState: stored,
      };
}

/**
 * A window title, reduced to the characters that carry meaning.
 *
 * Written because of a real one. Edge titles its own window
 * "New tab - Profile 1 - Microsoft​Edge" — with a ZERO WIDTH SPACE between
 * "Microsoft" and "Edge". It is invisible on screen, it survives lowercasing,
 * and it makes `title.includes('microsoft edge')` false forever. So Dex could
 * launch Edge perfectly and then report that no window had appeared.
 *
 * Nothing invisible should ever decide whether a name matches, so the whole
 * class goes: zero-width spaces and joiners, non-breaking spaces, and runs of
 * ordinary whitespace collapsed to one.
 */
export function normaliseTitle(text: string): string {
  return text
    .replace(/[​-‍﻿]/g, '')
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The display is in the mode that was asked for, read back after the change. */
function verifyDisplay(agentResult?: AgentResult): VerificationResult {
  const data = agentResult?.data as
    | { requested?: string; resolution?: string; refresh_hz?: number; was?: string }
    | undefined;

  if (!data?.resolution) {
    return { status: 'UNVERIFIABLE', reason: 'The display handler reported no mode' };
  }

  const wanted = String(data.requested ?? '').split(' @ ')[0];
  if (wanted && wanted !== data.resolution) {
    return {
      status: 'FAILED',
      reason: `Asked for ${wanted} but the display reports ${data.resolution}`,
      afterState: data.resolution,
    };
  }

  return {
    status: 'VERIFIED',
    reason: `Display is ${data.resolution} at ${data.refresh_hz}Hz`,
    afterState: data.resolution,
  };
}

/**
 * Brightness, within a tolerance.
 *
 * Panels quantise: ask for 40 and a monitor with sixteen steps gives you 40 or
 * 44 and is not wrong. An exact-equality check here would report a working
 * change as a failure, which is the kind of false alarm that teaches people to
 * ignore the real ones.
 */
function verifyBrightness(agentResult?: AgentResult): VerificationResult {
  const data = agentResult?.data as
    | { requested?: number; level?: number; supported?: boolean }
    | undefined;

  if (data?.supported === false) {
    return { status: 'UNVERIFIABLE', reason: 'This display does not report brightness' };
  }
  if (typeof data?.level !== 'number') {
    return { status: 'UNVERIFIABLE', reason: 'The panel did not report a brightness level' };
  }

  const wanted = Number(data.requested);
  return Math.abs(data.level - wanted) <= 5
    ? { status: 'VERIFIED', reason: `Panel reports ${data.level}%`, afterState: data.level }
    : {
        status: 'FAILED',
        reason: `Asked for ${wanted}% but the panel reports ${data.level}%`,
        afterState: data.level,
      };
}

/**
 * Was it actually sent?
 *
 * The distinction that matters: a file Dex could not deliver is NOT a failure
 * of the task — the download happened, the file exists — but it is absolutely
 * not a success either, because the owner asked for it on their phone and it
 * is on a PC they are away from. UNVERIFIABLE with the reason is the honest
 * middle, and it keeps the path in the message so they can still get at it.
 */
function verifyDelivery(agentResult?: AgentResult): VerificationResult {
  const data = agentResult?.data as
    | { delivered?: boolean; to?: string; name?: string; reason?: string; path?: string }
    | undefined;

  if (data?.delivered === true) {
    return {
      status: 'VERIFIED',
      reason: `Sent ${data.name ?? 'the file'} to ${data.to}`,
      afterState: data.to,
    };
  }

  return {
    status: 'UNVERIFIABLE',
    reason: data?.reason
      ? `Not sent — ${data.reason}${data.path ? `. It is at ${data.path}` : ''}`
      : 'The delivery agent did not say whether it sent anything',
  };
}

/**
 * The file the step says it produced is there, and is the size it said.
 *
 * Both halves matter. `existsSync` alone would pass for a zero-byte file left
 * behind by a download that died mid-stream — which is exactly the case
 * downloadFile deletes on the way out, and exactly the one worth catching if
 * that ever stops working.
 */
function verifyFileExists(agentResult?: AgentResult): VerificationResult {
  const data = agentResult?.data as
    | { path?: string; to?: string; bytes?: number; name?: string }
    | undefined;

  const target = data?.path ?? data?.to;
  if (!target) {
    return { status: 'UNVERIFIABLE', reason: 'The step reported no path' };
  }
  if (!fs.existsSync(target)) {
    return { status: 'FAILED', reason: `${target} is not on disk`, afterState: null };
  }

  const actual = fs.statSync(target).size;
  if (typeof data?.bytes === 'number' && actual !== data.bytes) {
    return {
      status: 'FAILED',
      reason: `${target} is ${actual} bytes, not the ${data.bytes} reported`,
      afterState: actual,
    };
  }

  return {
    status: 'VERIFIED',
    reason: `${data?.name ?? target} is on disk (${actual} bytes)`,
    afterState: target,
  };
}

/** The opposite: it is gone, or in the Recycle Bin, which is the same to us. */
function verifyFileGone(agentResult?: AgentResult): VerificationResult {
  const data = agentResult?.data as { path?: string; method?: string } | undefined;
  if (!data?.path) {
    return { status: 'UNVERIFIABLE', reason: 'The step reported no path' };
  }
  return fs.existsSync(data.path)
    ? { status: 'FAILED', reason: `${data.path} is still there` }
    : {
        status: 'VERIFIED',
        reason: `Removed to the ${data.method === 'permanent' ? 'void' : 'Recycle Bin'}`,
        afterState: null,
      };
}

/**
 * A rename that only planned is verified as having changed nothing.
 *
 * This is the preview call, and reporting it as VERIFIED with a count is the
 * point — the owner is meant to read that count before approving the real one.
 */
function verifyRename(agentResult?: AgentResult): VerificationResult {
  const data = agentResult?.data as
    | { applied?: boolean; renamed?: number; would_rename?: number; folder?: string }
    | undefined;

  if (data?.applied === false) {
    return {
      status: 'VERIFIED',
      reason: `Nothing changed — ${data.would_rename ?? 0} file(s) would be renamed`,
      afterState: 0,
    };
  }
  return {
    status: 'VERIFIED',
    reason: `Renamed ${data?.renamed ?? 0} file(s) in ${data?.folder ?? 'the folder'}`,
    afterState: data?.renamed ?? 0,
  };
}
