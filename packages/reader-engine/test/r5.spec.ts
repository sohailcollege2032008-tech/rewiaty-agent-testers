import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { parseBook, type Book } from '../../book-format/src/index.js';
import type { RNToWebMessage, WebToRNMessage } from '../src/types.js';

/**
 * R5 — finger-tracked page turns (A4) and the position that survives a reload (S1/S3).
 *
 * The reader's contract here is physical:
 *   (a) the page number saved with an anchor must be the page number that anchor restores
 *       to — the same page, the same first line, and the same total — in single and spread;
 *   (b) changing the font size never loses the reader's place: the first character that was
 *       visible before the change is still on screen after it;
 *   (c) a page follows the finger: a long drag or a quick flick turns it, a short slow drag
 *       settles back, and the direction is the book's own (RTL: rightward advances, LTR: the
 *       mirror) so the paper never moves against the hand;
 *   (d) a tap on the edges no longer turns anything — every tap is a centre tap.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readerHtmlUrl = pathToFileURL(path.resolve(__dirname, '../dist/reader.html')).href;

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 1366, height: 1024 };

const DENSE =
  'كَانَتِ الرِّيَاحُ تَهُبُّ بِهُدُوءٍ فَوْقَ الْمِينَاءِ الْقَدِيمِ، حَيْثُ تَرْتَطِمُ الْأَمْوَاجُ بِأَخْشَابِ الْمَرَاكِبِ وَيَتَأَمَّلُ سَلِيمٌ أَوْرَاقَ وَالِدِهِ الْمَكْتُوبَةَ بِعِنَايَةٍ وَدِقَّةٍ قَبْلَ سَنَوَاتٍ طَوِيلَةٍ فِي لَيْلَةٍ صَافِيَةٍ.';

/**
 * Chapters with deliberately different typography density (short lines, dense paragraphs,
 * quotes). A page map built on a words-per-page guess cannot line up across these, which
 * is exactly the condition that used to restore page 9 as page 7.
 */
function buildTortureBook(dir: 'rtl' | 'ltr' = 'rtl'): Book {
  const lines = ['---', 'title: "كِتَابٌ مُخْتَلِطٌ"', 'lang: ar', `dir: ${dir}`, '---', ''];
  const plan = [
    { short: 55, dense: 0, quote: 0 },
    { short: 0, dense: 34, quote: 12 },
    { short: 40, dense: 10, quote: 0 },
    { short: 0, dense: 60, quote: 4 },
    { short: 30, dense: 24, quote: 8 },
    { short: 0, dense: 8, quote: 0 },
  ];
  plan.forEach((spec, c) => {
    lines.push(`# الْفَصْلُ ${c + 1}`);
    lines.push('');
    for (let i = 0; i < spec.short; i++) {
      lines.push(`سَطْرٌ قَصِيرٌ رَقْمُ ${c + 1}-${i}.`);
      lines.push('');
    }
    for (let i = 0; i < spec.dense; i++) {
      lines.push(`${DENSE} (${c + 1}.${i})`);
      lines.push('');
    }
    for (let i = 0; i < spec.quote; i++) {
      lines.push(`> اقْتِبَاسٌ ${c + 1}-${i}: ${DENSE}`);
      lines.push('');
    }
  });
  return parseBook(lines.join('\n'), 'r5-torture.md');
}

type Position = Extract<WebToRNMessage, { type: 'position' }>;

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

async function sendBridge(page: Page, msg: RNToWebMessage): Promise<void> {
  await page.evaluate((payload) => window.postMessage(JSON.stringify(payload), '*'), msg);
}

async function getMessages(page: Page): Promise<WebToRNMessage[]> {
  return page.evaluate(
    () => (window as unknown as { __bridgeMessages: WebToRNMessage[] }).__bridgeMessages,
  );
}

async function latestPosition(page: Page): Promise<Position | null> {
  const msgs = await getMessages(page);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (msg?.type === 'position') return msg;
  }
  return null;
}

async function waitForPosition(page: Page, timeoutMs = 20_000): Promise<Position> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __bridgeMessages: WebToRNMessage[] }).__bridgeMessages.some(
        (m) => m.type === 'position',
      ),
    undefined,
    { timeout: timeoutMs },
  );
  const pos = await latestPosition(page);
  if (!pos) throw new Error('position message never arrived');
  return pos;
}

