import React, { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { ConnectionsPane, type SettingsProviderFocusRequest } from './ConnectionsPane';
import { PhoneCard } from './PhoneCard';
import { MARKET_ITEMS, Mark, type MarketItem } from './connectors/Marketplace';
import type { ActionId, KeyBinding } from './keybindings';
import { fallbackShortcutPlatform, keyboardEventToShortcut } from '../../shared/hotkeys';
import { useThemeMode } from '../design/useThemeMode';
import type { ThemeMode } from '../design/themeMode';
import { DexAvatar, NewBadge, Orb, ProfilePicker, Segmented, Switch, useDexProfile, type SegmentedOption } from '../components/lib';

/**
 * Generic settings primitives. Add a new option type and every section that
 * uses it (Appearance, future Density / Accent / etc.) gets the same UI.
 */
interface SettingsRowProps {
  label: string;
  sublabel?: string;
  children: React.ReactNode;
}

function SettingsRow({ label, sublabel, children }: SettingsRowProps): React.ReactElement {
  return (
    <div className="settings-pane__row">
      <div>
        <div className="settings-pane__label">{label}</div>
        {sublabel && <div className="settings-pane__sublabel">{sublabel}</div>}
      </div>
      {children}
    </div>
  );
}

const APPEARANCE_OPTIONS: ReadonlyArray<{ value: ThemeMode; label: string; hint?: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System', hint: 'Follow your operating system' },
];

/** A miniature of the hub in one theme — sidebar, prompt card, send button. */
function ThemeMockup({ tone }: { tone: 'light' | 'dark' }): React.ReactElement {
  return (
    <span className={`theme-tile__mock theme-tile__mock--${tone}`} aria-hidden="true">
      <span className="theme-tile__mock-side">
        <i /><i /><i />
      </span>
      <span className="theme-tile__mock-main">
        <span className="theme-tile__mock-card">
          <i className="theme-tile__mock-line" />
          <i className="theme-tile__mock-send" />
        </span>
      </span>
    </span>
  );
}

/** Settings → Appearance → Your DEX: the bot that represents you, on every device. */
function YourDexCard(): React.ReactElement {
  const [profile, save] = useDexProfile();
  const [editing, setEditing] = useState(false);
  return (
    <div className="settings-card">
      <div className="settings-pane__row">
        <div className="your-dex">
          <DexAvatar size={56} interactive />
          <div>
            <div className="settings-pane__label">{profile.name ?? 'Your DEX'}</div>
            <div className="settings-pane__sublabel">
              The bot that represents you — here and in DEX on your phone.
            </div>
          </div>
        </div>
        {!editing && (
          <button type="button" className="conn-card__btn conn-card__btn--secondary" onClick={() => setEditing(true)}>
            Change
          </button>
        )}
      </div>
      {editing && (
        <div className="your-dex__picker">
          <ProfilePicker
            initial={profile}
            onCancel={() => setEditing(false)}
            onSave={async (next) => { await save(next); setEditing(false); }}
          />
        </div>
      )}
    </div>
  );
}

function AppearanceSection(): React.ReactElement {
  const { mode, setMode, resolved } = useThemeMode();
  return (
    <>
    <YourDexCard />
    <div className="settings-card">
      <div className="settings-pane__row settings-pane__row--stack">
        <div>
          <div className="settings-pane__label">Theme</div>
          <div className="settings-pane__sublabel">
            {mode === 'system'
              ? `Following your system (${resolved}).`
              : 'Choose how DEX looks across every window.'}
          </div>
        </div>
        <div className="theme-picker" role="radiogroup" aria-label="Theme">
          {APPEARANCE_OPTIONS.map((opt) => {
            const active = mode === opt.value;
            return (
              <div key={opt.value} className={`theme-tile${active ? ' theme-tile--active' : ''}`}>
                {opt.value === 'system' ? (
                  <span className="theme-tile__split" aria-hidden="true">
                    <ThemeMockup tone="light" />
                    <ThemeMockup tone="dark" />
                  </span>
                ) : (
                  <ThemeMockup tone={opt.value} />
                )}
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={opt.hint}
                  className={`theme-tile__btn settings-pane__segment${active ? ' settings-pane__segment--active' : ''}`}
                  onClick={() => setMode(opt.value)}
                >
                  {opt.label}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </>
  );
}

type ElectronPrivacyAPI = {
  get: () => Promise<{ telemetry: boolean; telemetryUpdatedAt: string | null; version: number }>;
  setTelemetry: (optedIn: boolean) => Promise<{ telemetry: boolean; telemetryUpdatedAt: string | null; version: number }>;
  openSystemNotifications: () => Promise<{ ok: boolean; error?: string }>;
};

type ApprovalMode = 'ask' | 'auto' | 'full';

type ElectronApprovalsAPI = {
  get: () => Promise<{ mode: ApprovalMode }>;
  set: (mode: ApprovalMode) => Promise<{ mode: ApprovalMode }>;
};

const APPROVAL_MODE_OPTIONS: ReadonlyArray<SegmentedOption<ApprovalMode>> = [
  { value: 'ask', label: 'Ask for approval', hint: 'A registry write, shell command, or other sensitive action always waits for you' },
  { value: 'auto', label: 'Approve for me', hint: 'Only asks when a command or path looks sensitive' },
  { value: 'full', label: 'Full access', hint: 'Default — nothing gated but Windows registry writes' },
];

function AgentApprovalSection(): React.ReactElement {
  const [mode, setMode] = useState<ApprovalMode | null>(null);
  const [saving, setSaving] = useState(false);
  const api = (window as unknown as { electronAPI: { settings: { approvals: ElectronApprovalsAPI } } }).electronAPI.settings.approvals;

  useEffect(() => {
    let cancelled = false;
    api.get().then((state) => { if (!cancelled) setMode(state.mode); }).catch(() => { if (!cancelled) setMode('full'); });
    return () => { cancelled = true; };
  }, [api]);

  const handleChange = useCallback(async (next: ApprovalMode) => {
    if (saving) return;
    const prev = mode;
    setSaving(true);
    setMode(next); // optimistic
    try {
      const res = await api.set(next);
      setMode(res.mode);
    } catch {
      setMode(prev); // revert
    } finally {
      setSaving(false);
    }
  }, [mode, saving, api]);

  return (
    <div className="settings-card">
      <SettingsRow
        label="Agent approval"
        sublabel="How much an agent task can do before it needs you to say yes. A Windows registry write always waits for you regardless of this setting."
      >
        {mode ? (
          <Segmented
            value={mode}
            options={APPROVAL_MODE_OPTIONS}
            onChange={(next) => { void handleChange(next); }}
            label="Agent approval mode"
            optionClassName="settings-pane__segment"
          />
        ) : (
          <Orb size={20} state="connecting" />
        )}
      </SettingsRow>
      <AdminChangesRow />
    </div>
  );
}

/**
 * Windows only: set up DEX's elevated helper once (one Windows prompt), so
 * admin fixes — network, devices, services — don't need one each time. The
 * Agent approval mode above still decides whether DEX asks you first.
 */
function AdminChangesRow(): React.ReactElement | null {
  const api = window.electronAPI?.settings?.elevation;
  const [status, setStatus] = useState<{ supported: boolean; installed: boolean; outdated: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { void api?.status().then(setStatus).catch(() => setStatus(null)); }, [api]);
  useEffect(load, [load]);
  if (!api || !status?.supported) return null;
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(r.error ?? 'That didn’t work.');
    } finally {
      setBusy(false);
      load();
    }
  };
  const label = !status.installed ? 'Not set up' : status.outdated ? 'Needs an update' : 'Set up';
  return (
    <SettingsRow
      label="Admin changes"
      sublabel={error ?? `Lets DEX make admin fixes — network, devices, services — without a Windows prompt each time. One prompt to set up. ${label}.`}
    >
      {status.installed && !status.outdated ? (
        <button type="button" className="conn-card__btn conn-card__btn--secondary" disabled={busy} onClick={() => void run(api.remove)}>Remove</button>
      ) : (
        <button type="button" className="conn-card__btn conn-card__btn--primary" disabled={busy} onClick={() => void run(api.setUp)}>
          {busy ? 'Waiting for Windows…' : status.outdated ? 'Update' : 'Set up'}
        </button>
      )}
    </SettingsRow>
  );
}

type ElectronAppAPI = {
  getUpdateStatus: () => Promise<UpdateStatusEvent>;
  getInfo: () => Promise<{
    version: string;
    latestVersion: string | null;
    isLatestVersion: boolean | null;
    platform: string;
    packaged: boolean;
    updateSupported: boolean;
    canDownloadUpdate: boolean;
    updateFeedUrl: string;
  }>;
  downloadLatest: () => Promise<{
    ok: boolean;
    action: 'started-update-check' | 'unavailable';
    message: string;
  }>;
  installUpdate: () => Promise<{
    ok: boolean;
    action: 'install-started' | 'not-ready';
    message: string;
  }>;
  onUpdateStatus: (cb: (event: UpdateStatusEvent) => void) => () => void;
};

type UpdateStatusEvent = {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error' | 'unavailable';
  version?: string;
  message?: string;
  error?: string;
  progress?: {
    percent: number | null;
    transferred: number | null;
    total: number | null;
    bytesPerSecond: number | null;
  };
};

function AppSection(): React.ReactElement {
  const [info, setInfo] = useState<Awaited<ReturnType<ElectronAppAPI['getInfo']>> | null>(null);
  const [updateStatusEvent, setUpdateStatusEvent] = useState<UpdateStatusEvent>({ status: 'idle' });
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const api = window.electronAPI?.settings?.app;
  const onLatest = info?.isLatestVersion === true;
  const canDownloadUpdate = info?.canDownloadUpdate === true;
  const updateReady = updateStatusEvent.status === 'ready';
  const updateBusy = updateStatusEvent.status === 'checking' || updateStatusEvent.status === 'downloading';
  const updateActionDisabled = !api || !info || installing || (
    !updateReady && (checking || updateBusy || onLatest || !canDownloadUpdate)
  );
  const downloadProgress = updateStatusEvent.progress?.percent;
  const progressWidth = typeof downloadProgress === 'number'
    ? `${Math.max(2, Math.min(100, downloadProgress))}%`
    : updateStatusEvent.status === 'downloading'
      ? '18%'
      : '0%';
  const updateStatus = updateStatusEvent.message ?? (
    !info
      ? 'Checking latest version...'
      : updateReady
        ? 'Update is ready to install.'
        : updateBusy
          ? 'Checking for updates...'
          : onLatest
            ? 'You are on the latest version.'
            : info.latestVersion
              ? `Latest version is ${info.latestVersion}.`
              : canDownloadUpdate
                ? 'Checks on startup and every hour.'
                : 'In-app updates are available in packaged release builds.'
  );
  const buttonLabel = !info || checking
    ? 'Checking...'
    : installing
      ? 'Restarting...'
      : updateReady
        ? 'Restart to install'
        : onLatest
          ? 'On latest'
          : canDownloadUpdate
            ? 'Download update'
            : 'Unavailable';

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api?.getInfo() ?? Promise.resolve(null),
      api?.getUpdateStatus() ?? Promise.resolve<UpdateStatusEvent>({ status: 'idle' }),
    ])
      .then(([nextInfo, nextStatus]) => {
        if (cancelled) return;
        setInfo(nextInfo);
        setUpdateStatusEvent(nextStatus);
      })
      .catch(() => {
        if (cancelled) return;
        setInfo(null);
        setUpdateStatusEvent({ status: 'error', message: 'Could not read update status.' });
      });

    const unsubscribe = api?.onUpdateStatus((nextStatus) => {
      setUpdateStatusEvent(nextStatus);
      if (nextStatus.status !== 'ready') setInstalling(false);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [api]);

  const handleDownloadLatest = useCallback(async () => {
    if (!api || checking || installing || onLatest || updateBusy || updateReady || !canDownloadUpdate) return;
    setChecking(true);
    setUpdateStatusEvent({ status: 'checking', message: 'Checking for updates...' });
    try {
      const result = await api.downloadLatest();
      setUpdateStatusEvent((current) => (
        current.status === 'checking' ? { status: result.ok ? 'checking' : 'unavailable', message: result.message } : current
      ));
      const next = await api.getInfo();
      setInfo(next);
    } catch {
      setUpdateStatusEvent({ status: 'error', message: 'Could not start the in-app update check. Please try again later.' });
    } finally {
      setChecking(false);
    }
  }, [api, canDownloadUpdate, checking, installing, onLatest, updateBusy, updateReady]);

  const handleInstallUpdate = useCallback(async () => {
    if (!api || installing || !updateReady) return;
    setInstalling(true);
    try {
      const result = await api.installUpdate();
      setUpdateStatusEvent((current) => ({
        ...current,
        message: result.message,
      }));
      if (!result.ok) setInstalling(false);
    } catch {
      setUpdateStatusEvent({ status: 'error', message: 'Could not restart to install the update.' });
      setInstalling(false);
    }
  }, [api, installing, updateReady]);

  const handleUpdateClick = updateReady ? handleInstallUpdate : handleDownloadLatest;

  return (
    <div className="settings-card">
      <div className="settings-pane__row">
        <div>
          <div className="settings-pane__label">Version</div>
          <div className="settings-pane__sublabel">
            {info ? `DEX ${info.version} · by Chethan Krishna · Apache-2.0` : 'Detecting version...'}
          </div>
        </div>
        {info && <span className="settings-pane__value">v{info.version}</span>}
      </div>
      {/* The credit Apache-2.0's NOTICE asks redistributors to keep (NOTICE, LICENSES.md). */}
      <div className="settings-pane__row">
        <div>
          <div className="settings-pane__label">Open source</div>
          <div className="settings-pane__sublabel">DEX was created by Chethan Krishna (@Chethan616). Ideas, issues and pull requests are welcome.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="conn-card__btn" onClick={() => { void window.electronAPI?.widgets?.openUrl('https://github.com/Chethan616/Dex'); }}>Source code</button>
          <button className="conn-card__btn" onClick={() => { void window.electronAPI?.widgets?.openUrl('https://github.com/Chethan616/Dex/blob/main/LICENSES.md'); }}>Licenses</button>
        </div>
      </div>
      <div className="settings-pane__row">
        <div>
          <div className="settings-pane__label">Updates</div>
          <div className="settings-pane__sublabel">
            {updateStatus}
          </div>
          {(updateStatusEvent.status === 'downloading' || updateStatusEvent.status === 'ready') && (
            <div className="settings-pane__progress" aria-hidden="true">
              <span
                className="settings-pane__progress-fill"
                style={{ width: updateStatusEvent.status === 'ready' ? '100%' : progressWidth }}
              />
            </div>
          )}
        </div>
        {updateReady ? (
          <button
            className="conn-card__btn conn-card__btn--primary"
            onClick={handleUpdateClick}
            disabled={updateActionDisabled}
          >
            {buttonLabel}
          </button>
        ) : (
          <span className="settings-pane__row-right">
            {(checking || updateBusy || !info) && <Orb size={20} state="searching" />}
            <button
              className="conn-card__btn conn-card__btn--secondary"
              onClick={handleUpdateClick}
              disabled={updateActionDisabled}
            >
              {buttonLabel}
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

type TabsPosition = 'side' | 'top';

function readTabsPosition(): TabsPosition {
  try {
    return window.localStorage.getItem('hub-tabs-position') === 'top' ? 'top' : 'side';
  } catch {
    return 'side';
  }
}

function LayoutSection(): React.ReactElement {
  const [position, setPosition] = useState<TabsPosition>(readTabsPosition);

  const choose = useCallback((next: TabsPosition) => {
    setPosition(next);
    try { window.localStorage.setItem('hub-tabs-position', next); } catch { /* ignore */ }
    // HubApp listens for this and dispatches pane:layout-change AFTER React
    // commits the new DOM, so AgentPane re-measures the correct bounds.
    window.dispatchEvent(new CustomEvent('hub:tabs-position-change', { detail: { position: next } }));
  }, []);

  return (
    <div className="settings-card layout-section">
      <div className="layout-section__header">
        <div className="settings-pane__label">Tab layout</div>
        <div className="settings-pane__sublabel">
          Pick where the agent session tabs live. Top reclaims sidebar width for the browser viewport.
        </div>
      </div>
      <div className="layout-picker" role="radiogroup" aria-label="Tab layout">
        <button
          type="button"
          role="radio"
          aria-checked={position === 'side'}
          className={`layout-picker__card${position === 'side' ? ' layout-picker__card--selected' : ''}`}
          onClick={() => choose('side')}
        >
          <div className="layout-picker__mockup layout-picker__mockup--side" aria-hidden="true">
            <div className="layout-picker__mockup-header" />
            <div className="layout-picker__mockup-tabs">
              <span className="layout-picker__mockup-row layout-picker__mockup-row--active" />
              <span className="layout-picker__mockup-row" />
              <span className="layout-picker__mockup-row" />
              <span className="layout-picker__mockup-row" />
            </div>
            <div className="layout-picker__mockup-viewport" />
          </div>
          <div className="layout-picker__label">Side</div>
          <div className="layout-picker__desc">Vertical sidebar on the left. Roomy session labels.</div>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={position === 'top'}
          className={`layout-picker__card${position === 'top' ? ' layout-picker__card--selected' : ''}`}
          onClick={() => choose('top')}
        >
          <div className="layout-picker__mockup layout-picker__mockup--top" aria-hidden="true">
            <div className="layout-picker__mockup-header" />
            <div className="layout-picker__mockup-tabs">
              <span className="layout-picker__mockup-chip layout-picker__mockup-chip--active" />
              <span className="layout-picker__mockup-chip" />
              <span className="layout-picker__mockup-chip" />
              <span className="layout-picker__mockup-chip" />
            </div>
            <div className="layout-picker__mockup-viewport" />
          </div>
          <div className="layout-picker__label">Top</div>
          <div className="layout-picker__desc">Horizontal terminal-style strip. Wider browser viewport.</div>
        </button>
      </div>
    </div>
  );
}

function PrivacySection(): React.ReactElement {
  const [telemetry, setTelemetry] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const api = (window as unknown as { electronAPI: { settings: { privacy: ElectronPrivacyAPI } } }).electronAPI.settings.privacy;

  useEffect(() => {
    let cancelled = false;
    api.get().then((state) => {
      if (!cancelled) setTelemetry(state.telemetry);
    }).catch(() => { if (!cancelled) setTelemetry(false); });
    return () => { cancelled = true; };
  }, [api]);

  const handleToggle = useCallback(async () => {
    if (telemetry === null || saving) return;
    const next = !telemetry;
    setSaving(true);
    setTelemetry(next); // optimistic
    try {
      const res = await api.setTelemetry(next);
      setTelemetry(res.telemetry);
    } catch {
      setTelemetry(!next); // revert
    } finally {
      setSaving(false);
    }
  }, [telemetry, saving, api]);

  return (
    <div className="settings-card">
      <div className="settings-pane__row">
        <div>
          <div className="settings-pane__label">Allow telemetry to help us make this app better</div>
          <div className="settings-pane__sublabel">Anonymous only — app version, OS, feature usage, and crash reports.</div>
        </div>
        <Switch
          checked={telemetry === true}
          onChange={() => { void handleToggle(); }}
          label="Allow telemetry"
          disabled={telemetry === null || saving}
        />
      </div>

      <div className="settings-pane__row">
        <div>
          <div className="settings-pane__label">System notifications</div>
          <div className="settings-pane__sublabel">Managed by your operating system.</div>
        </div>
        <button
          className="conn-card__btn conn-card__btn--secondary"
          onClick={() => { void api.openSystemNotifications(); }}
        >
          Open system settings
        </button>
      </div>
    </div>
  );
}

/**
 * What DEX needs from the machine, and whether it found it.
 *
 * This exists because of a specific failure: the browser harness could not
 * find Git Bash, silently fell back to a degraded path, and the only visible
 * symptom was an agent that quietly did less than it should. Days went into
 * that. A missing dependency should be one sentence you can act on, so each
 * row states what was looked for, what was found, and what fixes it.
 */
function DiagnosticsSection(): React.ReactElement {
  const [report, setReport] = useState<PreflightReportInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI?.settings?.preflight?.get?.().then((next) => {
      if (!cancelled) setReport(next);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      const next = await window.electronAPI?.settings?.preflight?.refresh?.();
      if (next) setReport(next);
    } finally {
      setChecking(false);
    }
  }, []);

  const copy = useCallback((command: string) => {
    void navigator.clipboard?.writeText(command);
    setCopied(command);
    window.setTimeout(() => setCopied((current) => (current === command ? null : current)), 1500);
  }, []);

  if (!report) {
    return (
      <div className="settings-card">
        <p className="diag__empty">Checking your environment…</p>
      </div>
    );
  }

  return (
    <div className="settings-card">
      <div className="diag__header">
        <span className={`diag__summary diag__summary--${report.ok ? 'ok' : 'bad'}`}>
          {report.ok
            ? 'Everything DEX needs is installed.'
            : 'Something DEX needs is missing — the rows below say what.'}
        </span>
        <button className="diag__recheck" onClick={recheck} disabled={checking}>
          {checking ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      <div className="diag__list">
        {report.checks.map((check) => (
          <div className={`diag__row diag__row--${check.status}`} key={check.id}>
            <span className="diag__dot" aria-hidden="true" />
            <div className="diag__body">
              <div className="diag__line">
                <span className="diag__label">{check.label}</span>
                <span className="diag__status">{check.status === 'ok' ? 'ready' : check.status}</span>
              </div>
              <div className="diag__detail">{check.detail}</div>
              {check.fix ? (
                <div className="diag__fix">
                  <div className="diag__fix-summary">{check.fix.summary}</div>
                  {check.fix.command ? (
                    <button
                      className="diag__fix-command"
                      onClick={() => copy(check.fix!.command as string)}
                      title="Copy this command"
                    >
                      <code>{check.fix.command}</code>
                      <span className="diag__fix-copy">{copied === check.fix.command ? 'copied' : 'copy'}</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Connections to services that expose a real API.
 *
 * Enabling one changes what DEX does, not just what it can do: with a GitHub
 * connection it calls the API instead of driving github.com, which is faster,
 * far cheaper in tokens, and does not break when a page layout changes. That
 * is worth saying on the row, because "connect GitHub" otherwise reads as
 * optional plumbing.
 *
 * Modelled on the WhatsApp and provider cards rather than a checkbox list.
 * A checkbox says "on/off"; these are accounts, and the honest verbs for an
 * account are Connect and Sign out. It also removes a state a checkbox invites
 * and cannot express — ticked but unusable because no token was ever entered.
 *
 * Credential values never come back across the bridge. A saved field reports
 * only that it is present.
 */
function McpSection(): React.ReactElement {
  const [rows, setRows] = useState<McpConnectionInfo[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * Result of a real handshake per connection.
   *
   * Separate from `enabled` on purpose: enabled means the user asked for it,
   * verified means it actually works. Conflating them is what let a mistyped
   * token look connected.
   */
  const [checks, setChecks] = useState<Record<string, McpVerifyInfo | 'checking'>>({});

  const reload = useCallback(async () => {
    const next = await window.electronAPI?.settings?.mcp?.list?.();
    if (!next) return;
    setRows(next);
    // DEX shakes hands with every enabled connection at launch, so adopt those
    // results rather than spawning the servers again just because the user
    // opened Settings.
    setChecks((current) => {
      const seeded = { ...current };
      for (const row of next) {
        if (row.verified && !seeded[row.id]) seeded[row.id] = row.verified;
      }
      return seeded;
    });
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const test = useCallback(async (id: string) => {
    setChecks((current) => ({ ...current, [id]: 'checking' }));
    const result = await window.electronAPI?.settings?.mcp?.test?.(id);
    setChecks((current) => ({
      ...current,
      [id]: result ?? { ok: false, error: 'The check could not be run.' },
    }));
  }, []);

  // Verify whatever is already switched on when the pane opens, so the dots
  // mean something before the user touches anything.
  useEffect(() => {
    for (const row of rows ?? []) {
      if (row.enabled && row.missing.length === 0 && !checks[row.id]) void test(row.id);
    }
    // Only when the row set changes; `checks` is written by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, test]);

  const connect = useCallback(async (row: McpConnectionInfo) => {
    const draft = drafts[row.id] ?? {};
    setBusy(row.id);
    try {
      // Save credentials and switch on together: a connection that is enabled
      // but incomplete is exactly the state this UI exists to prevent.
      await window.electronAPI?.settings?.mcp?.set?.(row.id, { values: draft, enabled: true });
      setDrafts((current) => ({ ...current, [row.id]: {} }));
      setEditing(null);
      await reload();
      // Saving is not connecting. Find out now, while the user is looking at
      // it, rather than during a task three days later.
      await test(row.id);
    } finally {
      setBusy(null);
    }
  }, [drafts, reload]);

  const signOut = useCallback(async (row: McpConnectionInfo) => {
    setBusy(row.id);
    try {
      // Blank every credential as well as switching off, so signing out
      // actually removes the token rather than leaving it dormant on disk.
      const cleared: Record<string, string> = {};
      for (const field of row.credentials) cleared[field.key] = '';
      await window.electronAPI?.settings?.mcp?.set?.(row.id, { values: cleared, enabled: false });
      setEditing(null);
      setChecks((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      await reload();
    } finally {
      setBusy(null);
    }
  }, [reload]);

  if (!rows) {
    return <div className="settings-card"><p className="diag__empty">Loading connections…</p></div>;
  }

  return (
    <div className="settings-card settings-card--bare">
      <p className="mcp__intro">
        When a service is connected, DEX uses its API instead of driving the website — quicker,
        cheaper, and it does not break when a page changes. Anything without a connection still
        works through the browser.
      </p>

      <div className="mcp__list">
        {rows.filter((row) => row.id !== 'google').map((row) => {
          const draft = drafts[row.id] ?? {};
          const configured = row.enabled && row.missing.length === 0;
          const check = checks[row.id];
          const checking = check === 'checking';
          const result = check && check !== 'checking' ? check : null;
          const verified = configured && result?.ok === true;
          const failed = configured && result != null && !result.ok;
          // Still treated as "connected" for layout purposes while the check
          // runs, so the card does not flip back to a Connect button and lose
          // what the user just typed.
          const connected = configured;
          const needsAttention = row.enabled && row.missing.length > 0;

          const dotClass = verified
            ? ' mcp__dot--on'
            : failed
              ? ' mcp__dot--failed'
              : needsAttention
                ? ' mcp__dot--blocked'
                : checking
                  ? ' mcp__dot--checking'
                  : '';

          const statusText = checking
            ? 'Checking the connection…'
            : verified
                ? `Connected${result?.toolCount ? ` — ${result.toolCount} tools available` : ''}`
              : failed
                  ? result?.error ?? 'Connection failed'
                : needsAttention
                  ? `Needs ${row.missing.join(', ')}`
                  : row.summary;
          const isEditing = editing === row.id || needsAttention;
          const canSubmit = row.credentials.every(
            (field) => field.present || (draft[field.key] ?? '').trim().length > 0,
          );

          return (
            <div className="conn-card mcp__card" key={row.id}>
              <div className="conn-card__header">
                <div className="conn-card__info">
                  <div className="conn-card__title-row">
                    <span className={`conn-card__dot${dotClass}`} aria-hidden="true" />
                    <span className="conn-card__title">{row.displayName}</span>
                  </div>
                  <span className={`conn-card__subtitle${failed ? ' mcp__subtitle--failed' : ''}`}>
                    {statusText}
                  </span>
                  {/* A green dot plus a tool count ("Connected — 1 tools
                      available") reads as "fully working" even when the
                      integration only covers one narrow capability (Drive's
                      MCP tool is search-only, for instance) — keep the actual
                      scope visible instead of letting the dot imply more than
                      the connection actually does. */}
                  {connected && row.summary && (
                    <span className="conn-card__scope">{row.summary}</span>
                  )}
                </div>

                {connected ? (
                  <div className="mcp__card-actions">
                    {!checking && (
                      <button
                        className="conn-card__btn conn-card__btn--secondary"
                        onClick={() => void test(row.id)}
                      >
                        {failed ? 'Retry' : 'Re-check'}
                      </button>
                    )}
                    <button
                      className="conn-card__btn conn-card__btn--secondary"
                      disabled={busy === row.id}
                      onClick={() => void signOut(row)}
                    >
                      {busy === row.id ? 'Signing out…' : 'Sign out'}
                    </button>
                  </div>
                ) : isEditing ? (
                  <button
                    className="conn-card__btn conn-card__btn--secondary"
                    disabled={busy === row.id}
                    onClick={() => { setEditing(null); void signOut(row); }}
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    className="conn-card__btn conn-card__btn--primary"
                    onClick={() => setEditing(row.id)}
                  >
                    Connect
                  </button>
                )}
              </div>

              {isEditing && !connected && (
                <div className="mcp__fields">
                  <span className="mcp__fields-summary">{row.summary}</span>
                  {row.credentials.map((field) => (
                    <label className="mcp__field" key={field.key}>
                      <span className="mcp__field-label">
                        {field.label}
                        {field.present && <span className="mcp__saved">saved</span>}
                      </span>
                      <input
                        className="mcp__input"
                        type={field.secret ? 'password' : 'text'}
                        placeholder={field.present ? '••••••••' : field.key}
                        value={draft[field.key] ?? ''}
                        onChange={(e) => setDrafts((current) => ({
                          ...current,
                          [row.id]: { ...(current[row.id] ?? {}), [field.key]: e.target.value },
                        }))}
                      />
                      {field.help && <span className="mcp__field-help">{field.help}</span>}
                    </label>
                  ))}

                  <div className="mcp__actions">
                    <button
                      className="conn-card__btn conn-card__btn--primary"
                      disabled={busy === row.id || !canSubmit}
                      onClick={() => void connect(row)}
                    >
                      {busy === row.id ? 'Connecting…' : 'Connect'}
                    </button>
                    {row.docsUrl && (
                      <a className="mcp__docs" href={row.docsUrl} target="_blank" rel="noreferrer">
                        Where to get this
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type SettingsSectionId =
  | 'settings-integrations'
  | 'settings-diagnostics'
  | 'settings-model-providers'
  | 'settings-connections'
  | 'settings-browser-sync'
  | 'settings-shortcuts'
  | 'settings-agent-approval'
  | 'settings-privacy'
  | 'settings-appearance'
  | 'settings-application';

export interface SettingsOpenIntent {
  requestId: number;
  sectionId?: SettingsSectionId;
  focusBrowserCodeProvider?: string;
}

function RailIcon({ d }: { d: string }): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface SettingsTab {
  id: SettingsSectionId;
  label: string;
  icon: string;
  /** Words the search box matches besides the label. */
  keywords: string;
  isNew?: boolean;
}

const SETTINGS_TABS: SettingsTab[] = [
  { id: 'settings-application', label: 'Application', icon: 'M2.5 3.5h11v9h-11zM2.5 6h11', keywords: 'version update download restart tab layout side top sidebar' },
  { id: 'settings-appearance', label: 'Appearance', icon: 'M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8 2.5v11', keywords: 'theme light dark system mode colour color', isNew: true },
  { id: 'settings-model-providers', label: 'Model providers', icon: 'M8 2l5 3v6l-5 3-5-3V5zM8 8l5-3M8 8v6M8 8L3 5', keywords: 'api key openai anthropic claude gemini groq ollama browsercode model provider' },
  { id: 'settings-connections', label: 'Channels', icon: 'M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7.5L4.5 14v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z', keywords: 'phone android dex app pair whatsapp telegram bot channel message text yourself notifications advanced token api mcp' },
  { id: 'settings-browser-sync', label: 'Browser Sync', icon: 'M13 8a5 5 0 01-8.6 3.5M3 8a5 5 0 018.6-3.5M11.5 2.5v2h-2M4.5 13.5v-2h2', keywords: 'cookies chrome sync login' },
  { id: 'settings-shortcuts', label: 'Shortcuts', icon: 'M2.5 4.5h11v7h-11zM5 7h.01M8 7h.01M11 7h.01M5.5 9.5h5', keywords: 'keyboard keybindings hotkey shortcut' },
  { id: 'settings-integrations', label: 'Connectors', icon: 'M6.5 9.5l3-3M5 7.5L3.8 8.7a2.5 2.5 0 003.5 3.5L8.5 11M11 8.5l1.2-1.2a2.5 2.5 0 00-3.5-3.5L7.5 5', keywords: 'connectors marketplace accounts google gmail calendar meet drive docs sheets microsoft outlook github slack reddit hugging face notion jira canva stripe pubmed flights sign in connect integrations', isNew: true },
  { id: 'settings-diagnostics', label: 'Diagnostics', icon: 'M2 8h2.5l1.5-4 3 8 1.5-4H14', keywords: 'preflight git bash node python health check missing' },
  { id: 'settings-agent-approval', label: 'Agent approval', icon: 'M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4zM5.8 8l1.6 1.6L10.5 6.5', keywords: 'permission approve ask auto full access registry safety' },
  { id: 'settings-privacy', label: 'Privacy', icon: 'M4.5 7V5.5a3.5 3.5 0 017 0V7M3.5 7h9v6.5h-9z', keywords: 'telemetry notifications data crash' },
];

interface SettingsPaneProps {
  intent?: SettingsOpenIntent | null;
  keybindings: KeyBinding[];
  overrides: Record<string, string[]>;
  onUpdateBinding: (id: ActionId, keys: string[]) => Promise<boolean>;
  onResetBinding: (id: ActionId) => void;
  onResetAll: () => void;
  formatShortcut: (shortcut: string) => string;
}

interface KeybindRowProps {
  kb: KeyBinding;
  isOverridden: boolean;
  onUpdate: (id: ActionId, keys: string[]) => Promise<boolean>;
  onReset: (id: ActionId) => void;
  platform: string;
  formatShortcut: (shortcut: string) => string;
}

function KeybindRow({ kb, isOverridden, onUpdate, onReset, platform, formatShortcut }: KeybindRowProps): React.ReactElement {
  const [recording, setRecording] = useState(false);
  const [firstKey, setFirstKey] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const isGlobalShortcut = kb.id === 'action.createPane';

  const finishRecording = useCallback(async (keys: string[]) => {
    setRecording(false);
    setFirstKey(null);
    (document.activeElement as HTMLElement | null)?.blur?.();
    const ok = await onUpdate(kb.id, keys);
    setRecordingError(ok ? null : 'That shortcut is unavailable. Choose another one.');
  }, [kb.id, onUpdate]);

  useEffect(() => {
    if (!recording) return;
    const timer = setTimeout(() => {
      if (firstKey) {
        void finishRecording([firstKey]);
      } else {
        setRecording(false);
        setRecordingError('No shortcut was detected. Choose another combination.');
      }
    }, firstKey ? 700 : 8000);

    const handler = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecording(false);
        setFirstKey(null);
        setRecordingError(null);
        return;
      }

      if (e.key === 'Unidentified') {
        clearTimeout(timer);
        setRecording(false);
        setFirstKey(null);
        setRecordingError('That shortcut is unavailable. Choose another one.');
        return;
      }

      const combo = keyboardEventToShortcut(e, platform);
      if (!combo) return;

      if (isGlobalShortcut && !e.metaKey && !e.ctrlKey && !e.altKey) return;

      if (firstKey) {
        clearTimeout(timer);
        await finishRecording([`${firstKey} ${combo}`]);
        return;
      }

      // If modifier present, commit immediately. Else wait briefly for possible chord.
      if (e.metaKey || e.ctrlKey || e.altKey) {
        clearTimeout(timer);
        await finishRecording([combo]);
        return;
      }

      setRecordingError(null);
      setFirstKey(combo);
    };
    window.addEventListener('keydown', handler, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handler, true);
    };
  }, [finishRecording, firstKey, isGlobalShortcut, platform, recording]);

  return (
    <div className={`settings-pane__row${isOverridden ? ' settings-pane__row--modified' : ''}`}>
      <div className="settings-pane__label-block">
        <span className="settings-pane__label">{kb.label}</span>
        <span className="settings-pane__sublabel">{kb.category}</span>
      </div>
      <div className="settings-pane__row-right">
        <button
          className={`settings-pane__key-btn${recording ? ' settings-pane__key-btn--recording' : ''}`}
          onClick={() => {
            setRecordingError(null);
            setRecording(true);
            setFirstKey(null);
          }}
        >
          {recording ? (
            <span className="settings-pane__recording">
              {firstKey ? `${formatShortcut(firstKey)} + ...` : 'Press key...'}
            </span>
          ) : (
            kb.keys.map((k, i) => (
              <kbd key={i} className="settings-pane__kbd">{formatShortcut(k)}</kbd>
            ))
          )}
        </button>
        <button
          className="settings-pane__reset-btn"
          onClick={() => onReset(kb.id)}
          title="Reset to default"
          style={{ visibility: isOverridden && !recording ? 'visible' : 'hidden' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 4.5h4a3 3 0 010 6h-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4.5 2.5L2.5 4.5 4.5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {recordingError && <span className="settings-pane__key-error">{recordingError}</span>}
    </div>
  );
}

/**
 * The section you're reading: the last one (in page order, not tab order —
 * the tabs aren't in the same order as the page) whose top has passed just
 * under the top edge; at the very bottom, the last section on the page,
 * since the last few can never scroll up to the top.
 */
export function sectionInView<T extends string>(scroller: HTMLElement, ids: readonly T[]): T | null {
  const top = scroller.getBoundingClientRect().top;
  const sections = ids
    .map((id) => ({ id, el: scroller.querySelector<HTMLElement>(`#${id}`) }))
    .filter((s): s is { id: T; el: HTMLElement } => !!s.el && !s.el.hidden)
    .map((s) => ({ id: s.id, top: s.el.getBoundingClientRect().top - top }))
    .sort((a, b) => a.top - b.top);
  if (sections.length === 0) return null;
  if (scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
    return sections[sections.length - 1].id;
  }
  let current = sections[0].id;
  for (const s of sections) if (s.top <= 48) current = s.id;
  return current;
}

/** Settings › Connectors: the way into the Marketplace, with what's installed. */
function MarketplaceCard(): React.ReactElement {
  const [installed, setInstalled] = useState<MarketItem[]>([]);
  useEffect(() => {
    const load = () => {
      const api = window.electronAPI?.settings;
      void Promise.all([
        api?.connectors?.list().catch(() => []) ?? [],
        api?.accounts?.list().catch(() => []) ?? [],
      ]).then(([hosted, accounts]) => {
        const on = new Set([
          ...hosted.filter((c) => c.connected).map((c) => `hosted:${c.id}`),
          ...accounts.filter((a) => a.connected).map((a) => `account:${a.provider}`),
        ]);
        setInstalled(MARKET_ITEMS.filter((i) => on.has(i.key)));
      });
    };
    load();
    window.addEventListener('dex:connectors-changed', load);
    return () => window.removeEventListener('dex:connectors-changed', load);
  }, []);
  const open = (detail?: 'installed') => window.dispatchEvent(new CustomEvent('dex:open-marketplace', { detail }));
  return (
    <div className="settings-market">
      <div className="settings-market__text">
        <span className="settings-market__title">Marketplace</span>
        <span className="settings-market__sub">
          {MARKET_ITEMS.length} connectors — Google, Microsoft 365, GitHub, Notion, Jira, Canva, Dropbox, Stripe, PubMed, Kiwi.com flights and more. One sign-in each, in your browser.
        </span>
        {installed.length > 0 && (
          <button type="button" className="settings-market__installed" onClick={() => open('installed')}>
            <span className="mk__stack">{installed.slice(0, 5).map((i) => <Mark key={i.key} item={i} size={22} />)}</span>
            {installed.length} installed ›
          </button>
        )}
      </div>
      <button type="button" className="settings-market__browse" onClick={() => open()}>Browse</button>
    </div>
  );
}

export function SettingsPane({ intent, keybindings, overrides, onUpdateBinding, onResetBinding, onResetAll, formatShortcut }: SettingsPaneProps): React.ReactElement {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('settings-application');
  const platform = window.electronAPI?.shell?.platform ?? fallbackShortcutPlatform();
  // Cookie sync is unsupported on Windows (Chromium ABE + DevTools hardening),
  // so the Browser Sync tab + section are hidden on win32.
  const tabs = useMemo(() => (platform === 'win32'
    ? SETTINGS_TABS.filter((tab) => tab.id !== 'settings-browser-sync')
    : SETTINGS_TABS), [platform]);

  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const visibleTabs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tabs;
    return tabs.filter((tab) => `${tab.label} ${tab.keywords}`.toLowerCase().includes(q));
  }, [query, tabs]);

  // Filtering hides whole sections. ConnectionsPane renders three of them
  // itself, so they're toggled by id rather than through props.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const shown = new Set(visibleTabs.map((tab) => tab.id));
    for (const tab of tabs) {
      const section = scroller.querySelector<HTMLElement>(`#${tab.id}`);
      if (section) section.hidden = !shown.has(tab.id);
    }
    if (visibleTabs.length > 0 && !shown.has(activeSection)) setActiveSection(visibleTabs[0].id);
  }, [visibleTabs, tabs, activeSection]);

  // "/" jumps to search, as on libraries.dev; Esc clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The rail's sliding pill follows the active tab.
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = (): void => {
      const btn = nav.querySelector<HTMLElement>('.settings-page__tab--active');
      if (!btn) { setPill(null); return; }
      const next = { top: btn.offsetTop, height: btn.offsetHeight };
      setPill((prev) => (prev && prev.top === next.top && prev.height === next.height ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [activeSection, visibleTabs]);

  const scrollToSection = useCallback((id: SettingsSectionId, behavior: ScrollBehavior = 'smooth') => {
    const scroller = scrollerRef.current;
    const target = scroller?.querySelector<HTMLElement>(`#${id}`);
    if (!scroller || !target) return;
    const tabOffset = 24;
    // The tab you clicked stays lit while the page glides there, even if the
    // section can't reach the top (the last ones at the bottom).
    spyLockUntilRef.current = performance.now() + 900;
    scroller.scrollTo({
      top: Math.max(0, target.offsetTop - tabOffset),
      behavior,
    });
    setActiveSection(id);
  }, []);

  // The browser fires 'scroll' as fast as it can paint frames — a trackpad
  // fling can produce dozens of events per second. Each pass here was
  // running a querySelector per tab (9 of them) plus a state update
  // (re-rendering the whole pane and its tab list) on every single one of
  // those events with no throttling at all, which is exactly what made
  // scrolling the Settings page itself feel laggy. Coalescing to one pass
  // per animation frame — the standard fix for a scroll handler — cuts
  // that to at most 60 passes/sec regardless of how many raw events fire,
  // and skipping the setState when the active tab hasn't actually changed
  // avoids re-rendering on frames where scrolling didn't cross a section
  // boundary at all.
  const spyLockUntilRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);
  const updateActiveFromScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const scroller = scrollerRef.current;
      if (!scroller || performance.now() < spyLockUntilRef.current) return;
      const next = sectionInView(scroller, visibleTabs.map((tab) => tab.id)) ?? visibleTabs[0]?.id ?? tabs[0].id;
      setActiveSection((prev) => (prev === next ? prev : next));
    });
  }, [tabs, visibleTabs]);

  useEffect(() => () => {
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
  }, []);

  useEffect(() => {
    const sectionId = intent?.sectionId ?? (
      intent?.focusBrowserCodeProvider ? 'settings-model-providers' : undefined
    );
    if (!sectionId) return;
    requestAnimationFrame(() => scrollToSection(sectionId, 'auto'));
  }, [intent?.requestId, intent?.sectionId, intent?.focusBrowserCodeProvider, scrollToSection]);

  const providerFocus: SettingsProviderFocusRequest | null = intent?.focusBrowserCodeProvider
    ? { providerId: intent.focusBrowserCodeProvider, requestId: intent.requestId }
    : null;

  return (
    <div className="settings-page">
      <aside className="settings-rail">
        <header className="settings-rail__head">
          <span className="settings-rail__mascot">
            <DexAvatar size={40} interactive />
          </span>
          <div>
            <span className="settings-page__eyebrow">DEX</span>
            <h1 className="settings-page__title">Settings</h1>
          </div>
        </header>

        <label className="settings-rail__search">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search settings"
            aria-label="Search settings"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); }
              if (e.key === 'Enter' && visibleTabs[0]) scrollToSection(visibleTabs[0].id);
            }}
          />
          {!query && <kbd>/</kbd>}
        </label>

        <nav className="settings-page__tabs" aria-label="Settings sections" ref={navRef}>
          {pill && (
            <span
              className="settings-rail__pill"
              aria-hidden="true"
              style={{ transform: `translateY(${pill.top}px)`, height: pill.height }}
            />
          )}
          {tabs.map((tab) => (
            <div key={tab.id} className="settings-rail__item" hidden={!visibleTabs.includes(tab)}>
              <button
                type="button"
                className={`settings-page__tab${activeSection === tab.id ? ' settings-page__tab--active' : ''}`}
                onClick={() => scrollToSection(tab.id)}
                data-settings-tab={tab.id}
                aria-current={activeSection === tab.id ? 'true' : undefined}
                title={tab.label}
              >
                <RailIcon d={tab.icon} />
                <span>{tab.label}</span>
              </button>
              {tab.isNew && <NewBadge scale={0.72} />}
            </div>
          ))}
        </nav>

        <div className="settings-rail__foot">Press / to search</div>
      </aside>

      <div className="settings-page__scroller" ref={scrollerRef} onScroll={updateActiveFromScroll}>
        <div className="settings-page__content">
          {visibleTabs.length === 0 && (
            <div className="settings-page__empty" role="status">
              <Orb size={32} state="searching" />
              No settings match “{query}”.
            </div>
          )}

          <section id="settings-application" className="settings-page__section">
            <div className="settings-section-header">
              <h2 className="settings-section-header__title">Application</h2>
            </div>
            <AppSection />
            <LayoutSection />
          </section>

          <section id="settings-appearance" className="settings-page__section">
            <div className="settings-section-header">
              <h2 className="settings-section-header__title">Appearance</h2>
            </div>
            <AppearanceSection />
          </section>

          <ConnectionsPane
            embedded
            providerSectionId="settings-model-providers"
            connectionsSectionId="settings-connections"
            browserSyncSectionId="settings-browser-sync"
            focusBrowserCodeProvider={providerFocus}
            channelsFirst={<PhoneCard />}
            channelsLast={(
              <details className="channels-advanced">
                <summary>Advanced — connect with a token</summary>
                <McpSection />
              </details>
            )}
          />

          <section id="settings-integrations" className="settings-page__section">
            <div className="settings-section-header">
              <h2 className="settings-section-header__title">Connectors</h2>
            </div>
            <MarketplaceCard />
          </section>

          <section id="settings-diagnostics" className="settings-page__section">
            <div className="settings-section-header">
              <h2 className="settings-section-header__title">Diagnostics</h2>
            </div>
            <DiagnosticsSection />
          </section>

          <section id="settings-shortcuts" className="settings-page__section">
            <div className="settings-section-header">
              <h2 className="settings-section-header__title">Shortcuts</h2>
              {Object.keys(overrides).length > 0 && (
                <button className="settings-pane__reset-all" onClick={onResetAll}>Reset all</button>
              )}
            </div>
            <div className="settings-card settings-card--shortcuts">
              {keybindings.map((kb) => (
                <KeybindRow
                  key={kb.id}
                  kb={kb}
                  isOverridden={kb.id in overrides}
                  onUpdate={onUpdateBinding}
                  onReset={onResetBinding}
                  platform={platform}
                  formatShortcut={formatShortcut}
                />
              ))}
            </div>
          </section>

          <section id="settings-agent-approval" className="settings-page__section">
            <div className="settings-section-header">
              <h2 className="settings-section-header__title">Agent approval</h2>
            </div>
            <AgentApprovalSection />
          </section>

          <section id="settings-privacy" className="settings-page__section settings-page__section--last">
            <div className="settings-section-header">
              <h2 className="settings-section-header__title">Privacy</h2>
            </div>
            <PrivacySection />
          </section>
        </div>
      </div>
    </div>
  );
}
