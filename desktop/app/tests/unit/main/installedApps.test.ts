/**
 * The apps on this PC (src/main/desktop/installedApps.ts), for the "Ask first"
 * and "Never use" pickers: one entry per process, named as Windows shows it.
 */
import { describe, expect, it } from 'vitest';
import { parseInstalledApps } from '../../../src/main/desktop/installedApps';

describe('installed apps', () => {
  it('keeps one entry per process, sorted by name, and drops anything that isn’t a program name', () => {
    const json = JSON.stringify([
      { exe: 'whatsapp.root.exe', name: 'WhatsApp' },
      { exe: 'Code.exe', name: 'Visual Studio Code' },
      { exe: 'code.exe', name: 'Code (duplicate)' },
      { exe: 'evil;rm.exe', name: 'Bad' },
      { exe: 'notes.txt', name: 'Not a program' },
      { exe: 'calculatorapp.exe', name: '' },
    ]);
    expect(parseInstalledApps(json)).toEqual([
      { exe: 'code.exe', name: 'Visual Studio Code' },
      { exe: 'whatsapp.root.exe', name: 'WhatsApp' },
    ]);
  });

  it('copes with one app (not an array), nothing, or noise', () => {
    expect(parseInstalledApps('{"exe":"spotify.exe","name":"Spotify"}')).toEqual([{ exe: 'spotify.exe', name: 'Spotify' }]);
    expect(parseInstalledApps('')).toEqual([]);
    expect(parseInstalledApps('not json')).toEqual([]);
  });
});