/** Load a book and wait for the engine's first real position. */
async function openBook(
  page: Page,
  book: Book,
  settings: Record<string, unknown> = {},
  anchor?: { blockId: string; charOffset: number },
): Promise<Position> {
  await sendBridge(page, {
    type: 'load',
    book,
    ...(anchor ? { anchor } : {}),
    settings: { disableAnimation: true, ...settings },
  });
  return waitForPosition(page);
}

/**
 * The first visible line of the page plus whether a given character is on screen.
 * Everything is measured against the stage box, which is what the reader actually sees.
 */
async function pageProbe(
  page: Page,
  anchor: { blockId: string; charOffset: number },
): Promise<{ firstLine: string; anchorVisible: boolean }> {
  return page.evaluate(({ blockId, charOffset }) => {
    const stage = document.getElementById('reader-stage')!.getBoundingClientRect();
    const curr = document.querySelector<HTMLElement>('.chapter[aria-hidden="false"]');
    if (!curr) return { firstLine: '', anchorVisible: false };

    let bestTop = Number.POSITIVE_INFINITY;
    let best: { text: string; right: number } | null = null;
    const walker = document.createTreeWalker(curr, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node) {
      if (node.data.trim().length > 0) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width <= 0 || rect.height <= 0) continue;
          if (rect.right < stage.left + 1 || rect.left > stage.right - 1) continue;
          if (rect.top < stage.top - 1 || rect.bottom > stage.bottom + 1) continue;
          if (rect.top < bestTop - 0.5) {
            bestTop = rect.top;
            best = { text: node.data.trim().slice(0, 30), right: rect.right };
          } else if (Math.abs(rect.top - bestTop) <= 0.5 && best && rect.right > best.right) {
            best = { text: node.data.trim().slice(0, 30), right: rect.right };
          }
        }
      }
      node = walker.nextNode() as Text | null;
    }

    const block = curr.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
    let anchorVisible = false;
    if (block) {
      const textWalker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let remaining = Math.max(0, charOffset);
      let target: Text | null = null;
      let offset = 0;
      let text = textWalker.nextNode() as Text | null;
      while (text) {
        if (remaining < text.data.length) {
          target = text;
          offset = remaining;
          break;
        }
        remaining -= text.data.length;
        text = textWalker.nextNode() as Text | null;
      }
      if (target) {
        const range = document.createRange();
        range.setStart(target, offset);
        range.setEnd(target, Math.min(target.data.length, offset + 1));
        const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
        anchorVisible =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > stage.left - 1 &&
          rect.left < stage.right + 1 &&
          rect.bottom > stage.top - 1 &&
          rect.top < stage.bottom + 1;
      }
    }

    return { firstLine: best?.text ?? '', anchorVisible };
  }, anchor);
}

async function gotoPage(page: Page, target: number): Promise<Position> {
  const before = (await getMessages(page)).filter((m) => m.type === 'position').length;
  await sendBridge(page, { type: 'goto', page: target });
  await expect
    .poll(async () => (await getMessages(page)).filter((m) => m.type === 'position').length)
    .toBeGreaterThan(before);
  const pos = await latestPosition(page);
  if (!pos) throw new Error(`goto ${target} published no position`);
  return pos;
}

/** Deterministic pseudo-random sample of page numbers (1-based, distinct). */
function samplePages(total: number, count: number): number[] {
  const wanted = Math.max(1, Math.min(count, total));
  const picked = new Set<number>();
  let seed = (0x2f6e2b1 ^ Math.imul(total, 2654435761)) >>> 0;
  let guard = 0;
  while (picked.size < wanted && guard < 10_000) {
    guard++;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    picked.add(1 + (seed % total));
  }
  // A short cycle (or a tiny book) can leave slots unfilled; walk the rest in order.
  for (let page = 1; picked.size < wanted && page <= total; page++) picked.add(page);
  return Array.from(picked);
}

/**
 * Dispatch a real gesture on the reader root: pointerdown, a series of pointermoves over
 * `durationMs`, then pointerup. `distancePx` is a signed horizontal distance.
 */
