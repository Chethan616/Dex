import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../src/main/consent', () => ({
  isTelemetryConsented: () => true,
}));

vi.mock('../../src/main/installId', () => ({
  getInstallId: () => 'test-install-id',
}));

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tel-remote-test-'));
}

describe('PostHog remote telemetry payloads', () => {
  let tmpDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = makeTempDir();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    // DEX ships with no analytics destination, so remote sending is off unless
    // one is configured. These tests are specifically about the remote payload
    // shape, so give them a destination. The key is read at module load, hence
    // the reset before each dynamic import.
    process.env.DEX_POSTHOG_KEY = 'phc_test_key';
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DEX_POSTHOG_KEY;
    vi.resetModules();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes distinct_id on metric events', async () => {
    const { TelemetryEmitter } = await import('../../src/main/telemetry');
    const tel = new TelemetryEmitter({ userDataPath: tmpDir, mode: 'remote' });

    tel.increment('daemon_crash_count', 1, { source: 'unit-test' });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({
      event: 'metric.daemon_crash_count',
      distinct_id: 'test-install-id',
    });
    expect(body.properties).toMatchObject({
      kind: 'counter',
      value: 1,
      source: 'unit-test',
    });
  });

  it('includes distinct_id on product capture events', async () => {
    const { captureEvent } = await import('../../src/main/telemetry');

    captureEvent('unit_test_event', { source: 'unit-test' });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({
      event: 'unit_test_event',
      distinct_id: 'test-install-id',
    });
    expect(body.properties).toMatchObject({
      source: 'unit-test',
    });
  });
});

/**
 * DEX is a fork. Upstream ships its own PostHog key in-source, so inheriting it
 * would send DEX users' usage to browser-use's analytics under DEX's name.
 * The default here is no destination at all — these lock that in, so it can't
 * be undone by an upstream merge without a test going red.
 */
describe('no analytics destination configured (the DEX default)', () => {
  let tmpDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = makeTempDir();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    delete process.env.DEX_POSTHOG_KEY;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sends no metric events anywhere', async () => {
    const { TelemetryEmitter } = await import('../../src/main/telemetry');
    const tel = new TelemetryEmitter({ userDataPath: tmpDir, mode: 'remote' });

    tel.increment('daemon_crash_count', 1, { source: 'unit-test' });

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends no product capture events anywhere', async () => {
    const { captureEvent } = await import('../../src/main/telemetry');

    captureEvent('unit_test_event', { source: 'unit-test' });

    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still writes telemetry locally, so debugging is unaffected', async () => {
    const { TelemetryEmitter } = await import('../../src/main/telemetry');
    const tel = new TelemetryEmitter({ userDataPath: tmpDir, mode: 'remote' });

    tel.increment('daemon_crash_count', 1, { source: 'unit-test' });

    await vi.waitFor(() => {
      const jsonl = path.join(tmpDir, 'telemetry.jsonl');
      expect(fs.existsSync(jsonl)).toBe(true);
      expect(fs.readFileSync(jsonl, 'utf8')).toContain('daemon_crash_count');
    });
  });
});
