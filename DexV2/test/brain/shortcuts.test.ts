import { expect, test, describe, vi, beforeEach } from 'vitest';
import { getAppShortcuts, rescanShortcuts } from '../../src/brain/shortcuts.js';
import { tryDeterministic } from '../../src/brain/deterministic.js';
import fs from 'fs';
import os from 'os';

describe('shortcuts discovery tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    rescanShortcuts();
  });

  test('indexes mock shortcuts and aliases', () => {
    // Mock platform to Windows so it runs scan
    vi.spyOn(os, 'platform').mockReturnValue('win32');

    // Mock existsSync to return true for start menu paths
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    // Mock readdirSync
    vi.spyOn(fs, 'readdirSync').mockImplementation((dirPath: any) => {
      if (dirPath.toString().includes('Programs')) {
        return ['Vivaldi.lnk', 'Google Chrome.lnk'] as any;
      }
      return [];
    });

    // Mock statSync
    vi.spyOn(fs, 'statSync').mockReturnValue({
      isDirectory: () => false,
      isFile: () => true
    } as any);

    const shortcuts = getAppShortcuts();
    expect(shortcuts.get('vivaldi')).toBeDefined();
    expect(shortcuts.get('google chrome')).toBeDefined();
    // Test word subset alias ("google chrome" -> "chrome")
    expect(shortcuts.get('chrome')).toBeDefined();
  });

  test('tryDeterministic matches indexed shortcuts', () => {
    vi.spyOn(os, 'platform').mockReturnValue('win32');
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockImplementation((dirPath: any) => {
      if (dirPath.toString().includes('Programs')) {
        return ['Vivaldi.lnk'] as any;
      }
      return [];
    });
    vi.spyOn(fs, 'statSync').mockReturnValue({
      isDirectory: () => false
    } as any);

    rescanShortcuts();

    const action = tryDeterministic('open vivaldi');
    expect(action).not.toBeNull();
    expect(action?.tool).toBe('shell');
    expect(action?.cmd).toContain('Vivaldi.lnk');
  });
});