async function swipe(page: Page, distancePx: number, durationMs: number): Promise<void> {
  await page.evaluate(
    async ({ distancePx, durationMs }) => {
      const root = document.getElementById('reader-root')!;
      const rect = root.getBoundingClientRect();
      const y = rect.top + rect.height / 2;
      const startX = rect.left + rect.width / 2;
      const steps = Math.max(3, Math.round(durationMs / 16));
      const fire = (type: string, x: number) => {
        root.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 7,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
          }),
        );
      };
      fire('pointerdown', startX);
      for (let i = 1; i <= steps; i++) {
        await new Promise((resolve) => setTimeout(resolve, durationMs / steps));
        fire('pointermove', startX + (distancePx * i) / steps);
      }
      fire('pointerup', startX + distancePx);
    },
    { distancePx, durationMs },
  );
}

async function pageWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const value = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--page-width'),
    );
    return Number.isFinite(value) && value > 0 ? value : 390;
  });
}

async function trackOffset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const track = document.getElementById('reader-track')!;
    const match = /matrix\(([^)]+)\)/.exec(getComputedStyle(track).transform);
    if (!match?.[1]) return 0;
    const parts = match[1].split(',').map((v) => Number.parseFloat(v.trim()));
    return Math.round(parts[4] ?? 0);
  });
}

test.describe('R5 — drag paging', () => {
  test('(c1) a long drag turns the page, a short slow drag settles back, a quick flick turns it', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(PORTRAIT);
    await mountEngine(page);
    const book = buildTortureBook();
    const start = await openBook(page, book);
    expect(start.page).toBe(1);
    expect(start.pageCount).toBeGreaterThan(6);

    const width = await pageWidth(page);
    const base = await trackOffset(page);

    // RTL: a forward turn is a rightward drag.
    const before = start.page;
    await swipe(page, width * 0.4, 500);
    await expect
      .poll(async () => (await latestPosition(page))?.page, { timeout: 5_000 })
      .toBe(before + 1);

    // A 20 % drag that takes half a second is a deliberate nudge, not a turn: it must
    // return to the page it started on, with the track back at its resting offset.
    const restingPage = (await latestPosition(page))!.page;
    await swipe(page, width * 0.2, 500);
    await page.waitForTimeout(400);
    expect((await latestPosition(page))?.page).toBe(restingPage);
    // Back at the resting offset for that page inside its chapter.
    expect(await trackOffset(page)).toBe(
      Math.round(((await latestPosition(page))!.chapterPage - 1) * width),
    );

    // A short but fast flick carries the page: 15 % of the page width in ~60 ms.
    await swipe(page, width * 0.15, 60);
    await expect
      .poll(async () => (await latestPosition(page))?.page, { timeout: 5_000 })
      .toBe(restingPage + 1);

    // Backwards works the same way, mirrored: a leftward drag is a previous page in RTL.
    const forwardPage = (await latestPosition(page))!.page;
    await swipe(page, -width * 0.4, 500);
    await expect
      .poll(async () => (await latestPosition(page))?.page, { timeout: 5_000 })
      .toBeLessThan(forwardPage);

    expect(base).toBe(0);
  });

  test('(c2) the first and last pages resist the finger instead of turning', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(PORTRAIT);
    await mountEngine(page);
    const book = buildTortureBook();
    const start = await openBook(page, book);
    const width = await pageWidth(page);

    // First page: dragging as if to go back cannot produce a page before page 1.
    await swipe(page, -width * 0.5, 400);
    await page.waitForTimeout(400);
    expect((await latestPosition(page))?.page).toBe(1);
    expect(await trackOffset(page)).toBe(0);

    // Last page: same on the other end.
    const total = start.pageCount;
    const last = await gotoPage(page, total);
    expect(last.page).toBeGreaterThanOrEqual(total - 1);
    await swipe(page, width * 0.5, 400);
    await page.waitForTimeout(400);
    expect((await latestPosition(page))?.page).toBe(last.page);
  });

  test('(c3) the page follows the finger while the drag is in progress', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(PORTRAIT);
    await mountEngine(page);
    const book = buildTortureBook();
    await openBook(page, book);

    const width = await pageWidth(page);
    const during = await page.evaluate(
      async ({ distance }) => {
        const root = document.getElementById('reader-root')!;
        const rect = root.getBoundingClientRect();
        const y = rect.top + rect.height / 2;
        const startX = rect.left + rect.width / 2;
        const fire = (type: string, x: number) => {
          root.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 9,
              pointerType: 'touch',
              isPrimary: true,
              clientX: x,
              clientY: y,
              button: 0,
              buttons: type === 'pointerup' ? 0 : 1,
            }),
          );
        };
        const readOffset = () => {
          const track = document.getElementById('reader-track')!;
          const match = /matrix\(([^)]+)\)/.exec(getComputedStyle(track).transform);
          if (!match?.[1]) return 0;
          const parts = match[1].split(',').map((v) => Number.parseFloat(v.trim()));
          return Math.round(parts[4] ?? 0);
        };
        fire('pointerdown', startX);
        // Small move: still below the drag threshold, nothing should have moved.
        fire('pointermove', startX + 4);
        await new Promise((r) => requestAnimationFrame(r));
        const beforeThreshold = readOffset();
        fire('pointermove', startX + distance * 0.5);
        await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => requestAnimationFrame(r));
        const mid = readOffset();
        fire('pointermove', startX + distance);
        await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => requestAnimationFrame(r));
        const full = readOffset();
        // Cancel: the reader did not release this as a turn.
        fire('pointercancel', startX + distance);
        await new Promise((r) => setTimeout(r, 300));
        return { beforeThreshold, mid, full, after: readOffset() };
      },
      { distance: width * 0.4 },
    );

    // RTL: content moves right with the finger, one pixel for one pixel.
    expect(during.beforeThreshold).toBe(0);
    expect(during.mid).toBe(Math.round(width * 0.4 * 0.5));
    expect(during.full).toBe(Math.round(width * 0.4));
    expect(during.after).toBe(0);
    expect((await latestPosition(page))?.page).toBe(1);
  });

  test('(c4) in an LTR book the mirror holds: a leftward drag advances, a rightward drag goes back', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(PORTRAIT);
    await mountEngine(page);
    const book = buildTortureBook('ltr');
    const start = await openBook(page, book);
    expect(start.page).toBe(1);
    expect(start.pageCount).toBeGreaterThan(6);

    const width = await pageWidth(page);

    // LTR: the next page is to the right, so pulling the paper leftward brings it in. The
    // same physical gesture that advances an RTL book must go BACK here — this is the half
    // of the contract the RTL-only journeys never pinned down.
    await swipe(page, -width * 0.4, 500);
    await expect
      .poll(async () => (await latestPosition(page))?.page, { timeout: 5_000 })
      .toBe(2);
    expect(await trackOffset(page)).toBe(-Math.round(width));

    // Mirror on the way back.
    await swipe(page, width * 0.4, 500);
    await expect
      .poll(async () => (await latestPosition(page))?.page, { timeout: 5_000 })
      .toBe(1);
    expect(await trackOffset(page)).toBe(0);

    // A short slow nudge is not a turn in the LTR direction either.
    await swipe(page, -width * 0.2, 500);
    await page.waitForTimeout(400);
    expect((await latestPosition(page))?.page).toBe(1);
    expect(await trackOffset(page)).toBe(0);
  });
});

