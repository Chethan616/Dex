/**
 * Settings › Diagnostics: is everything DEX needs here and working?
 *
 * - The tools it needs (main/startup/preflight), each with what fixes it.
 * - The engines: installed, signed in, with Install / Sign in right there.
 * - This PC: Windows, memory, disk, and the graphics driver with its age — an
 *   old driver is what crashed the PC under long 3D work.
 * - Whether DEX can reach the services it uses.
 * - The newest errors in DEX's logs.
 *
 * And one report to paste into a GitHub issue. Nothing here is sent anywhere.
 *
 * It exists because of a specific failure: the browser harness couldn't find
 * Git Bash, silently fell back to a degraded path, and the only symptom was an
 * agent that quietly did less. A missing dependency should be one sentence
 * you can act on.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { LogProblem, ReachResult, SystemInfo } from '../../main/diagnostics';
import './diagnostics.css';

type EngineRow = { id: string; displayName: string; installed: { installed: boolean; version?: string; error?: string }; authed: { authed: boolean; error?: string } };

function Icon({ d, size = 14 }: { d: string; size?: number }): React.ReactElement {
  return <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
const REFRESH = 'M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2.5v2.5H11';
const COPY = 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7';
const FOLDER = 'M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z';

const DRIVER_PAGES: Array<[RegExp, string, string]> = [
  [/amd|radeon/i, 'AMD', 'https://www.amd.com/en/support/download/drivers.html'],
  [/nvidia|geforce|rtx|gtx/i, 'NVIDIA', 'https://www.nvidia.com/en-us/drivers/'],
  [/intel/i, 'Intel', 'https://www.intel.com/content/www/us/en/support/detect.html'],
];

function ago(at: string): string {
  const t = Date.parse(at);
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function Meter({ used, total, label }: { used: number; total: number; label: string }): React.ReactElement {
  const f = total > 0 ? Math.min(1, used / total) : 0;
  return (
    <div className="diag-meter" aria-label={`${label}: ${used} of ${total} GB`}>
      <div className="diag-meter__bar"><i style={{ width: `${f * 100}%` }} className={f > 0.9 ? 'is-bad' : f > 0.75 ? 'is-warn' : ''} /></div>
      <span>{used.toFixed(1)} of {total.toFixed(0)} GB</span>
    </div>
  );
}

function Card({ title, sub, right, children }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="diag-card">
      <div className="diag-card__head">
        <div><div className="diag-card__title">{title}</div>{sub && <div className="diag-card__sub">{sub}</div>}</div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function DiagnosticsSection(): React.ReactElement {
  const settings = window.electronAPI?.settings;
  const sessions = window.electronAPI?.sessions;
  const [report, setReport] = useState<PreflightReportInfo | null>(null);
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [reach, setReach] = useState<ReachResult[] | null>(null);
  const [problems, setProblems] = useState<LogProblem[] | null>(null);
  const [warnings, setWarnings] = useState(false);
  const [engines, setEngines] = useState<EngineRow[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [engineBusy, setEngineBusy] = useState<string | null>(null);

  const loadEngines = useCallback(async () => {
    const list = await sessions?.listEngines?.().catch(() => []) ?? [];
    const rows = await Promise.all(list.map((e) => sessions!.engineStatus(e.id).catch(() => ({ id: e.id, displayName: e.displayName, installed: { installed: false }, authed: { authed: false } }))));
    setEngines(rows);
  }, [sessions]);

  const checkAll = useCallback(async (fresh: boolean) => {
    setChecking(true);
    const d = settings?.diagnostics;
    await Promise.all([
      (fresh ? settings?.preflight?.refresh?.() : settings?.preflight?.get?.())?.then((r) => r && setReport(r)).catch(() => {}),
      d?.system().then(setSys).catch(() => {}),
      d?.reach().then(setReach).catch(() => {}),
      loadEngines(),
    ]);
    setChecking(false);
  }, [settings, loadEngines]);

  useEffect(() => { void checkAll(false); }, [checkAll]);
  useEffect(() => { void settings?.diagnostics?.problems(warnings).then(setProblems).catch(() => setProblems([])); }, [settings, warnings]);

  const copy = useCallback((text: string, key: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  }, []);

  const oldDriver = sys?.gpus.find((g) => (g.ageDays ?? 0) > 730);
  const issues = useMemo(() => {
    const list: string[] = [];
    for (const c of report?.checks ?? []) if (c.status !== 'ok') list.push(`${c.label}: ${c.detail}`);
    // One working engine is enough: the others not being set up isn't a problem.
    if (engines && !engines.some((e) => e.installed.installed && e.authed.authed)) list.push('No engine is installed and signed in');
    for (const r of reach ?? []) if (!r.ok) list.push(`Can't reach ${r.label}`);
    if (oldDriver) list.push(`Graphics driver from ${oldDriver.driverDate}`);
    if (sys && sys.diskFreeGb !== undefined && sys.diskFreeGb < 5) list.push(`Only ${sys.diskFreeGb} GB free on the system drive`);
    return list;
  }, [report, engines, reach, oldDriver, sys]);

  const textReport = (): string => {
    const lines: string[] = ['## DEX diagnostics', ''];
    if (sys) {
      lines.push(`- DEX ${sys.versions.DEX} · Electron ${sys.versions.Electron} · ${sys.os} · ${sys.arch}`);
      lines.push(`- ${sys.cpu} (${sys.cores} threads) · RAM ${sys.memFreeGb}/${sys.memTotalGb} GB free · disk ${sys.diskFreeGb ?? '?'}/${sys.diskTotalGb ?? '?'} GB free`);
      for (const g of sys.gpus) lines.push(`- GPU ${g.name} · driver ${g.driver ?? '?'} (${g.driverDate ?? '?'})`);
    }
    lines.push('', '### Checks');
    for (const c of report?.checks ?? []) lines.push(`- ${c.status === 'ok' ? '✅' : '⚠️'} ${c.label}: ${c.detail}`);
    for (const e of engines ?? []) lines.push(`- ${e.installed.installed ? '✅' : '⚠️'} ${e.displayName}: ${e.installed.installed ? `installed ${e.installed.version ?? ''}` : 'not installed'}, ${e.authed.authed ? 'signed in' : 'not signed in'}`);
    for (const r of reach ?? []) lines.push(`- ${r.ok ? '✅' : '⚠️'} ${r.label}: ${r.ok ? `${r.ms} ms` : r.error}`);
    if (problems?.length) {
      lines.push('', '### Recent errors');
      for (const p of problems.slice(0, 15)) lines.push(`- ${p.at} [${p.channel}] ${p.msg}${p.detail ? ` — ${p.detail}` : ''}`);
    }
    return lines.join('\n');
  };

  const total = (report?.checks.length ?? 0) + (engines?.length ?? 0) + (reach?.length ?? 0);
  const anyEngine = engines?.some((e) => e.installed.installed && e.authed.authed) ?? false;
  const good = total - (report?.checks.filter((c) => c.status !== 'ok').length ?? 0) - (engines && !anyEngine ? engines.length : 0) - (reach?.filter((r) => !r.ok).length ?? 0);
  const ready = report !== null && engines !== null && reach !== null;

  return (
    <div className="diag">
      <div className={`diag-hero${ready ? (issues.length ? ' is-warn' : ' is-ok') : ''}`}>
        <div className="diag-ring" aria-hidden="true" style={{ ['--f' as string]: total ? good / total : 0 }}><span>{ready ? `${good}/${total}` : '…'}</span></div>
        <div className="diag-hero__text">
          <div className="diag-hero__title">{!ready ? 'Checking your PC…' : issues.length === 0 ? 'Everything DEX needs is here and working' : `${issues.length} thing${issues.length === 1 ? '' : 's'} need${issues.length === 1 ? 's' : ''} a look`}</div>
          <div className="diag-hero__sub">{ready && issues.length ? issues.slice(0, 3).join(' · ') : 'Tools, engines, this PC and the network, checked on this machine. Nothing here is sent anywhere.'}</div>
        </div>
        <div className="diag-hero__actions">
          <button type="button" className="conn-card__btn conn-card__btn--secondary diag-btn" onClick={() => copy(textReport(), 'report')}><Icon d={COPY} size={12} />{copied === 'report' ? 'Copied' : 'Copy report'}</button>
          <button type="button" className="conn-card__btn conn-card__btn--primary diag-btn" disabled={checking} onClick={() => { void checkAll(true); }}><Icon d={REFRESH} size={12} />{checking ? 'Checking…' : 'Check again'}</button>
        </div>
      </div>

      <Card title="Tools DEX needs" sub="What DEX looks for on this PC, and what fixes it when it's missing.">
        {!report ? <div className="diag-empty">Checking…</div> : (
          <ul className="diag-rows">
            {report.checks.map((c) => (
              <li key={c.id} className={`diag-row is-${c.status}`}>
                <span className="diag-dot" aria-hidden="true" />
                <div className="diag-row__text">
                  <div className="diag-row__title">{c.label}<span className={`diag-pill is-${c.status}`}>{c.status === 'ok' ? 'ready' : c.status}</span></div>
                  <div className="diag-row__sub">{c.detail}</div>
                  {c.fix && (
                    <div className="diag-fix">
                      <span>{c.fix.summary}</span>
                      {c.fix.command && <button type="button" className="diag-cmd" onClick={() => copy(c.fix!.command as string, c.id)} title="Copy this command"><code>{c.fix.command}</code><em>{copied === c.id ? 'copied' : 'copy'}</em></button>}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Engines" sub="The AI that does the work. One installed and signed in is enough.">
        {!engines ? <div className="diag-empty">Checking…</div> : (
          <ul className="diag-rows">
            {engines.map((e) => {
              const okEngine = e.installed.installed && e.authed.authed;
              return (
                <li key={e.id} className={`diag-row is-${okEngine ? 'ok' : anyEngine ? 'idle' : e.installed.installed ? 'warn' : 'missing'}`}>
                  <span className="diag-dot" aria-hidden="true" />
                  <div className="diag-row__text">
                    <div className="diag-row__title">{e.displayName}{e.installed.version && <span className="diag-ver">{e.installed.version}</span>}</div>
                    <div className="diag-row__sub">{!e.installed.installed ? (anyEngine ? 'Not installed (optional)' : 'Not installed') : e.authed.authed ? 'Installed and signed in' : (e.authed.error ?? 'Installed, not signed in')}</div>
                  </div>
                  {!e.installed.installed ? (
                    <button type="button" className="conn-card__btn conn-card__btn--secondary diag-btn" disabled={engineBusy === e.id} onClick={() => { setEngineBusy(e.id); void sessions?.engineInstall(e.id).finally(() => { setEngineBusy(null); void loadEngines(); }); }}>{engineBusy === e.id ? 'Installing…' : 'Install'}</button>
                  ) : !e.authed.authed ? (
                    <button type="button" className="conn-card__btn conn-card__btn--secondary diag-btn" onClick={() => { void sessions?.engineLogin(e.id); }}>Sign in</button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="This PC">
        {!sys ? <div className="diag-empty">Reading…</div> : (
          <div className="diag-pc">
            <div className="diag-kv"><span>Windows</span><b>{sys.os}</b></div>
            <div className="diag-kv"><span>Processor</span><b>{sys.cpu} · {sys.cores} threads</b></div>
            <div className="diag-kv"><span>Memory</span><Meter used={sys.memTotalGb - sys.memFreeGb} total={sys.memTotalGb} label="Memory in use" /></div>
            {sys.diskTotalGb !== undefined && sys.diskFreeGb !== undefined && <div className="diag-kv"><span>System drive</span><Meter used={sys.diskTotalGb - sys.diskFreeGb} total={sys.diskTotalGb} label="Disk in use" /></div>}
            <div className="diag-kv"><span>DEX</span><b>{sys.versions.DEX} · Electron {sys.versions.Electron} · up {sys.uptimeHours} h</b></div>
            {sys.gpus.map((g) => {
              const old = (g.ageDays ?? 0) > 730;
              const page = DRIVER_PAGES.find(([re]) => re.test(g.name));
              return (
                <div key={g.name} className={`diag-gpu${old ? ' is-old' : ''}`}>
                  <div className="diag-kv"><span>Graphics</span><b>{g.name}</b></div>
                  <div className="diag-gpu__driver">Driver {g.driver ?? '?'}{g.driverDate ? ` · ${new Date(g.driverDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}` : ''}</div>
                  {old && (
                    <div className="diag-gpu__warn">
                      <span>This driver is over {Math.floor((g.ageDays ?? 0) / 365)} years old. Old graphics drivers can freeze or restart the PC under 3D work and long renders.</span>
                      {page && <button type="button" className="conn-card__btn conn-card__btn--primary diag-btn" onClick={() => { void window.electronAPI?.widgets?.openUrl(page[2]); }}>Get the {page[1]} driver</button>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Network" sub="Whether DEX can reach the services it uses from here.">
        {!reach ? <div className="diag-empty">Checking…</div> : (
          <div className="diag-net">
            {reach.map((r) => (
              <div key={r.id} className={`diag-net__item${r.ok ? ' is-ok' : ' is-bad'}`}>
                <span className="diag-dot" aria-hidden="true" />
                <span className="diag-net__label">{r.label}</span>
                <span className="diag-net__ms">{r.ok ? `${r.ms} ms` : r.error}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Recent problems"
        sub="The newest errors in DEX's logs, with where they came from."
        right={(
          <div className="diag-card__actions">
            <label className="diag-check"><input type="checkbox" checked={warnings} onChange={(e) => setWarnings(e.target.checked)} />Warnings too</label>
            <button type="button" className="conn-card__btn conn-card__btn--secondary diag-btn" onClick={() => { void settings?.diagnostics?.openLogs(); }}><Icon d={FOLDER} size={12} />Open logs</button>
          </div>
        )}
      >
        {!problems ? <div className="diag-empty">Reading the logs…</div> : problems.length === 0 ? (
          <div className="diag-empty diag-empty--good">No errors in DEX's logs.</div>
        ) : (
          <ul className="diag-problems">
            {problems.map((p, i) => (
              <li key={i} className={`diag-problem is-${p.level}`}>
                <div className="diag-problem__head"><span className="diag-problem__msg">{p.msg}</span><span className="diag-problem__meta">{p.channel} · {ago(p.at)}</span></div>
                {p.detail && <div className="diag-problem__detail">{p.detail}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
