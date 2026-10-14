/**
 * Settings › Desktop control (src/main/desktop/deskSettings.ts): app names as
 * the Windows tools see them, the lists kept clean, and when the first use of
 * an app in a task asks.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { firstUseApp, normalizeApp, readDeskSettings, writeDeskSettings } from '../../../src/main/desktop/deskSettings';
import { blockedReason, classify } from '../../../mcp-servers/windows/policy.mjs';

describe('desktop control settings', () => {
  it('names apps the way the Windows tools see them', () => {
    expect(normalizeApp('Outlook')).toBe('outlook.exe');
    expect(normalizeApp('  "Spotify.EXE" ')).toBe('spotify.exe');
    expect(normalizeApp('C:/Program Files/WindowsApps/olk.exe')).toBe('olk.exe');
    expect(normalizeApp('rm -rf /;')).toBeNull();
    expect(normalizeApp('')).toBeNull();
    expect(normalizeApp(42)).toBeNull();
  });

  it('keeps the lists clean, and an app on one list only', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-desk-set-'));
    expect(readDeskSettings(home)).toEqual({ blocked: [], askFirst: [], firstUseAsks: false });
    const next = writeDeskSettings(home, { askFirst: ['Outlook', 'outlook.exe', 'WhatsApp', 'bad;name'], blocked: ['whatsapp'], firstUseAsks: true });
    expect(next).toEqual({ blocked: ['whatsapp.exe'], askFirst: ['outlook.exe'], firstUseAsks: true });
    expect(readDeskSettings(home)).toEqual(next);
    // A patch changes only what it names.
    expect(writeDeskSettings(home, { firstUseAsks: false })).toMatchObject({ blocked: ['whatsapp.exe'], askFirst: ['outlook.exe'], firstUseAsks: false });
  });

  it('asks about an ask-first app in every mode, and every app with "first use asks" except under Full access', () => {
    const settings = { blocked: [] as string[], askFirst: ['outlook.exe'], firstUseAsks: false };
    expect(firstUseApp(settings, 'OUTLOOK.EXE', 'full', undefined)).toBe('outlook.exe');
    expect(firstUseApp(settings, 'Spotify.exe', 'auto', undefined)).toBeNull();
    const everyApp = { ...settings, firstUseAsks: true };
    expect(firstUseApp(everyApp, 'Spotify.exe', 'auto', undefined)).toBe('spotify.exe');
    expect(firstUseApp(everyApp, 'Spotify.exe', 'full', undefined)).toBeNull();
    // Once the user said yes for this task, it doesn't ask again.
    expect(firstUseApp(everyApp, 'Spotify.exe', 'auto', new Set(['spotify.exe']))).toBeNull();
    // Not an app: playback controls, a link to open.
    expect(firstUseApp(everyApp, 'media', 'auto', undefined)).toBeNull();
    expect(firstUseApp(everyApp, 'spotify:playlist:x', 'auto', undefined)).toBeNull();
    expect(firstUseApp(everyApp, 'C:/Apps/Spotify/Spotify.exe', 'auto', undefined)).toBe('spotify.exe');
  });

  it('the Windows server refuses apps the user put off-limits, saying why', () => {
    const notes = { process: 'Notes.exe', title: 'notes' };
    expect(blockedReason(notes)).toBeNull();
    expect(blockedReason(notes, ['notes.exe'])).toMatch(/you asked DEX not to use it/);
    expect(classify('window_tree', {}, notes, { userBlocked: ['notes.exe'] }).refused).toMatch(/Notes/);
    expect(classify('window_tree', {}, notes)).toEqual({ tier: 0 });
  });
});
