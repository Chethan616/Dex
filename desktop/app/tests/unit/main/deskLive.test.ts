/**
 * The Desk tab, main's side (src/main/desktop/deskLive.ts): what DEX is
 * doing in which window, the user's Show me / Hand back, and the live
 * pictures — only while someone is looking.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeskLive, deskFileId, type WindowOpResult } from '../../../src/main/desktop/deskLive';

const SID = '0f6c1c62-7a1b-4f43-9a52-2b1e0c3d4e5f';
const spotify = { hwnd: 4242, title: 'Spotify Premium', process: 'Spotify.exe', openedByDex: true, takenOver: false };

function rig(op: (op: 'show' | 'park', hwnd: number) => WindowOpResult = () => ({ ok: true })) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-desk-'));
  const sent: Array<{ channel: string; args: unknown[] }> = [];
  const ops: Array<{ op: string; hwnd: number; takenFile: string | null }> = [];
  const taken = () => path.join(home, 'live', `${deskFileId(SID)}.taken.json`);
  const desk = new DeskLive({
    home: () => home,
    send: (channel, ...args) => sent.push({ channel, args }),
    windowOp: async (o, hwnd) => {
      ops.push({ op: o, hwnd, takenFile: fs.existsSync(taken()) ? fs.readFileSync(taken(), 'utf-8') : null });
      return op(o, hwnd);
    },
  });
  return { home, desk, sent, ops, taken };
}

let live: DeskLive | null = null;
afterEach(() => { live?.stopAll(); live = null; });

describe('the Desk tab, in main', () => {
  it('says what DEX is doing, in which window, as each call starts and ends', () => {
    const { desk, sent } = rig();
    desk.noteAct(SID, { seq: 1, phase: 'start', tool: 'ui_invoke', args: { target: 'e7' }, window: spotify });
    expect(desk.state(SID)).toMatchObject({ window: { hwnd: 4242, process: 'Spotify.exe', openedByDex: true }, caption: 'Pressing a control in Spotify', acting: true, taken: [] });
    desk.noteAct(SID, { seq: 1, phase: 'end', tool: 'ui_invoke', args: { target: 'e7' }, window: spotify, ok: true, element: { name: 'Shuffle', role: 'Button' } });
    expect(desk.state(SID)).toMatchObject({ caption: 'Pressed “Shuffle” in Spotify', acting: false });
    // A tool without a window keeps the window, and still says what it does.
    desk.noteAct(SID, { seq: 2, phase: 'start', tool: 'media', args: { action: 'shuffle', value: true }, window: null });
    expect(desk.state(SID)).toMatchObject({ window: { hwnd: 4242 }, caption: 'Turning shuffle on' });
    expect(sent.filter((s) => s.channel === 'desk:changed')).toHaveLength(3);
  });

  it('ignores a start that arrives after its own end, and an end that arrives late', () => {
    const { desk } = rig();
    desk.noteAct(SID, { seq: 3, phase: 'end', tool: 'ui_invoke', window: spotify, ok: true, element: { name: 'Play' } });
    desk.noteAct(SID, { seq: 3, phase: 'start', tool: 'ui_invoke', window: spotify });
    expect(desk.state(SID)).toMatchObject({ caption: 'Pressed “Play” in Spotify', acting: false });
    desk.noteAct(SID, { seq: 4, phase: 'start', tool: 'window_tree', window: spotify });
    desk.noteAct(SID, { seq: 2, phase: 'end', tool: 'ui_invoke', window: spotify, ok: true });
    expect(desk.state(SID)).toMatchObject({ caption: 'Reading what’s in Spotify', acting: true });
  });

  it('lists the window as yours before it moves for Show me, and parks it again on Hand back', async () => {
    const { desk, ops, taken } = rig();
    desk.noteAct(SID, { seq: 1, phase: 'end', tool: 'window_tree', window: spotify, ok: true });
    expect((await desk.showMe(SID)).ok).toBe(true);
    // The helper had the list before the window came on screen: it never parks it back.
    expect(ops[0]).toEqual({ op: 'show', hwnd: 4242, takenFile: JSON.stringify({ hwnds: [4242] }) });
    expect(desk.state(SID)!.taken).toEqual([4242]);
    await desk.handBack(SID);
    expect(ops[1]).toMatchObject({ op: 'park', hwnd: 4242 });
    expect(desk.state(SID)!.taken).toEqual([]);
    expect(fs.existsSync(taken())).toBe(false);
  });

  it('never parks a window DEX didn’t open; Hand back only lets DEX use it again', async () => {
    const { desk, ops } = rig();
    desk.noteAct(SID, { seq: 1, phase: 'end', tool: 'window_tree', window: { ...spotify, process: 'notepad.exe', openedByDex: false }, ok: true });
    await desk.showMe(SID);
    await desk.handBack(SID);
    expect(ops.map((o) => o.op)).toEqual(['show']);
  });

  it('takes the window off the list again when Show me fails', async () => {
    const { desk, taken } = rig(() => ({ ok: false, error: 'closed' }));
    desk.noteAct(SID, { seq: 1, phase: 'end', tool: 'window_tree', window: spotify, ok: true });
    expect(await desk.showMe(SID)).toEqual({ ok: false, error: 'closed' });
    expect(desk.state(SID)!.taken).toEqual([]);
    expect(fs.existsSync(taken())).toBe(false);
  });

  it('remembers a window the user took themselves, and one the helper already calls taken', () => {
    const { desk, taken } = rig();
    desk.noteTakenOver(SID, { hwnd: 77, process: 'Spotify.exe' });
    expect(JSON.parse(fs.readFileSync(taken(), 'utf-8'))).toEqual({ hwnds: [77] });
    desk.noteAct(SID, { seq: 1, phase: 'start', tool: 'window_tree', window: { ...spotify, takenOver: true } });
    expect(desk.state(SID)!.taken).toEqual([77, 4242]);
  });

  it('asks for pictures only while watched, and sends only this task’s own', async () => {
    const { desk, sent, home } = rig();
    live = desk;
    const id = deskFileId(SID);
    const dir = path.join(home, 'live');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}-1.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ seq: 1, file: `${id}-1.jpg`, at: 1, width: 10, height: 8, focus: { box: [1, 2, 3, 4] } }));

    desk.watch(SID, true);
    await desk.pump(SID);
    await new Promise((r) => setTimeout(r, 20));
    expect(fs.existsSync(path.join(dir, `${id}.want`))).toBe(true);
    const frames = sent.filter((s) => s.channel === 'desk:frame');
    expect(frames).toHaveLength(1);
    expect(frames[0].args[1]).toEqual({ seq: 1, at: 1, width: 10, height: 8, focus: { box: [1, 2, 3, 4] } });
    expect(Buffer.from(frames[0].args[2] as Buffer)).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    // Another task's file named in the meta is never read.
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ seq: 2, file: '../secret.jpg', at: 2, width: 1, height: 1 }));
    fs.utimesSync(path.join(dir, `${id}.json`), new Date(), new Date(Date.now() + 5000));
    await desk.pump(SID);
    expect(sent.filter((s) => s.channel === 'desk:frame')).toHaveLength(1);

    // Two Desk tabs on screen, one closes: still watched.
    desk.watch(SID, true);
    desk.watch(SID, false);
    expect(fs.existsSync(path.join(dir, `${id}.want`))).toBe(true);
    desk.watch(SID, false);
    expect(fs.existsSync(path.join(dir, `${id}.want`))).toBe(false);
  });

  it('forgets a deleted task, files and all', () => {
    const { desk, home } = rig();
    const id = deskFileId(SID);
    const dir = path.join(home, 'live');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of [`${id}.json`, `${id}-0.jpg`, `${id}.taken.json`]) fs.writeFileSync(path.join(dir, f), 'x');
    desk.noteAct(SID, { seq: 1, phase: 'end', tool: 'window_tree', window: spotify, ok: true });
    desk.forget(SID);
    expect(desk.state(SID)).toBeNull();
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
