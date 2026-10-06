// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sectionInView } from '../../../src/renderer/hub/SettingsPane';

/** A scroller whose sections sit at the given tops (relative to its top edge). */
function page(tops: Record<string, number>, scroll: { top: number; height: number; client: number }) {
  const scroller = document.createElement('div');
  Object.defineProperty(scroller, 'scrollTop', { value: scroll.top });
  Object.defineProperty(scroller, 'scrollHeight', { value: scroll.height });
  Object.defineProperty(scroller, 'clientHeight', { value: scroll.client });
  scroller.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
  for (const [id, top] of Object.entries(tops)) {
    const s = document.createElement('section');
    s.id = id;
    s.getBoundingClientRect = () => ({ top: 100 + top } as DOMRect);
    scroller.appendChild(s);
  }
  return scroller;
}

describe('the Settings sidebar follows the page', () => {
  // The tabs list Shortcuts before Accounts, but the page has it lower down.
  const tabs = ['application', 'shortcuts', 'accounts', 'diagnostics', 'approval', 'privacy'] as const;

  it('lights the section whose top has just passed, in page order', () => {
    const scroller = page({ application: -900, accounts: -300, diagnostics: 20, shortcuts: 400, approval: 900, privacy: 1200 }, { top: 900, height: 4000, client: 800 });
    expect(sectionInView(scroller, tabs)).toBe('diagnostics');
  });

  it('lights the last section at the very bottom, though it can never reach the top', () => {
    const scroller = page({ application: -2900, accounts: -2300, diagnostics: -1800, shortcuts: -900, approval: 300, privacy: 500 }, { top: 3200, height: 4000, client: 800 });
    expect(sectionInView(scroller, tabs)).toBe('privacy');
  });

  it('starts on the first section, and skips sections a search hid', () => {
    const scroller = page({ application: 0, accounts: 600 }, { top: 0, height: 4000, client: 800 });
    expect(sectionInView(scroller, tabs)).toBe('application');
    (scroller.querySelector('#application') as HTMLElement).hidden = true;
    expect(sectionInView(scroller, tabs)).toBe('accounts');
  });
});
