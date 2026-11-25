import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook, type Book } from '../../book-format/src/index.js';
import type { RNToWebMessage, ReaderSettings, WebToRNMessage } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readerHtmlUrl = pathToFileURL(path.resolve(__dirname, '../dist/reader.html')).href;
const sampleArText = fs.readFileSync(path.resolve(__dirname, 'fixtures/sample-ar.md'), 'utf8');
const sampleEnText = fs.readFileSync(path.resolve(__dirname, 'fixtures/sample-en.md'), 'utf8');

const LANDSCAPE = { width: 1366, height: 1024 };
const PORTRAIT = { width: 1024, height: 1366 };

const ARABIC_PARA =
  'كَانَتِ الرِّيَاحُ تَهُبُّ بِهُدُوءٍ فَوْقَ الْمِينَاءِ الْقَدِيمِ، حَيْثُ تَرْتَطِمُ الْأَمْوَاجُ بِأَخْشَابِ الْمَرَاكِبِ وَيَتَأَمَّلُ سَلِيمٌ أَوْرَاقَ وَالِدِهِ الْمَكْتُوبَةَ بِعِنَايَةٍ وَدِقَّةٍ قَبْلَ سَنَوَاتٍ طَوِيلَةٍ فِي لَيْلَةٍ صَافِيَةٍ.';

function buildArabicBook(paragraphs: number, chapters: number): Book {
  const lines: string[] = [
    '---',
    'title: "رِوَايَةُ اخْتِبَارِ الصَّفْحَتَيْنِ"',
    'lang: ar',
    'dir: rtl',
    '---',
    '',
  ];
  const perChapter = Math.ceil(paragraphs / chapters);
  let created = 0;
  for (let c = 1; c <= chapters; c++) {
    lines.push(`# الْفَصْلُ رَقْمُ ${c}`);
    lines.push('');
    for (let p = 1; p <= perChapter && created < paragraphs; p++) {
      created++;
      lines.push(`${ARABIC_PARA} (${c}.${p})`);
      lines.push('');
    }
  }
  return parseBook(lines.join('\n'), 'spread-ar.md');
}

/**
 * A book with a deliberately tiny chapter (a single short paragraph): in spread mode
 * that chapter is exactly 1 real page and must therefore get a blank verso pad.
 * This is the deterministic probe for "pad is geometry, not a page number".
 */
function buildPadBook(): Book {
  const lines: string[] = ['---', 'title: "كِتَابُ الْحَشْوِ"', 'lang: ar', 'dir: rtl', '---', ''];
  const chapterSizes = [40, 1, 40, 20];
  chapterSizes.forEach((paragraphs, c) => {
    lines.push(`# الْفَصْلُ الْحَشْوِيُّ ${c + 1}`);
    lines.push('');
    for (let p = 1; p <= paragraphs; p++) {
      lines.push(`${ARABIC_PARA} (${c + 1}.${p})`);
      lines.push('');
    }
  });
  return parseBook(lines.join('\n'), 'spread-pad.md');
}

function buildHugeChapterBook(): Book {
  const sentence =
    'كَانَ الْفَجْرُ يَتَسَلَّلُ بِهُدُوءٍ فَوْقَ أَرْصِفَةِ الْمِينَاءِ الْقَدِيمِ حَيْثُ تَرْتَطِمُ الْأَمْوَاجُ الْهَادِئَةُ بِأَخْشَابِ الْمَرَاكِبِ الرَّاسِيَةِ وَوَقَفَ سَلِيمٌ يُرَاقِبُ عَوْدَةَ الصَّيَّادِينَ بَعْدَ لَيْلَةٍ طَوِيلَةٍ مِنَ الْإِبْحَارِ.';
  const lines = ['---', 'title: "فَصْلٌ ضَخْمٌ"', 'lang: ar', 'dir: rtl', '---', '', '# فَصْلٌ ضَخْمٌ', ''];
  for (let i = 0; i < 420; i++) {
    lines.push(`${sentence} ${sentence}`);
    lines.push('');
  }
  return parseBook(lines.join('\n'), 'spread-huge.md');
}

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
  await page.evaluate((payload) => {
    window.postMessage(JSON.stringify(payload), '*');
  }, msg);
}

