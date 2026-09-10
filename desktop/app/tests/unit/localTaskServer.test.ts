import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalTaskServer, LOCAL_TASK_CONTROL_FILE } from '../../src/main/localTaskServer';

const handles: Array<{ close(): Promise<void> }> = [];
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-task-server-'));
  tempDirs.push(dir);
  return dir;
}

describe('localTaskServer', () => {
  afterEach(async () => {
    await Promise.all(handles.splice(0).map((h) => h.close()));
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes a control file and accepts authorized task submissions', async () => {
    const userDataPath = makeTempDir();
    const seen: unknown[] = [];
    const handle = await createLocalTaskServer({
      userDataPath,
      submitTask: async (payload) => {
        seen.push(payload);
        return { id: 'session-1', started: true };
      },
    });
    handles.push(handle);

    const controlPath = path.join(userDataPath, LOCAL_TASK_CONTROL_FILE);
    expect(fs.existsSync(controlPath)).toBe(true);

    const res = await fetch(`${handle.url}/tasks`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${handle.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'test prompt', engine: 'codex' }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, id: 'session-1', started: true });
    expect(seen).toEqual([{ prompt: 'test prompt', engine: 'codex' }]);
  });

  it('rejects requests without the control token', async () => {
    const handle = await createLocalTaskServer({
      userDataPath: makeTempDir(),
      submitTask: async () => ({ id: 'should-not-run' }),
    });
    handles.push(handle);

    const res = await fetch(`${handle.url}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'test prompt' }),
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  // The dex-* CLIs reach the app through these. They are the only channel a
  // tool running in the agent's shell has, so an unauthenticated or unrouted
  // request must fail closed rather than fall through to /tasks.
  describe('dex tool routes', () => {
    it('dispatches an authorized request to the matching route', async () => {
      const seen: string[] = [];
      const handle = await createLocalTaskServer({
        userDataPath: makeTempDir(),
        submitTask: async () => ({ id: 'not-used' }),
        routes: {
          'POST /dex/state': async (body) => {
            seen.push(body);
            return { state: { objective: 'demo', steps: [] } };
          },
        },
      });
      handles.push(handle);

      const res = await fetch(`${handle.url}/dex/state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${handle.token}` },
        body: JSON.stringify({ sessionId: 's1', op: 'get' }),
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true, state: { objective: 'demo', steps: [] } });
      expect(JSON.parse(seen[0])).toEqual({ sessionId: 's1', op: 'get' });
    });

    it('rejects an unauthorized route request without invoking the handler', async () => {
      let called = false;
      const handle = await createLocalTaskServer({
        userDataPath: makeTempDir(),
        submitTask: async () => ({ id: 'not-used' }),
        routes: {
          'POST /dex/state': async () => {
            called = true;
            return {};
          },
        },
      });
      handles.push(handle);

      const res = await fetch(`${handle.url}/dex/state`, { method: 'POST', body: '{}' });

      expect(res.status).toBe(401);
      expect(called).toBe(false);
    });

    it('turns a thrown handler error into a 400 that names the reason', async () => {
      const handle = await createLocalTaskServer({
        userDataPath: makeTempDir(),
        submitTask: async () => ({ id: 'not-used' }),
        routes: {
          'POST /dex/state': async () => {
            throw new Error('unknown step step_9');
          },
        },
      });
      handles.push(handle);

      const res = await fetch(`${handle.url}/dex/state`, {
        method: 'POST',
        headers: { authorization: `Bearer ${handle.token}` },
        body: '{}',
      });

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ ok: false, error: 'unknown step step_9' });
    });

    it('does not match a route registered for a different method', async () => {
      const handle = await createLocalTaskServer({
        userDataPath: makeTempDir(),
        submitTask: async () => ({ id: 'not-used' }),
        routes: { 'POST /dex/state': async () => ({}) },
      });
      handles.push(handle);

      const res = await fetch(`${handle.url}/dex/state`, {
        method: 'GET',
        headers: { authorization: `Bearer ${handle.token}` },
      });

      expect(res.status).toBe(404);
    });

    it('still serves /tasks when routes are supplied', async () => {
      const handle = await createLocalTaskServer({
        userDataPath: makeTempDir(),
        submitTask: async () => ({ id: 'session-9' }),
        routes: { 'POST /dex/state': async () => ({}) },
      });
      handles.push(handle);

      const res = await fetch(`${handle.url}/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${handle.token}` },
        body: JSON.stringify({ prompt: 'hello' }),
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true, id: 'session-9' });
    });
  });

  it('removes its own control file when closed', async () => {
    const userDataPath = makeTempDir();
    const handle = await createLocalTaskServer({
      userDataPath,
      submitTask: async () => ({ id: 'session-1' }),
    });
    const controlPath = path.join(userDataPath, LOCAL_TASK_CONTROL_FILE);
    expect(fs.existsSync(controlPath)).toBe(true);

    await handle.close();

    expect(fs.existsSync(controlPath)).toBe(false);
  });
});
