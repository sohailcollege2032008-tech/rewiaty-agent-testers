/**
 * Evidence shot for R2 (two-page spread): runs the dev harness in a real Chromium at
 * 1366x1024 with the Arabic sample and writes `.factory/evidence/r2/spread-ar.png`.
 *
 *   node packages/reader-engine/scripts/shoot-spread.mjs
 *
 * Requires `npm run build` first (dist/dev-panel.js + dist/reader.html).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgDir, '../..');
const outPath = path.join(repoRoot, '.factory/evidence/r2/spread-ar.png');
const devUrl = pathToFileURL(path.join(pkgDir, 'dev.html')).href;

function chromiumExecutable() {
  const candidates = [chromium.executablePath(), '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const browser = await chromium.launch({ executablePath: chromiumExecutable() });
const page = await browser.newPage({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2 });
await page.goto(devUrl);
await page.waitForSelector('#reader-frame');

const frame = page.frameLocator('#reader-frame');
await frame.locator('.chapter[aria-hidden="false"]').first().waitFor({ timeout: 20_000 });
await page.waitForFunction(
  () => (document.getElementById('status-text')?.textContent ?? '').includes('spread'),
  undefined,
  { timeout: 20_000 },
);
// let fonts settle so the shot shows the real book typography
await page.evaluate(() => document.fonts?.ready);
await page.waitForTimeout(600);

const status = await page.locator('#status-text').innerText();
const bookMetrics = await frame.locator('#reader-stage').evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { width: Math.round(r.width), height: Math.round(r.height), spreadMode: el.parentElement?.classList.contains('spread-mode') };
});

fs.mkdirSync(path.dirname(outPath), { recursive: true });
await page.screenshot({ path: outPath, fullPage: false });
await browser.close();

console.log(JSON.stringify({ out: path.relative(repoRoot, outPath), status, bookMetrics }, null, 2));