async function getMessages(page: Page): Promise<WebToRNMessage[]> {
  return page.evaluate(() => (window as unknown as { __bridgeMessages: WebToRNMessage[] }).__bridgeMessages);
}

async function getLatestPosition(page: Page) {
  const msgs = await getMessages(page);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.type === 'position') return m;
  }
  return null;
}

type RectSample = { left: number; right: number; top: number; bottom: number; text: string };

/**
 * Every visible line rect of the active chapter, in viewport coordinates.
 * Only blocks that intersect the stage are walked, so the scan stays cheap on
 * a long chapter (the engine keeps many blocks mounted).
 */
async function visibleTextRects(page: Page): Promise<RectSample[]> {
  return page.evaluate(() => {
    const stage = document.getElementById('reader-stage')!.getBoundingClientRect();
    const curr = document.querySelector<HTMLElement>('.chapter[aria-hidden="false"]')!;
    const out: Array<{ left: number; right: number; top: number; bottom: number; text: string }> = [];
    const range = document.createRange();

    const blocks = Array.from(curr.querySelectorAll<HTMLElement>('[data-block-id]'));
    for (const block of blocks) {
      const box = block.getBoundingClientRect();
      if (box.right < stage.left || box.left > stage.right) continue;
      if (box.bottom < stage.top || box.top > stage.bottom) continue;

      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode() as Text | null;
      while (node) {
        if (node.data.trim().length > 0) {
          range.setStart(node, 0);
          range.setEnd(node, node.data.length);
          const rects = range.getClientRects();
          for (let i = 0; i < rects.length; i++) {
            const r = rects[i]!;
            if (r.width <= 0 || r.height <= 0) continue;
            if (r.right < stage.left || r.left > stage.right) continue;
            out.push({
              left: r.left,
              right: r.right,
              top: r.top,
              bottom: r.bottom,
              text: node.data.slice(0, 24),
            });
          }
        }
        node = walker.nextNode() as Text | null;
      }
    }
    return out;
  });
}

async function stageRect(page: Page) {
  return page.evaluate(() => {
    const r = document.getElementById('reader-stage')!.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  });
}

type Toc = Extract<WebToRNMessage, { type: 'toc' }>;

async function latestToc(page: Page): Promise<Toc | null> {
  const msgs = await getMessages(page);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.type === 'toc') return m;
  }
  return null;
}

/** Wait until two consecutive TOC samples are identical — i.e. progressive mounting went idle. */
async function stableToc(page: Page): Promise<Toc> {
  let prev = JSON.stringify(await latestToc(page));
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(250);
    const current = JSON.stringify(await latestToc(page));
    if (current === prev && prev !== 'null') {
      const toc = JSON.parse(current) as Toc;
      return toc;
    }
    prev = current;
  }
  throw new Error('TOC never stabilised');
}

/** Apply a settings change and wait for the engine to emit the new position/toc. */
async function changeSettings(page: Page, partial: Partial<ReaderSettings>): Promise<void> {
  const before = (await getMessages(page)).length;
  await sendBridge(page, { type: 'settings', partial });
  await expect.poll(async () => (await getMessages(page)).length).toBeGreaterThan(before);
}

/**
 * Physical pages each mounted chapter occupies in the track, read straight from the DOM.
 * This includes the blank chapter pad — it is the geometry, not the reader-facing count.
 */
async function chapterLayoutPages(
  page: Page,
): Promise<Array<{ id: string; layoutPages: number; padCount: number }>> {
  return page.evaluate(() => {
    const pw =
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-width')) || 1;
    return Array.from(document.querySelectorAll<HTMLElement>('.chapter')).map((el) => ({
      id: el.getAttribute('data-chapter-id') ?? '',
      layoutPages: Math.max(1, Math.ceil(el.scrollWidth / pw)),
      padCount: el.querySelectorAll('.chapter-pad').length,
    }));
  });
}

async function isBlockVisible(page: Page, blockId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const stage = document.getElementById('reader-stage')!.getBoundingClientRect();
    const curr = document.querySelector<HTMLElement>('.chapter[aria-hidden="false"]');
    const block = curr?.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
    if (!block) return false;
    const range = document.createRange();
    range.selectNodeContents(block);
    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]!;
      if (r.width <= 0 || r.height <= 0) continue;
      if (r.right > stage.left + 1 && r.left < stage.right - 1) return true;
    }
    return false;
  }, blockId);
}

