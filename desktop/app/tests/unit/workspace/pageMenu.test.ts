import { describe, expect, it, vi } from 'vitest';
import { pageMenuTemplate, type PageMenuActions } from '../../../src/main/workspace/pageMenu';
import { nextZoom } from '../../../src/main/sessions/BrowserPool';

function actions(): PageMenuActions {
  return { find: vi.fn(), zoom: vi.fn(), print: vi.fn(), copyLink: vi.fn(), openExternally: vi.fn(), clearSiteData: vi.fn(), devTools: vi.fn() };
}

const item = (template: ReturnType<typeof pageMenuTemplate>, id: string) => template.find((i) => i.id === id)!;
const click = (template: ReturnType<typeof pageMenuTemplate>, id: string) =>
  (item(template, id).click as () => void)();

describe('the page’s ⋯ menu', () => {
  it('offers find, zoom, print, the link, the browser, site data and devtools for a web page', () => {
    const act = actions();
    const t = pageMenuTemplate({ url: 'https://www.example.com/a?b=1', zoom: 125 }, act);
    expect(t.filter((i) => i.type !== 'separator').map((i) => i.label)).toEqual([
      'Find in page…', 'Zoom in', 'Zoom out', 'Actual size (now 125%)', 'Print…', 'Copy link',
      'Open in your browser', 'Clear data for www.example.com…', 'Developer tools',
    ]);
    expect(t.every((i) => i.type === 'separator' || i.enabled !== false)).toBe(true);
    click(t, 'zoom-reset');
    expect(act.zoom).toHaveBeenCalledWith('reset');
    click(t, 'clear-site-data');
    expect(act.clearSiteData).toHaveBeenCalled();
  });

  it('greys out what needs a web page, and the reset at 100%', () => {
    const t = pageMenuTemplate({ url: 'about:blank', zoom: 100 }, actions());
    for (const id of ['find', 'zoom-reset', 'print', 'copy-link', 'open-external', 'clear-site-data', 'devtools']) {
      expect(item(t, id).enabled, id).toBe(false);
    }
    expect(item(t, 'zoom-in').enabled).not.toBe(false);
    const file = pageMenuTemplate({ url: 'file:///C:/x.html', zoom: 100 }, actions());
    expect(item(file, 'print').enabled).toBe(true);
    expect(item(file, 'open-external').enabled).toBe(false);
  });

  it('zooms in Chrome’s steps, from any level, within its range', () => {
    expect(nextZoom(1, 'in')).toBe(1.1);
    expect(nextZoom(1, 'out')).toBe(0.9);
    expect(nextZoom(1.18, 'in')).toBe(1.25);
    expect(nextZoom(1.18, 'out')).toBe(1.1);
    expect(nextZoom(5, 'in')).toBe(5);
    expect(nextZoom(0.25, 'out')).toBe(0.25);
    expect(nextZoom(3, 'reset')).toBe(1);
  });
});
