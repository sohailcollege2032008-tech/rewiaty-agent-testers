import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook, type Book } from '../../book-format/src/index.js';
import type { RNToWebMessage, WebToRNMessage } from '../src/types.js';

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

    // RTL right-hand pages are the odd global pages.
    for (const chapter of toc.chapters) {
      expect(chapter.startPage % 2, `chapter ${chapter.id} start page`).toBe(1);
    }

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
});