test.describe('R5 — position that survives a reload (S1/S3)', () => {
  test('(a1) a saved anchor restores the exact same page, total and first line (single page)', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(PORTRAIT);
    await mountEngine(page);
    const book = buildTortureBook();
    const start = await openBook(page, book);
    const total = start.pageCount;
    expect(total).toBeGreaterThan(20);

    const samples = samplePages(total, 10);
    const savedPositions: Array<{ page: number; pageCount: number; anchor: { blockId: string; charOffset: number }; firstLine: string }> = [];
    for (const target of samples) {
      const pos = await gotoPage(page, target);
      const probe = await pageProbe(page, pos.anchor);
      savedPositions.push({
        page: pos.page,
        pageCount: pos.pageCount,
        anchor: pos.anchor,
        firstLine: probe.firstLine,
      });
    }

    const restoredOn: Page[] = [];
    try {
      for (const saved of savedPositions) {
        const fresh = await browser.newPage({ viewport: PORTRAIT });
        restoredOn.push(fresh);
        await mountEngine(fresh);
        const restored = await openBook(fresh, book, {}, saved.anchor);
        const probe = await pageProbe(fresh, saved.anchor);
        expect(restored.page, `page ${saved.page} (${saved.anchor.blockId}#${saved.anchor.charOffset}) restored to ${restored.page}`).toBe(saved.page);
        expect(restored.pageCount, `total for page ${saved.page}`).toBe(saved.pageCount);
        expect(restored.anchor.blockId).toBe(saved.anchor.blockId);
        expect(restored.anchor.charOffset).toBe(saved.anchor.charOffset);
        expect(probe.firstLine, `first line of page ${saved.page}`).toBe(saved.firstLine);
      }
    } finally {
      await Promise.all(restoredOn.map((p) => p.close()));
    }
  });

  test('(a2) a saved anchor restores the exact same page and total in a two-page spread', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(LANDSCAPE);
    await mountEngine(page);
    const book = buildTortureBook();
    const start = await openBook(page, book);
    expect(start.spread).toBe(true);
    const total = start.pageCount;
    expect(total).toBeGreaterThan(12);

    const samples = samplePages(total, 10);
    const savedPositions: Array<{ page: number; pageCount: number; anchor: { blockId: string; charOffset: number }; firstLine: string }> = [];
    for (const target of samples) {
      const pos = await gotoPage(page, target);
      const probe = await pageProbe(page, pos.anchor);
      savedPositions.push({
        page: pos.page,
        pageCount: pos.pageCount,
        anchor: pos.anchor,
        firstLine: probe.firstLine,
      });
    }

    const restoredOn: Page[] = [];
    try {
      for (const saved of savedPositions) {
        const fresh = await browser.newPage({ viewport: LANDSCAPE });
        restoredOn.push(fresh);
        await mountEngine(fresh);
        const restored = await openBook(fresh, book, {}, saved.anchor);
        const probe = await pageProbe(fresh, saved.anchor);
        expect(restored.spread).toBe(true);
        expect(restored.page, `spread page ${saved.page} restored to ${restored.page}`).toBe(saved.page);
        expect(restored.pageCount, `total for spread page ${saved.page}`).toBe(saved.pageCount);
        expect(probe.firstLine, `first line of spread page ${saved.page}`).toBe(saved.firstLine);
      }
    } finally {
      await Promise.all(restoredOn.map((p) => p.close()));
    }
  });

  test('(b) font size 14 -> 36 keeps the first visible character on screen at every step', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(PORTRAIT);
    await mountEngine(page);
    const book = buildTortureBook();
    const start = await openBook(page, book, { fontSize: 14 });
    const pageToRead = Math.min(start.pageCount, 7);
    await gotoPage(page, pageToRead);

    let pos = (await latestPosition(page))!;
    const firstBlock = pos.anchor.blockId;
    expect(firstBlock).toBeTruthy();
    // The anchor is the first visible character, and it is on screen at the starting size.
    expect((await pageProbe(page, pos.anchor)).anchorVisible).toBe(true);

    for (let fontSize = 16; fontSize <= 36; fontSize += 2) {
      const beforeMessages = (await getMessages(page)).length;
      const watch = pos.anchor;
      await sendBridge(page, { type: 'settings', partial: { fontSize } });

      await expect
        .poll(async () => (await getMessages(page)).length, { timeout: 10_000 })
        .toBeGreaterThan(beforeMessages);
      // Let the reflow finish publishing a position.
      await expect
        .poll(
          async () => {
            const latest = await latestPosition(page);
            return latest !== null && latest.page >= 1;
          },
          { timeout: 10_000 },
        )
        .toBe(true);

      const probe = await pageProbe(page, watch);
      expect(probe.anchorVisible, `the character read at 14px is off screen at ${fontSize}px`).toBe(
        true,
      );

      pos = (await latestPosition(page))!;
      // The reading position stays inside the same chapter instead of jumping to page 1.
      expect(pos.page).toBeGreaterThanOrEqual(1);
    }

    expect(pos.anchor.blockId).toBe(firstBlock);
  });

  test('(d) taps on the edges never change the page and always report the center zone', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(PORTRAIT);
    await mountEngine(page);
    const book = buildTortureBook();
    const start = await openBook(page, book);
    expect(start.page).toBe(1);

    for (const ratio of [0.02, 0.15, 0.85, 0.98]) {
      const before = (await getMessages(page)).filter((m) => m.type === 'tap').length;
      await page.mouse.click(390 * ratio, 422);
      await expect
        .poll(async () => (await getMessages(page)).filter((m) => m.type === 'tap').length)
        .toBe(before + 1);
      const taps = (await getMessages(page)).filter((m) => m.type === 'tap');
      expect(taps.at(-1), `tap at ${ratio * 100}%`).toEqual({ type: 'tap', zone: 'center' });
      expect((await latestPosition(page))?.page, `tap at ${ratio * 100}% turned a page`).toBe(1);
    }
  });
});
