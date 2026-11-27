import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook } from '../../book-format/src/index.js';
import type { RNToWebMessage, WebToRNMessage } from '../src/types.js';

/**
 * F27 — ملمس الورق, on the real built page.
 *
 * The texture must be a *static* PNG repeated behind the text on the two paper themes only, and it
 * must cost nothing: no live CSS/SVG filter (`filter`, `backdrop-filter`, `feTurbulence`) anywhere
 * near it. These tests drive the built `dist/reader.html` through the same bridge the app uses and
 * read the *computed* element, so a rule that exists in the stylesheet but never reaches the page
 * fails here instead of quietly shipping a flat, grainy-less page.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');
const readerHtmlUrl = pathToFileURL(path.join(distDir, 'reader.html')).href;
const sampleArText = fs.readFileSync(path.resolve(__dirname, 'fixtures/sample-ar.md'), 'utf8');
const fontsDirUrl = pathToFileURL(path.resolve(__dirname, '../../../apps/mobile/assets/fonts')).href + '/';

type GrainStatus = Extract<WebToRNMessage, { type: 'paper-grain-status' }>;

async function mountEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as {
      __bridgeMessages: unknown[];
      ReactNativeWebView: { postMessage: (data: string) => void };
    };
    win.__bridgeMessages = [];
    win.ReactNativeWebView = {
      postMessage(data: string) {
        try {
          win.__bridgeMessages.push(JSON.parse(data));
        } catch {
          // ignore
        }
      },
    };
  });
  await page.goto(readerHtmlUrl);
  await page.waitForSelector('#reader-stage');
}

async function sendBridge(page: Page, msg: RNToWebMessage): Promise<void> {
  await page.evaluate((payload) => {
    window.postMessage(JSON.stringify(payload), '*');
  }, msg);
}

async function messages(page: Page): Promise<WebToRNMessage[]> {
  return page.evaluate(
    () => (window as unknown as { __bridgeMessages: WebToRNMessage[] }).__bridgeMessages,
  );
}

/** Wait for the latest `paper-grain-status` report, so no assertion races the first layout. */
async function waitForGrainStatus(page: Page, minCount = 1): Promise<GrainStatus> {
  await expect
    .poll(
      async () =>
        (await messages(page)).filter((m) => m.type === 'paper-grain-status').length,
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(minCount);
  const all = (await messages(page)).filter(
    (m): m is GrainStatus => m.type === 'paper-grain-status',
  );
  return all.at(-1)!;
}

async function loadBook(page: Page, settings: Record<string, unknown>): Promise<void> {
  await sendBridge(page, {
    type: 'load',
    book: parseBook(sampleArText, 'sample-ar.md'),
    fontBaseUrl: fontsDirUrl,
    settings: { disableAnimation: true, fontFamily: 'Amiri', fontSize: 20, spread: 'single', ...settings },
  });
  await waitForGrainStatus(page);
}

type GrainPaint = {
  display: string;
  opacity: string;
  backgroundRepeat: string;
  backgroundSize: string;
  backgroundImage: string;
  pointerEvents: string;
  filter: string;
  backdropFilter: string;
  dataTheme: string | null;
  feTurbulenceCount: number;
  inlineCssText: string;
};

async function readPaint(page: Page): Promise<GrainPaint> {
  return page.evaluate(() => {
    const el = document.getElementById('paper-grain');
    if (!el) throw new Error('#paper-grain is missing from the template');
    const style = getComputedStyle(el);
    const backdrop =
      (style as unknown as { backdropFilter?: string; webkitBackdropFilter?: string })
        .backdropFilter ??
      (style as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter ??
      'none';
    return {
      display: style.display,
      opacity: style.opacity,
      backgroundRepeat: style.backgroundRepeat,
      backgroundSize: style.backgroundSize,
      backgroundImage: style.backgroundImage,
      pointerEvents: style.pointerEvents,
      filter: style.filter,
      backdropFilter: backdrop,
      dataTheme: document.documentElement.getAttribute('data-theme'),
      feTurbulenceCount: document.querySelectorAll('feTurbulence').length,
      inlineCssText: el.getAttribute('style') ?? '',
    };
  });
}

/** Decode the painted texture in the page itself: a broken/undeclared image proves nothing. */
async function decodePaintedTexture(
  page: Page,
  backgroundImage: string,
): Promise<{ naturalWidth: number; naturalHeight: number }> {
  const dataUri = /data:image\/png;base64,[A-Za-z0-9+/=]+/.exec(backgroundImage)?.[0];
  if (!dataUri) throw new Error('background-image must be an inline PNG data URI');
  await page.evaluate((uri) => {
    const img = new Image();
    (window as unknown as { __grainImg: HTMLImageElement }).__grainImg = img;
    img.src = uri;
    return img.decode();
  }, dataUri);
  return page.evaluate(() => {
    const img = (window as unknown as { __grainImg: HTMLImageElement }).__grainImg;
    return { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
  });
}

for (const theme of ['warraq', 'sepia'] as const) {
  test(`paints the 128px paper grain at 3% on the ${theme} theme`, async ({ page }) => {
    await mountEngine(page);
    await loadBook(page, { theme });

    const paint = await readPaint(page);
    expect(paint.dataTheme).toBe(theme);
    expect(paint.display).not.toBe('none');
    expect(paint.opacity).toBe('0.03');
    expect(paint.backgroundRepeat).toBe('repeat');
    expect(paint.backgroundSize).toBe('128px 128px');
    expect(paint.pointerEvents).toBe('none');
    expect(paint.filter).toBe('none');
    expect(paint.backdropFilter).toBe('none');
    expect(paint.inlineCssText.toLowerCase()).not.toContain('filter');
    expect(paint.feTurbulenceCount).toBe(0);

    const decoded = await decodePaintedTexture(page, paint.backgroundImage);
    expect(decoded.naturalWidth).toBe(128);
    expect(decoded.naturalHeight).toBe(128);

    const status = await waitForGrainStatus(page);
    expect(status).toMatchObject({ theme, state: 'painted' });
  });
}

const HIDDEN_THEMES = ['burnt-paper', 'oled-crimson', 'night-ink'] as const;

for (const theme of HIDDEN_THEMES) {
  test(`keeps the grain hidden on the ${theme} theme`, async ({ page }) => {
    await mountEngine(page);
    await loadBook(page, { theme });

    const paint = await readPaint(page);
    expect(paint.dataTheme).toBe(theme);
    expect(paint.display).toBe('none');
    expect(paint.opacity).toBe('0');

    const status = await waitForGrainStatus(page);
    expect(status).toMatchObject({ theme, state: 'hidden' });
  });
}

test('keeps the grain hidden when custom colours are painting', async ({ page }) => {
  await mountEngine(page);
  await loadBook(page, {
    theme: 'warraq',
    customColors: { enabled: true, bg: '#FAF7F0', text: '#231F1A' },
  });

  const paint = await readPaint(page);
  // Custom colours take the page over via their own theme key; the grain must not ride along.
  expect(paint.dataTheme).toBe('custom');
  expect(paint.display).toBe('none');
  expect(paint.opacity).toBe('0');

  const status = await waitForGrainStatus(page);
  expect(status).toMatchObject({ theme: 'custom', state: 'hidden' });
});

test('reports distinct grain verdicts across theme changes', async ({ page }) => {
  await mountEngine(page);
  await loadBook(page, { theme: 'warraq' });
  expect(await waitForGrainStatus(page)).toMatchObject({ theme: 'warraq', state: 'painted' });

  await sendBridge(page, { type: 'settings', partial: { theme: 'sepia' } });
  expect(await waitForGrainStatus(page, 2)).toMatchObject({ theme: 'sepia', state: 'painted' });

  await sendBridge(page, { type: 'settings', partial: { theme: 'burnt-paper' } });
  expect(await waitForGrainStatus(page, 3)).toMatchObject({ theme: 'burnt-paper', state: 'hidden' });
  expect((await readPaint(page)).display).toBe('none');
});

for (const override of [
  'background-image: none',
  'background-size: 128px 64px',
  'background-repeat: no-repeat',
  'opacity: 0.2',
  'filter: blur(1px)',
]) {
  test(`reports invalid rather than hidden or painted for ${override}`, async ({ page }) => {
    await mountEngine(page);
    // Edit the inline stylesheet directly so the test obeys the embedded page's CSP.
    await page.evaluate((rule) => {
      const style = document.querySelector('style');
      style?.sheet?.insertRule(`#paper-grain { ${rule} !important; }`);
    }, override);
    await loadBook(page, { theme: 'warraq' });
    expect(await waitForGrainStatus(page)).toMatchObject({ theme: 'warraq', state: 'invalid' });
  });
}
