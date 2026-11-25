import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook, type Book } from '../../book-format/src/index.js';
import type { RNToWebMessage, WebToRNMessage } from '../src/types.js';

/**
 * Figures inside an imported book.
 *
 * The import path writes `assets/fig.png` next to `book.md`, and the reader is based at the book
 * folder, so the engine must (a) paint the figure, (b) report the painted box so an on-device
 * journey can prove it, and (c) never cut a figure in half across two pages — a figure split by a
 * column break is unreadable and, on a printed page, looks like a printing error.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');
const readerHtmlUrl = pathToFileURL(path.join(distDir, 'reader.html')).href;
const assetsDir = path.join(distDir, 'assets');

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** A real PNG, drawn here so no third-party image is involved. Framed, so a cut edge is obvious. */
function encodePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = y * stride + 1 + x * 3;
      raw[offset] = 0x2b;
      raw[offset + 1] = 0x2b;
      raw[offset + 2] = 0x33;
    }
  }
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const LANDSCAPE = { name: 'fig-landscape.png', width: 240, height: 160 };
/** Taller than any page: the height cap has to shrink it instead of letting a break cut it. */
const TALL = { name: 'fig-tall.png', width: 700, height: 2000 };

test.beforeAll(() => {
  fs.mkdirSync(assetsDir, { recursive: true });
  for (const fig of [LANDSCAPE, TALL]) {
    fs.writeFileSync(path.join(assetsDir, fig.name), encodePng(fig.width, fig.height));
  }
});

test.afterAll(() => {
  for (const fig of [LANDSCAPE, TALL]) {
    fs.rmSync(path.join(assetsDir, fig.name), { force: true });
  }
  try {
    fs.rmdirSync(assetsDir);
  } catch {
    // not empty or already gone: the build owns this folder
  }
});

async function mountEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as {
      __bridgeMessages: WebToRNMessage[];
      ReactNativeWebView: { postMessage: (data: string) => void };
    };
    win.__bridgeMessages = [];
    win.ReactNativeWebView = {
      postMessage(data: string) {
        try {
          win.__bridgeMessages.push(JSON.parse(data) as WebToRNMessage);
        } catch {
          // ignore
        }
      },
    };
  });
  await page.goto(readerHtmlUrl);
  await page.waitForSelector('#reader-stage');
}

type Proof = Extract<WebToRNMessage, { type: 'image-rendered' }>;

/**
 * Wait for an `image-rendered` report and return the latest one that matches `want`.
 *
 * The page runs under `script-src 'unsafe-inline'`, so a predicate must not be built with
 * `new Function`; the comparison is passed as a small literal instead.
 */
async function waitForProof(
  page: Page,
  want: 'painted' | 'nothing-painted',
  timeoutMs = 15_000,
): Promise<Proof> {
  await page.waitForFunction(
    (mode) =>
      (
        window as unknown as { __bridgeMessages: WebToRNMessage[] }
      ).__bridgeMessages.some((m) =>
        m.type === 'image-rendered' ? (mode === 'painted' ? m.count > 0 : m.count === 0) : false,
      ),
    want,
    { timeout: timeoutMs },
  );
  return page.evaluate((mode) => {
    const messages = (window as unknown as { __bridgeMessages: WebToRNMessage[] })
      .__bridgeMessages;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m?.type !== 'image-rendered') continue;
      if (mode === 'painted' ? m.count > 0 : m.count === 0) return m as Proof;
    }
    throw new Error('image-rendered never arrived');
  }, want);
}

async function waitForImageProof(page: Page, timeoutMs = 15_000): Promise<Proof> {
  return waitForProof(page, 'painted', timeoutMs);
}

/** One chapter whose only block is a figure, so the figure is on the chapter's first page. */
function figureBook(fileName: string): Book {
  return parseBook(
    [
      '---',
      'title: "كِتَابٌ فِيهِ صُورَةٌ"',
      'lang: ar',
      'dir: rtl',
      '---',
      '',
      '# الْفَصْلُ الْأَوَّلُ',
      '',
      'فَقْرَةٌ قَصِيرَةٌ قَبْلَ الصُّورَةِ.',
      '',
      `![شكل تجريبي](assets/${fileName})`,
      '',
      'فَقْرَةٌ قَصِيرَةٌ بَعْدَ الصُّورَةِ.',
    ].join('\n'),
    'figure.md',
  );
}

async function openBook(page: Page, book: Book): Promise<void> {
  await page.evaluate((payload) => {
    window.postMessage(JSON.stringify({ type: 'load', book: payload }), '*');
  }, book);
  await page.waitForFunction(
    () =>
      (window as unknown as { __bridgeMessages: WebToRNMessage[] }).__bridgeMessages.some(
        (m) => m.type === 'position',
      ),
    undefined,
    { timeout: 20_000 },
  );
}