const GUTTER_HALF = 54;

test.describe('Rewiaty two-page spread (R2)', () => {
  test('(s1) RTL 1366x1024 spreads, page 1 sits on the right, next lands on pages 3-4', async ({ page }) => {
    await page.setViewportSize(LANDSCAPE);
    await mountEngine(page);
    const book = buildArabicBook(120, 3);

    await sendBridge(page, { type: 'load', book, settings: { disableAnimation: true, fontSize: 20 } });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);

    const first = await getLatestPosition(page);
    expect(first?.spread).toBe(true);
    expect(first?.pageCount).toBeGreaterThan(6);

    // RTL: chapter column 0 — the chapter title — must be on the right page.
    const stage = await stageRect(page);
    const titleBox = await page.evaluate(() => {
      const curr = document.querySelector<HTMLElement>('.chapter[aria-hidden="false"]')!;
      const h1 = curr.querySelector<HTMLElement>('h1.chapter-title')!;
      const r = h1.getBoundingClientRect();
      return { center: (r.left + r.right) / 2, left: r.left, right: r.right };
    });
    expect(titleBox.center).toBeGreaterThan(stage.left + stage.width / 2);
    expect(titleBox.right).toBeLessThanOrEqual(stage.right + 1);

    // Both pages of the spread carry text.
    const rects = await visibleTextRects(page);
    expect(rects.length).toBeGreaterThan(4);
    expect(rects.some((r) => (r.left + r.right) / 2 > stage.left + stage.width / 2)).toBe(true);
    expect(rects.some((r) => (r.left + r.right) / 2 < stage.left + stage.width / 2)).toBe(true);

    // One turn = a whole spread.
    await sendBridge(page, { type: 'next' });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(3);
    const spread2 = await getLatestPosition(page);
    expect(spread2?.spread).toBe(true);

    await sendBridge(page, { type: 'next' });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(5);
  });

  test('(s2) an English (LTR) book puts page 1 on the left page', async ({ page }) => {
    await page.setViewportSize(LANDSCAPE);
    await mountEngine(page);
    const book = parseBook(sampleEnText, 'sample-en.md');

    await sendBridge(page, { type: 'load', book, settings: { disableAnimation: true } });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);
    expect((await getLatestPosition(page))?.spread).toBe(true);

    const stage = await stageRect(page);
    const titleBox = await page.evaluate(() => {
      const curr = document.querySelector<HTMLElement>('.chapter[aria-hidden="false"]')!;
      const h1 = curr.querySelector<HTMLElement>('h1.chapter-title')!;
      const r = h1.getBoundingClientRect();
      return { center: (r.left + r.right) / 2, left: r.left };
    });
    expect(titleBox.left).toBeGreaterThanOrEqual(stage.left - 1);
    expect(titleBox.center).toBeLessThan(stage.left + stage.width / 2);
  });

  test('(s3) rotation 1366x1024 <-> 1024x1366 keeps the same anchor block on screen', async ({ page }) => {
    await page.setViewportSize(LANDSCAPE);
    await mountEngine(page);
    const book = buildArabicBook(120, 3);

    await sendBridge(page, { type: 'load', book, settings: { disableAnimation: true, fontSize: 20 } });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);

    for (let i = 0; i < 3; i++) {
      await sendBridge(page, { type: 'next' });
    }
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(7);
    const before = await getLatestPosition(page);
    expect(before?.spread).toBe(true);
    const anchorId = before!.anchor.blockId;
    expect(await isBlockVisible(page, anchorId)).toBe(true);

    // Rotate to portrait: single page column.
    await page.setViewportSize(PORTRAIT);
    await expect.poll(async () => (await getLatestPosition(page))?.spread).toBe(false);
    expect((await getLatestPosition(page))?.anchor.blockId).toBe(anchorId);
    expect(await isBlockVisible(page, anchorId)).toBe(true);

    // Rotate back to landscape: spread again, same anchor.
    await page.setViewportSize(LANDSCAPE);
    await expect.poll(async () => (await getLatestPosition(page))?.spread).toBe(true);
    expect((await getLatestPosition(page))?.anchor.blockId).toBe(anchorId);
    expect(await isBlockVisible(page, anchorId)).toBe(true);
  });

  test('(s4) spread:"single" at 1366 shows one page per screen', async ({ page }) => {
    await page.setViewportSize(LANDSCAPE);
    await mountEngine(page);
    const book = buildArabicBook(120, 3);

    await sendBridge(page, {
      type: 'load',
      book,
      settings: { disableAnimation: true, spread: 'single' },
    });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);
    const pos = await getLatestPosition(page);
    expect(pos?.spread).toBe(false);

    const stage = await stageRect(page);
    const pageWidth = await page.evaluate(() => {
      const curr = document.querySelector<HTMLElement>('.chapter[aria-hidden="false"]')!;
      return curr.getBoundingClientRect().width;
    });
    expect(pageWidth).toBeGreaterThan(stage.width - 2);

    await sendBridge(page, { type: 'next' });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(2);
    expect((await getLatestPosition(page))?.spread).toBe(false);
  });

  test('(s5) no line is sliced across the gutter or the page edges over 10 spread turns', async ({ page }) => {
    // Scanning every visible line rect of a spread is layout-heavy; give the check room on a busy box.
    test.setTimeout(120_000);
    await page.setViewportSize(LANDSCAPE);
    await mountEngine(page);
    const book = buildArabicBook(360, 30);

    await sendBridge(page, { type: 'load', book, settings: { disableAnimation: true, fontSize: 20 } });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);

    let checkedLines = 0;
    for (let turn = 0; turn < 10; turn++) {
      const stage = await stageRect(page);
      const center = stage.left + stage.width / 2;
      const gutterLeft = center - GUTTER_HALF;
      const gutterRight = center + GUTTER_HALF;

      const rects = await visibleTextRects(page);
      expect(rects.length).toBeGreaterThan(0);
      checkedLines += rects.length;

      for (const r of rects) {
        // nothing bleeds outside the book
        expect(r.left).toBeGreaterThanOrEqual(stage.left - 1);
        expect(r.right).toBeLessThanOrEqual(stage.right + 1);
        expect(r.top).toBeGreaterThanOrEqual(stage.top - 1);
        expect(r.bottom).toBeLessThanOrEqual(stage.bottom + 1);
        // nothing is sliced by the spine: each line lives entirely on one page
        const crossesFold = r.left < gutterRight - 2 && r.right > gutterLeft + 2;
        expect(crossesFold, `line crosses the gutter: ${r.text}`).toBe(false);
      }

      await sendBridge(page, { type: 'next' });
    }
    expect(checkedLines).toBeGreaterThan(200);

    // tashkeel is never squeezed: no letter-spacing and no per-word spans
    const typography = await page.evaluate(() => {
      const chapters = Array.from(document.querySelectorAll<HTMLElement>('.chapter'));
      return chapters.map((curr) => {
        const style = getComputedStyle(curr);
        return {
          letterSpacing: style.letterSpacing,
          spans: curr.querySelectorAll('p span').length,
        };
      });
    });
    expect(typography.length).toBeGreaterThan(0);
    for (const entry of typography) {
      expect(['0px', 'normal']).toContain(entry.letterSpacing);
      expect(entry.spans).toBe(0);
    }

    expect((await getLatestPosition(page))?.page).toBe(21);
  });

  test('(s6) two-page spread still emits ready in < 1500ms for a 20,000-word chapter', async ({ page }) => {
    await page.setViewportSize(LANDSCAPE);
    await mountEngine(page);
    const hugeBook = buildHugeChapterBook();
    expect(hugeBook.chapters[0]!.wordCount).toBeGreaterThanOrEqual(20_000);

    const elapsedMs = await page.evaluate(async (book) => {
      const win = window as unknown as {
        ReactNativeWebView: { postMessage: (d: string) => void };
      };
      const start = performance.now();
      return new Promise<number>((resolve, reject) => {
        const origPost = win.ReactNativeWebView.postMessage.bind(win.ReactNativeWebView);
        win.ReactNativeWebView.postMessage = (data: string) => {
          origPost(data);
          try {
            const parsed = JSON.parse(data) as WebToRNMessage;
            if (parsed.type === 'ready') resolve(performance.now() - start);
          } catch {
            // ignore
          }
        };
        setTimeout(() => reject(new Error('Timed out waiting for ready')), 5000);
        window.postMessage(JSON.stringify({ type: 'load', book }), '*');
      });
    }, hugeBook);

    expect(elapsedMs).toBeLessThan(1500);
    expect((await getLatestPosition(page))?.spread).toBe(true);
  });

  test('(s7) every chapter starts on the right page of a spread in an RTL book', async ({ page }) => {
    await page.setViewportSize(LANDSCAPE);
    await mountEngine(page);
    const book = buildArabicBook(120, 3);

    await sendBridge(page, { type: 'load', book, settings: { disableAnimation: true, fontSize: 20 } });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);

    // Wait until every chapter has been measured so the TOC start pages are exact.
    await expect
      .poll(async () => {
        const msgs = await getMessages(page);
        const toc = [...msgs].reverse().find((m) => m.type === 'toc');
        return toc?.type === 'toc' ? toc.chapters.every((c) => c.pageCount > 1) : false;
      })
      .toBe(true);

    const toc = (await getMessages(page)).filter((m) => m.type === 'toc').at(-1);
    expect(toc?.type).toBe('toc');
    if (toc?.type !== 'toc') return;

    // TOC numbers are real pages, so start pages are cumulative (no parity alignment).
    let expectedStart = 1;
    for (const chapter of toc.chapters) {
      expect(chapter.startPage, `start page of ${chapter.id}`).toBe(expectedStart);
      expect(chapter.pageCount).toBeGreaterThan(0);
      expectedStart += chapter.pageCount;
    }

    // The blank verso pad only moves the physical side, never the number: every
    // chapter still opens on the right-hand page of a spread in an RTL book.
    for (const chapter of book.chapters) {
      await sendBridge(page, { type: 'goto', chapterId: chapter.id });
      await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe(chapter.id);
      const pos = await getLatestPosition(page);
      expect(pos?.chapterPage).toBe(1);

      const stage = await stageRect(page);
      const titleCenter = await page.evaluate((cid) => {
        const curr = document.querySelector<HTMLElement>(`.chapter[data-chapter-id="${cid}"][aria-hidden="false"]`);
        const h1 = curr?.querySelector<HTMLElement>('h1.chapter-title');
        if (!h1) return -1;
        const r = h1.getBoundingClientRect();
        return (r.left + r.right) / 2;
      }, chapter.id);
      expect(titleCenter).toBeGreaterThan(stage.left + stage.width / 2);
    }
  });

  test('(s8) font size/family changes in spread mode keep the anchor block on screen', async ({ page }) => {
    await page.setViewportSize(LANDSCAPE);
    await mountEngine(page);
    const book = buildArabicBook(180, 6);

    await sendBridge(page, { type: 'load', book, settings: { disableAnimation: true, fontSize: 20 } });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);

    for (let i = 0; i < 4; i++) {
      await sendBridge(page, { type: 'next' });
    }
    await expect.poll(async () => (await getLatestPosition(page))?.page ?? 0).toBeGreaterThan(1);

    // Every settings change re-anchors on the block that was at the top of the page
    // when the change was requested — so capture the anchor immediately before each one.
    let anchorId = (await getLatestPosition(page))!.anchor.blockId;
    expect((await getLatestPosition(page))!.spread).toBe(true);
    expect(await isBlockVisible(page, anchorId)).toBe(true);

    // Bigger type: the layout is rebuilt around the anchor, not reset to page 1.
    await changeSettings(page, { fontSize: 28 });
    expect((await getLatestPosition(page))?.spread).toBe(true);
    expect(await isBlockVisible(page, anchorId), `anchor ${anchorId} lost after fontSize change`).toBe(true);

    // Different face + size together.
    anchorId = (await getLatestPosition(page))!.anchor.blockId;
    await changeSettings(page, { fontFamily: 'Noto Naskh Arabic', fontSize: 22 });
    expect((await getLatestPosition(page))?.spread).toBe(true);
    expect(await isBlockVisible(page, anchorId), `anchor ${anchorId} lost after fontFamily change`).toBe(true);

    // And back again — still on the block that was on screen before the change.
    anchorId = (await getLatestPosition(page))!.anchor.blockId;
    await changeSettings(page, { fontFamily: 'Amiri', fontSize: 20 });
    expect(await isBlockVisible(page, anchorId), `anchor ${anchorId} lost on revert`).toBe(true);
    expect((await getLatestPosition(page))?.spread).toBe(true);
  });

  test('(s9) goto an anchor near the end of the last chapter lands on it', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(LANDSCAPE);
    await mountEngine(page);
    const book = buildArabicBook(240, 8);

    await sendBridge(page, { type: 'load', book, settings: { disableAnimation: true, fontSize: 20 } });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);

    const lastChapter = book.chapters[book.chapters.length - 1]!;
    const target = lastChapter.blocks[lastChapter.blocks.length - 2]!;

    await sendBridge(page, { type: 'goto', anchor: { blockId: target.id, charOffset: 0 } });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe(lastChapter.id);

    const pos = (await getLatestPosition(page))!;
    expect(pos.spread).toBe(true);
    expect(pos.chapterPageCount).toBeGreaterThan(1);
    expect(pos.page).toBeLessThanOrEqual(pos.pageCount);
    expect(await isBlockVisible(page, target.id), `anchor ${target.id} not visible`).toBe(true);

    // The block must actually be inside the visible spread, not parked off-screen.
    const stage = await stageRect(page);
    const box = await page.evaluate((id) => {
      const curr = document.querySelector<HTMLElement>('.chapter[aria-hidden="false"]')!;
      const el = curr.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    }, target.id);
    expect(box).not.toBeNull();
    expect(box!.right).toBeGreaterThan(stage.left);
    expect(box!.left).toBeLessThan(stage.right);

    // Turning backwards from there keeps real page numbers (never lands on a pad page).
    await sendBridge(page, { type: 'prev' });
    const back = (await getLatestPosition(page))!;
    expect(back.page).toBeGreaterThanOrEqual(1);
    expect(back.page).toBeLessThanOrEqual(pos.page);
  });

  test('(s10) page numbers hold through ready, progressive mount and chapter turns (virtualization)', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize(LANDSCAPE);
    await mountEngine(page);
    // 100 paragraphs per chapter ≈ 3,000 words — more than INITIAL_WORD_BUDGET, so the
    // first chapter is still mounting (and turning pages) when `ready` fires.
    const book = buildArabicBook(600, 6);

    await sendBridge(page, { type: 'load', book, settings: { disableAnimation: true, fontSize: 20 } });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);
    const atReady = (await getLatestPosition(page))!;
    expect(atReady.spread).toBe(true);
    expect(atReady.chapterPage).toBe(1);

    // Progressive mount runs in the background; the reader must not shift a page.
    // (`chapterPageCount` may refine from an estimate to the exact count — that is not
    // a shift, and the exact value is asserted against the DOM below.)
    const toc = await stableToc(page);
    const afterMount = (await getLatestPosition(page))!;
    expect(afterMount.page).toBe(atReady.page);
    expect(afterMount.chapterPage).toBe(atReady.chapterPage);
    expect(afterMount.chapterPageCount).toBeGreaterThan(0);

    // Every position emitted for the first chapter since load stayed on its first page.
    const firstChapter = book.chapters[0]!;
    const msgs = await getMessages(page);
    const emitted = msgs.filter(
      (m): m is Extract<WebToRNMessage, { type: 'position' }> => m.type === 'position' && m.chapterId === firstChapter.id,
    );
    expect(emitted.length).toBeGreaterThanOrEqual(2);
    for (const p of emitted) {
      expect(p.page).toBe(1);
      expect(p.chapterPage).toBe(1);
    }

    // Chapter 1 is fully measured now: its TOC count is exact, pad excluded.
    const layout = await chapterLayoutPages(page);
    const firstLayout = layout.find((c) => c.id === firstChapter.id)!;
    expect(toc.chapters[0]!.pageCount).toBe(firstLayout.layoutPages - firstLayout.padCount);

    // Turn spread by spread through the end of the chapter and into the next one.
    let pos = (await getLatestPosition(page))!;
    let lastPageOfFirst = pos.page;
    let turns = 0;
    while (pos.chapterId === firstChapter.id && turns < 60) {
      const prevPage = pos.page;
      await sendBridge(page, { type: 'next' });
      await expect.poll(async () => (await getLatestPosition(page))?.page).toBeGreaterThan(prevPage);
      pos = (await getLatestPosition(page))!;
      turns++;
      if (pos.chapterId === firstChapter.id) lastPageOfFirst = pos.page;
      // Virtualization keeps only [curr - 1, curr, curr + 1] in the DOM.
      const mounted = await page.evaluate(() => document.querySelectorAll('.chapter').length);
      expect(mounted).toBeLessThanOrEqual(3);
    }

    expect(turns).toBeGreaterThan(0);
    expect(pos.chapterId).toBe(book.chapters[1]!.id);
    expect(pos.chapterPage).toBe(1);
    // No blank pad page in between: the first page of chapter 2 is exactly the TOC start page.
    expect(pos.page).toBe(toc.chapters[1]!.startPage);
    // …and the last spread opened on the chapter's last real page pair (a spread reports its
    // first page, so an even page count reports count - 1 — never `count` or a pad page).
    expect(lastPageOfFirst).toBe(
      toc.chapters[0]!.startPage + 2 * Math.floor((toc.chapters[0]!.pageCount - 1) / 2),
    );
    expect(lastPageOfFirst).toBeLessThan(toc.chapters[0]!.startPage + toc.chapters[0]!.pageCount);
  });

  test('(s11) page/pageCount/progress/TOC startPage are real pages; the pad is layout only', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(LANDSCAPE);
    await mountEngine(page);
    const book = buildPadBook();
    expect(book.chapters.length).toBe(4);

    // ---------- spread mode ----------
    await sendBridge(page, { type: 'load', book, settings: { disableAnimation: true, fontSize: 20 } });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);
    const spreadToc = await stableToc(page);
    const spreadPos = (await getLatestPosition(page))!;
    expect(spreadPos.spread).toBe(true);

    // TOC is cumulative on real pages: startPage[i+1] = startPage[i] + pageCount[i].
    let acc = 1;
    for (const chapter of spreadToc.chapters) {
      expect(chapter.startPage, `start page of ${chapter.id}`).toBe(acc);
      expect(chapter.pageCount).toBeGreaterThan(0);
      acc += chapter.pageCount;
    }
    const realTotal = acc - 1;
    expect(spreadPos.pageCount).toBe(realTotal);
    expect(spreadPos.bookProgress).toBeCloseTo((spreadPos.page - 1) / (realTotal - 1), 5);

    // The one-paragraph chapter is exactly one real page, so the spread layout gives it a
    // blank verso: 2 physical pages in the track, 1 exposed page in the numbers.
    const tiny = book.chapters[1]!;
    const tinyToc = spreadToc.chapters.find((c) => c.id === tiny.id)!;
    expect(tinyToc.pageCount).toBe(1);

    const layout = await chapterLayoutPages(page);
    const tinyLayout = layout.find((c) => c.id === tiny.id)!;
    expect(tinyLayout.padCount, 'tiny chapter must carry a blank verso').toBe(1);
    expect(tinyLayout.layoutPages).toBe(2);

    // For every mounted chapter: physical pages = real pages + its pads, and the pad is 0..1.
    let mountedLayoutTotal = 0;
    let mountedRealTotal = 0;
    let pads = 0;
    for (const entry of layout) {
      const chapterToc = spreadToc.chapters.find((c) => c.id === entry.id)!;
      expect(entry.layoutPages - entry.padCount).toBe(chapterToc.pageCount);
      expect(entry.padCount).toBeLessThanOrEqual(1);
      mountedLayoutTotal += entry.layoutPages;
      mountedRealTotal += chapterToc.pageCount;
      pads += entry.padCount;
    }
    expect(pads).toBeGreaterThanOrEqual(1);
    expect(mountedLayoutTotal).toBe(mountedRealTotal + pads);

    // Navigation proof: the 1-page chapter owns exactly one spread and one turn lands
    // straight on the next chapter at exactly `startPage + 1` — no blank page counted.
    await sendBridge(page, { type: 'goto', chapterId: tiny.id });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe(tiny.id);
    expect((await getLatestPosition(page))!.page).toBe(tinyToc.startPage);
    expect((await getLatestPosition(page))!.chapterPage).toBe(1);

    const afterTiny = book.chapters[2]!;
    const afterTinyToc = spreadToc.chapters.find((c) => c.id === afterTiny.id)!;
    await sendBridge(page, { type: 'next' });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe(afterTiny.id);
    const afterTinyPos = (await getLatestPosition(page))!;
    expect(afterTinyPos.chapterPage).toBe(1);
    expect(afterTinyPos.page).toBe(afterTinyToc.startPage);
    expect(afterTinyPos.page).toBe(tinyToc.startPage + 1);

    // goto by the TOC's real start page lands on that chapter as well.
    const lastToc = spreadToc.chapters[spreadToc.chapters.length - 1]!;
    await sendBridge(page, { type: 'goto', page: lastToc.startPage });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe(lastToc.id);
    expect((await getLatestPosition(page))!.page).toBe(lastToc.startPage);
    expect((await getLatestPosition(page))!.chapterPage).toBe(1);

    // ---------- single mode on the same book ----------
    await sendBridge(page, {
      type: 'load',
      book,
      settings: { disableAnimation: true, fontSize: 20, spread: 'single' },
    });
    await expect.poll(async () => (await getLatestPosition(page))?.spread).toBe(false);
    const singleToc = await stableToc(page);
    const singlePos = (await getLatestPosition(page))!;

    let singleAcc = 1;
    for (const chapter of singleToc.chapters) {
      expect(chapter.startPage, `single start page of ${chapter.id}`).toBe(singleAcc);
      singleAcc += chapter.pageCount;
    }
    expect(singlePos.pageCount).toBe(singleAcc - 1);
    expect(singlePos.bookProgress).toBeCloseTo((singlePos.page - 1) / (singlePos.pageCount - 1), 5);

    // No padding at all in single mode, and the numbers equal the pages the layout owns.
    const singleLayout = await chapterLayoutPages(page);
    expect(singleLayout.length).toBeGreaterThanOrEqual(2);
    for (const entry of singleLayout) {
      expect(entry.padCount, `single mode must not pad ${entry.id}`).toBe(0);
    }
    const singleTiny = singleLayout.find((c) => c.id === tiny.id)!;
    expect(singleTiny.layoutPages).toBe(1);
    expect(singleToc.chapters.find((c) => c.id === tiny.id)!.pageCount).toBe(1);
  });

  test('(s12) a reflow in spread mode restores the exact anchor and never drifts it', async ({ page }) => {
    await page.setViewportSize(LANDSCAPE);
    await mountEngine(page);
    const book = buildArabicBook(120, 3);

    await sendBridge(page, { type: 'load', book, settings: { disableAnimation: true, fontSize: 20 } });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);

    for (let i = 0; i < 4; i++) {
      await sendBridge(page, { type: 'next' });
    }
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(9);

    const atFirst = (await getLatestPosition(page))!;
    expect(atFirst.spread).toBe(true);
    let anchor = atFirst.anchor;
    expect(await isBlockVisible(page, anchor.blockId)).toBe(true);

    // A spread reflow rounds the restored page down to an even column, so the anchor can
    // land on the second page of the spread. It must still be reported verbatim, and stay
    // byte-for-byte identical across a chain of changes (no font-slider drift).
    for (const partial of [{ fontSize: 28 }, { fontFamily: 'Noto Naskh Arabic', fontSize: 22 }, { fontSize: 20 }]) {
      await changeSettings(page, partial);
      const pos = (await getLatestPosition(page))!;
      expect(pos.spread).toBe(true);
      expect(pos.anchor.blockId, `blockId drifted after ${JSON.stringify(partial)}`).toBe(anchor.blockId);
      expect(pos.anchor.charOffset, `charOffset drifted after ${JSON.stringify(partial)}`).toBe(anchor.charOffset);
      expect(await isBlockVisible(page, anchor.blockId), `anchor ${anchor.blockId} lost`).toBe(true);
      anchor = pos.anchor;
    }

    // Turning a spread still moves: the restored anchor must not pin the reader.
    const before = (await getLatestPosition(page))!.page;
    await sendBridge(page, { type: 'next' });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBeGreaterThan(before);
  });
});
