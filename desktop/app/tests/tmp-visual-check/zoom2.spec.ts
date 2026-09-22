import { test } from '@playwright/test';
import { chromium } from '@playwright/test';

const OUT_DIR = 'C:\Users\cheth\AppData\Local\Temp\claude\C--Users-cheth-OneDrive-Desktop-DEXV3\5ae4348a-e526-4633-ad61-df8cdcdb9aa9\scratchpad';

test('tight zoomed crop after fixes', async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const contexts = browser.contexts();
  const page = contexts[0].pages().find((p) => p.url().includes('hub.html')) ?? contexts[0].pages()[0];
  await page.reload();
  await page.waitForTimeout(1500);

  const box = await page.locator('.task-input__send').first().boundingBox();
  if (!box) throw new Error('button not found');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const pad = 70;

  await page.screenshot({
    path: `${OUT_DIR}/fix2-rest.png`,
    clip: { x: cx - pad, y: cy - pad, width: pad * 2, height: pad * 2 },
  });

  await page.mouse.move(cx - 200, cy - 100);
  await page.mouse.move(cx, cy, { steps: 20 });
  await page.waitForTimeout(500);

  await page.screenshot({
    path: `${OUT_DIR}/fix2-hover.png`,
    clip: { x: cx - pad, y: cy - pad, width: pad * 2, height: pad * 2 },
  });

  await browser.close();
});