test('paints an imported figure and reports its box to the app', async ({ page }) => {
  await mountEngine(page);
  await openBook(page, figureBook(LANDSCAPE.name));

  const proof = await waitForImageProof(page);
  expect(proof.count).toBe(1);
  expect(proof.width).toBeGreaterThan(0);
  expect(proof.height).toBeGreaterThan(0);

  const painted = await page.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>('.block-image img');
    if (!img) return null;
    const rects = Array.from(img.getClientRects()).map((r) => ({
      width: Math.round(r.width),
      height: Math.round(r.height),
    }));
    return {
      naturalWidth: img.naturalWidth,
      width: Math.round(img.getBoundingClientRect().width),
      height: Math.round(img.getBoundingClientRect().height),
      fragmentCount: rects.length,
      rects,
    };
  });

  expect(painted).not.toBeNull();
  expect(painted!.naturalWidth).toBe(LANDSCAPE.width);
  // The reported box is the painted box, not the source image's intrinsic size.
  expect(proof.width).toBe(painted!.width);
  expect(proof.height).toBe(painted!.height);
  expect(painted!.fragmentCount).toBe(1);
});

test('a figure taller than the page is shrunk onto one page instead of being cut in two', async ({
  page,
}) => {
  await mountEngine(page);
  await openBook(page, figureBook(TALL.name));

  const proof = await waitForImageProof(page);
  expect(proof.count).toBe(1);
  expect(proof.height).toBeGreaterThan(0);

  const geometry = await page.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>('.block-image img');
    const stage = document.getElementById('reader-stage');
    const chapter = img?.closest('.chapter') as HTMLElement | null;
    if (!img || !stage || !chapter) return null;
    const cs = getComputedStyle(chapter);
    const imgRect = img.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    return {
      // A figure fragmented by a column break yields one client rect per fragment.
      fragmentCount: img.getClientRects().length,
      naturalHeight: img.naturalHeight,
      renderedHeight: Math.round(imgRect.height),
      pageContentHeight: Math.round(
        chapter.getBoundingClientRect().height -
          parseFloat(cs.paddingTop) -
          parseFloat(cs.paddingBottom),
      ),
      top: Math.round(imgRect.top),
      bottom: Math.round(imgRect.bottom),
      stageTop: Math.round(stageRect.top),
      stageBottom: Math.round(stageRect.bottom),
    };
  });

  expect(geometry).not.toBeNull();
  const g = geometry!;
  // The source is taller than the page, so the height cap must be doing the work…
  expect(g.naturalHeight).toBe(TALL.height);
  expect(g.renderedHeight).toBeLessThan(g.naturalHeight);
  // …and the result must be one whole figure, inside one page.
  expect(g.fragmentCount).toBe(1);
  expect(g.renderedHeight).toBeLessThanOrEqual(g.pageContentHeight);
  // The figure is the first block of its chapter, so the whole box must be on screen.
  expect(g.top).toBeGreaterThanOrEqual(g.stageTop - 1);
  expect(g.bottom).toBeLessThanOrEqual(g.stageBottom + 1);
});

test('a figure the browser decodes before it is inserted still gets reported (no `load` event)', async ({
  page,
}) => {
  // Android WebView starts fetching at `src` assignment; an `<img>` that finished decoding while
  // detached is inserted already `complete` and the browser dispatches **no** `load` at insertion.
  // The on-device journey went red for exactly this (CI run 45687065853) while the figure was
  // visibly painted, so the proof must be DOM-driven. Swallow every `load` event at document
  // capture to reproduce that: the engine's own listener can never see one.
  await page.addInitScript(() => {
    const win = window as unknown as { __loadEventsSeen: number };
    win.__loadEventsSeen = 0;
    document.addEventListener(
      'load',
      (event) => {
        win.__loadEventsSeen += 1;
        event.stopPropagation();
      },
      true,
    );
  });

  await mountEngine(page);
  await openBook(page, figureBook(LANDSCAPE.name));

  const proof = await waitForImageProof(page);
  expect(proof.count).toBe(1);
  expect(proof.width).toBeGreaterThan(0);
  expect(proof.height).toBeGreaterThan(0);
});

test('a mounted figure that cannot be decoded is reported as count 0, not left silent', async ({
  page,
}) => {
  const broken = path.join(assetsDir, 'fig-broken.png');
  fs.writeFileSync(broken, Buffer.from('this is not a png, it only pretends to be one'));

  try {
    await mountEngine(page);
    await openBook(page, figureBook('fig-broken.png'));

    const proof = await waitForProof(page, 'nothing-painted', 15_000);
    expect(proof.count).toBe(0);
    expect(proof.width).toBe(0);
    expect(proof.height).toBe(0);
  } finally {
    fs.rmSync(broken, { force: true });
  }
});
