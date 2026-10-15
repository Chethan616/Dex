// Renders DEX's desktop hub in a headless browser (Edge) with sample data, no
// Electron and no window on screen, and saves the shots readme_frames.py uses.
//
//   1. cd desktop/app && npx vite --config vite.hub.config.mts --port 5199 --strictPort
//   2. node docs/play-store/tools/desk/capture.mjs [dashboard flights approval routines marketplace]
//
// mock.js stands in for the preload (window.electronAPI); sample.js holds the
// tasks. Shots and boxes.json (where the cards to lift are) go to ./out.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(pathToFileURL(path.resolve(HERE, '../../../../desktop/app/node_modules/@playwright/test/index.mjs')).href);
const OUT = process.env.DEX_DESK_SHOTS || path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });
const init = fs.readFileSync(path.join(HERE, 'sample.js'), 'utf8') + '\n' + fs.readFileSync(path.join(HERE, 'mock.js'), 'utf8');
const only = process.argv.slice(2);

const browser = await chromium.launch({ channel: 'msedge', headless: true });

async function open(openDoc = null) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Query data cannot be undefined|Failed to load resource/.test(m.text())) console.log('console:', m.text().slice(0, 400)); });
  // The sample task's files (the 3D model, the render), from DEX_SAMPLE_FILES.
  const files = process.env.DEX_SAMPLE_FILES;
  if (files) await page.route('**/__sample/**', (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
    const file = path.join(files, name);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404 });
    route.fulfill({ body: fs.readFileSync(file), contentType: name.endsWith('.glb') ? 'model/gltf-binary' : 'image/png' });
  });
  if (openDoc) await page.addInitScript((d) => { window.__DEX_OPEN_DOC__ = d; }, openDoc);
  await page.addInitScript(init);
  // No keyboard-hint bar in the shots.
  await page.addInitScript(() => {
    const css = '.cmdhints{display:none!important}' + (window.__HIDE_DECK__ ? '.deck{display:none!important}' : '');
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); });
  });
  await page.goto('http://localhost:5199/hub.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  return page;
}


const boxes = {};
/** The card around `text`: the first ancestor at least `minH` CSS px tall, in screenshot pixels. */
async function boxOf(page, text, minH, exact = false) {
  return page.evaluate(([text, minH, exact]) => {
    const it = document.evaluate(exact ? `//*[normalize-space(text())=${JSON.stringify(text)}]` : `//*[contains(text(), ${JSON.stringify(text)})]`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    let el = it.singleNodeValue;
    while (el && el.getBoundingClientRect().height < minH) el = el.parentElement;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    return [r.left * 2, r.top * 2, r.right * 2, r.bottom * 2, radius * 2];
  }, [text, minH, exact]);
}
/** Hide the floating thing that holds `text` (its nearest absolutely or fixed positioned ancestor). */
async function hideFloating(page, text) {
  await page.evaluate((text) => {
    const it = document.evaluate(`//*[contains(text(), ${JSON.stringify(text)})]`, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < it.snapshotLength; i++) {
      let el = it.snapshotItem(i);
      while (el && !['absolute', 'fixed'].includes(getComputedStyle(el).position)) el = el.parentElement;
      if (el && el.getBoundingClientRect().width < 700) el.style.display = 'none';
    }
  }, text);
}
async function scrollChatsToTop(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(cs.overflowY)) el.scrollTop = 0;
    }
  });
}

const shots = {
  async dashboard(page) {
    await page.getByRole('button', { name: 'Dashboard' }).click();
    await page.mouse.move(700, 880);
    await page.waitForTimeout(1500);
  },
  async flights(page) {
    await page.getByText('Find the cheapest flight fr', { exact: false }).first().click();
    await page.waitForTimeout(1500);
    await hideFloating(page, 'Sources');
    await scrollChatsToTop(page);
    await page.waitForTimeout(500);
    await page.evaluate(() => { for (const b of document.querySelectorAll('button')) if (/latest|bottom|newest/i.test(b.getAttribute('aria-label') || b.title || '')) b.style.display = 'none'; });
    boxes.flights = await boxOf(page, 'IndiGo 6E 6421', 120, true);
  },
  async approval(page) {
    await page.getByText('My Wi-Fi keeps dropping', { exact: false }).first().click();
    await page.waitForTimeout(1200);
    await hideFloating(page, 'working');
    await page.waitForTimeout(400);
    boxes.approval = await boxOf(page, 'Needs your approval', 140);
  },
  async routines(page) {
    await page.getByText('Show my routines', { exact: false }).first().click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /^View/ }).first().click();
    await page.waitForTimeout(1500);
  },
  async model(page) {
    await page.getByText('Make a cozy isometric', { exact: false }).first().click();
    // The model, turned to the render's angle, still.
    await page.waitForFunction(() => document.querySelector('model-viewer')?.loaded === true, null, { timeout: 30000 });
    await page.evaluate(() => {
      const mv = document.querySelector('model-viewer');
      mv.removeAttribute('auto-rotate');
      mv.setAttribute('camera-orbit', '45deg 60deg 150%');
      mv.setAttribute('camera-target', 'auto 0.75m auto');
      mv.setAttribute('field-of-view', '36deg');
      mv.jumpCameraToGoal?.();
    });
    await page.mouse.move(700, 880);
    await page.waitForTimeout(2500);
  },
  async marketplace(page) {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('dex:open-marketplace')));
    await page.waitForTimeout(2000);
  },
};

for (const [name, run] of Object.entries(shots)) {
  if (only.length && !only.includes(name)) continue;
  const page = await open(name === 'model' ? 'reading-nook.glb' : null);
  try {
    await run(page);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('shot', name);
  } catch (e) {
    console.log('failed', name, e.message.split('\n')[0]);
    await page.screenshot({ path: path.join(OUT, `${name}-failed.png`) });
  }
  await page.close();
}
// Merge: a run of some shots keeps the other shots' boxes.
const boxesFile = path.join(OUT, 'boxes.json');
const prior = fs.existsSync(boxesFile) ? JSON.parse(fs.readFileSync(boxesFile, 'utf8')) : {};
fs.writeFileSync(boxesFile, JSON.stringify({ ...prior, ...boxes }, null, 1));
await browser.close();
