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

function buildLongArabicBook(paragraphCount: number, chaptersCount: number): Book {
  const basePara =
    'كَانَتِ الرِّيَاحُ تَهُبُّ بِهُدُوءٍ فَوْقَ الْمِينَاءِ الْقَدِيمِ، حَيْثُ تَرْتَطِمُ الْأَمْوَاجُ بِأَخْشَابِ الْمَرَاكِبِ وَيَتَأَمَّلُ سَلِيمٌ أَوْرَاقَ وَالِدِهِ الْمَكْتُوبَةَ بِعِنَايَةٍ وَدِقَّةٍ قَبْلَ سَنَوَاتٍ طَوِيلَةٍ فِي لَيْلَةٍ صَافِيَةٍ.';
  const lines: string[] = [
    '---',
    'title: "رِوَايَةٌ طَوِيلَةٌ لِلِاخْتِبَارِ"',
    'author: "اختبار"',
    'lang: ar',
    'dir: rtl',
    '---',
    '',
  ];

  const perChapter = Math.ceil(paragraphCount / chaptersCount);
  let created = 0;

  for (let c = 1; c <= chaptersCount; c++) {
    lines.push(`# الْفَصْلُ رَقْمُ ${c}`);
    lines.push('');
    for (let p = 1; p <= perChapter && created < paragraphCount; p++) {
      created++;
      if (p % 15 === 6) {
        lines.push(`## مَشْهَدٌ فَرْعِيٌّ ${c}-${p}`);
        lines.push('');
      } else if (p % 15 === 11) {
        lines.push('***');
        lines.push('');
      }
      lines.push(`${basePara} (${c}.${p}) وَسَارَ فِي الطَّرِيقِ الطَّوِيلِ حَتَّى وَصَلَ إِلَى الْمَنَارَةِ.`);
      lines.push('');
    }
  }

  return parseBook(lines.join('\n'), 'long-test.md');
}

function buildTwentyThousandWordChapterBook(): Book {
  // 25-word Arabic sentence repeated twice per paragraph = 50 words/paragraph; 420 paragraphs = 21,000 words
  const fiftyWords =
    'كَانَ الْفَجْرُ يَتَسَلَّلُ بِهُدُوءٍ فَوْقَ أَرْصِفَةِ الْمِينَاءِ الْقَدِيمِ حَيْثُ تَرْتَطِمُ الْأَمْوَاجُ الْهَادِئَةُ بِأَخْشَابِ الْمَرَاكِبِ الرَّاسِيَةِ وَوَقَفَ سَلِيمٌ يُرَاقِبُ عَوْدَةَ الصَّيَّادِينَ بَعْدَ لَيْلَةٍ طَوِيلَةٍ مِنَ الْإِبْحَارِ فِي عُرْضِ الْبَحْرِ الْعَمِيقِ حَامِلًا دَفْتَرَهُ الصَّغِيرَ الَّذِي كُتِبَتْ صَفَحَاتُهُ بِخَطٍّ دَقِيقٍ وَمُتَّزِنٍ قَبْلَ عَشْرِ سَنَوَاتٍ كَامِلَةٍ مِنَ الِانْتِظَارِ وَالصَّبْرِ وَالْأَمَلِ فِي غَدٍ جَدِيدٍ.';
  const lines = [
    '---',
    'title: "فَصْلٌ ضَخْمٌ"',
    'lang: ar',
    'dir: rtl',
    '---',
    '',
    '# الْفَصْلُ الْأَوَّلُ: عِشْرُونَ أَلْفَ كَلِمَةٍ',
    '',
  ];

  for (let i = 0; i < 420; i++) {
    lines.push(fiftyWords);
    lines.push('');
  }
  lines.push('# الْفَصْلُ الثَّانِي: خَاتِمَةٌ');
  lines.push('');
  lines.push('نِهَايَةٌ قَصِيرَةٌ لِلِاخْتِبَارِ.');

  return parseBook(lines.join('\n'), '20k-chapter.md');
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
  return page.evaluate(() => {
    return (window as unknown as { __bridgeMessages: WebToRNMessage[] }).__bridgeMessages;
  });
}

async function getLatestPosition(page: Page) {
  const msgs = await getMessages(page);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.type === 'position') return m;
  }
  return null;
}

test.describe('Rewiaty Reader Engine', () => {
  test('(a) no line box is sliced across page boundaries over 50 consecutive page turns', async ({ page }) => {
    await mountEngine(page);
    const book = buildLongArabicBook(180, 3);

    await sendBridge(page, {
      type: 'load',
      book,
      settings: { disableAnimation: true, fontSize: 20, lineHeight: 1.95 },
    });

    await expect.poll(async () => (await getLatestPosition(page))?.pageCount ?? 0).toBeGreaterThan(52);

    for (let turn = 0; turn < 50; turn++) {
      const check = await page.evaluate(() => {
        const stage = document.getElementById('reader-stage')!;
        const track = document.getElementById('reader-track')!;
        const curr = document.querySelector<HTMLElement>('.chapter[aria-hidden="false"]')!;
        const vpRect = stage.getBoundingClientRect();

        const trackTransform = getComputedStyle(track).transform;
        let translateX = 0;
        if (trackTransform && trackTransform !== 'none') {
          const match = /matrix\(([^)]+)\)/.exec(trackTransform);
          if (match?.[1]) {
            const parts = match[1].split(',').map((v) => Number(v.trim()));
            translateX = parts[4] ?? 0;
          }
        }

        const visibleRects: Array<{ left: number; right: number; top: number; bottom: number; text: string }> = [];
        const slicedRects: Array<{ left: number; right: number; top: number; bottom: number; text: string }> = [];

        const walker = document.createTreeWalker(curr, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        let textNode = walker.nextNode() as Text | null;

        while (textNode) {
          if (textNode.data.trim().length > 0) {
            range.selectNodeContents(textNode);
            const rects = range.getClientRects();
            for (let i = 0; i < rects.length; i++) {
              const r = rects[i]!;
              if (r.width <= 0 || r.height <= 0) continue;
              const overlapsPage = r.right > vpRect.left + 1 && r.left < vpRect.right - 1;
              if (!overlapsPage) continue;

              const item = {
                left: r.left,
                right: r.right,
                top: r.top,
                bottom: r.bottom,
                text: textNode.data.slice(0, 30),
              };
              visibleRects.push(item);

              const outOfBounds =
                r.left < vpRect.left - 0.5 ||
                r.right > vpRect.right + 0.5 ||
                r.top < vpRect.top - 0.5 ||
                r.bottom > vpRect.bottom + 0.5;
              if (outOfBounds) {
                slicedRects.push(item);
              }
            }
          }
          textNode = walker.nextNode() as Text | null;
        }

        return {
          vpRect: { left: vpRect.left, right: vpRect.right, top: vpRect.top, bottom: vpRect.bottom },
          scrollLeftDoc: document.documentElement.scrollLeft,
          scrollLeftStage: stage.scrollLeft,
          translateX,
          visibleCount: visibleRects.length,
          slicedRects,
        };
      });

      expect(check.scrollLeftDoc).toBe(0);
      expect(check.scrollLeftStage).toBe(0);
      expect(Number.isInteger(Math.round(check.translateX * 1000) / 1000)).toBe(true);
      expect(check.visibleCount).toBeGreaterThan(0);
      expect(check.slicedRects).toEqual([]);

      await sendBridge(page, { type: 'next' });
    }
  });

  test('(b) every chapter starts on page 1 and chapter virtualization keeps <= 3 chapters in DOM', async ({ page }) => {
    await mountEngine(page);
    const book = buildLongArabicBook(60, 5);

    await sendBridge(page, {
      type: 'load',
      book,
      settings: { disableAnimation: true },
    });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe('ch01');

    // Verify virtualization window on load
    expect(await page.locator('.chapter').count()).toBeLessThanOrEqual(3);

    // Jump to each chapter via TOC goto and verify chapterPage === 1 and heading is visible
    for (const ch of book.chapters) {
      await sendBridge(page, { type: 'goto', chapterId: ch.id });
      await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe(ch.id);

      const pos = await getLatestPosition(page);
      expect(pos?.chapterPage).toBe(1);
      expect(await page.locator('.chapter').count()).toBeLessThanOrEqual(3);

      const headingVisible = await page.evaluate((cid) => {
        const stage = document.getElementById('reader-stage')!.getBoundingClientRect();
        const curr = document.querySelector<HTMLElement>(`.chapter[data-chapter-id="${cid}"][aria-hidden="false"]`);
        const h1 = curr?.querySelector<HTMLElement>('h1.chapter-title');
        if (!h1) return false;
        const r = h1.getBoundingClientRect();
        return r.left >= stage.left - 1 && r.right <= stage.right + 1 && r.top >= stage.top && r.bottom <= stage.bottom;
      }, ch.id);
      expect(headingVisible).toBe(true);
    }

    // Crossing from last page of ch01 to ch02 via `next` lands on ch02 page 1
    await sendBridge(page, { type: 'goto', chapterId: 'ch01' });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe('ch01');
    const ch1Pos = await getLatestPosition(page);
    const ch1Pages = ch1Pos?.chapterPageCount ?? 1;
    await sendBridge(page, { type: 'goto', chapterId: 'ch01', page: ch1Pages });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterPage).toBe(ch1Pages);
    await sendBridge(page, { type: 'next' });
    await expect.poll(async () => {
      const p = await getLatestPosition(page);
      return `${p?.chapterId}:${p?.chapterPage}`;
    }).toBe('ch02:1');
  });

  test('(c) increasing font size reflows and restores the exact blockId anchor without letter-spacing or word spans', async ({ page }) => {
    await mountEngine(page);
    const book = buildLongArabicBook(60, 2);

    await sendBridge(page, {
      type: 'load',
      book,
      settings: { disableAnimation: true, fontSize: 18 },
    });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe('ch01');

    // Navigate forward 5 pages so anchor is deep in the chapter
    for (let i = 0; i < 5; i++) {
      await sendBridge(page, { type: 'next' });
    }
    await expect.poll(async () => (await getLatestPosition(page))?.chapterPage).toBe(6);
    const posBefore = await getLatestPosition(page);
    expect(posBefore).not.toBeNull();
    expect(posBefore!.anchor.blockId).not.toBe('ch01_p0001');

    // Increase font size significantly to force full column reflow
    const msgCountBefore = (await getMessages(page)).length;
    await sendBridge(page, { type: 'settings', partial: { fontSize: 30 } });

    await expect.poll(async () => {
      const msgs = await getMessages(page);
      return msgs.slice(msgCountBefore).some((m) => m.type === 'position');
    }).toBe(true);

    const posAfter = await getLatestPosition(page);
    expect(posAfter?.anchor.blockId).toBe(posBefore!.anchor.blockId);

    const layoutChecks = await page.evaluate((targetBlockId) => {
      const stage = document.getElementById('reader-stage')!.getBoundingClientRect();
      const curr = document.querySelector<HTMLElement>('.chapter[aria-hidden="false"]')!;
      const block = curr.querySelector<HTMLElement>(`[data-block-id="${targetBlockId}"]`)!;
      const style = getComputedStyle(curr);
      const spansInParagraphs = curr.querySelectorAll('p span').length;

      // Check that at least one rect of the anchored block intersects the current page viewport
      const range = document.createRange();
      range.selectNodeContents(block);
      const rects = range.getClientRects();
      let blockVisible = false;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i]!;
        if (r.right > stage.left + 1 && r.left < stage.right - 1) {
          blockVisible = true;
          break;
        }
      }

      return {
        blockVisible,
        letterSpacing: style.letterSpacing,
        paddingTop: parseFloat(style.paddingTop),
        paddingBottom: parseFloat(style.paddingBottom),
        spansInParagraphs,
      };
    }, posBefore!.anchor.blockId);

    expect(layoutChecks.blockVisible).toBe(true);
    expect(['0px', 'normal']).toContain(layoutChecks.letterSpacing);
    expect(layoutChecks.paddingTop).toBeGreaterThanOrEqual(16);
    expect(layoutChecks.paddingBottom).toBeGreaterThanOrEqual(16);
    expect(layoutChecks.spansInParagraphs).toBe(0);
  });

  test('(d) tap zones work with reversed direction in RTL vs LTR', async ({ page }) => {
    await mountEngine(page);

    // 1. RTL book: left = next, right = prev, center = center
    const rtlBook = parseBook(sampleArText, 'sample-ar.md');
    await sendBridge(page, {
      type: 'load',
      book: rtlBook,
      settings: { disableAnimation: true },
    });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);

    // Tap left zone (15% width) -> next page in RTL
    await page.mouse.click(390 * 0.15, 422);
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(2);
    let msgs = await getMessages(page);
    expect(msgs.filter((m) => m.type === 'tap').at(-1)).toEqual({ type: 'tap', zone: 'next' });

    // Tap right zone (85% width) -> prev page in RTL
    await page.mouse.click(390 * 0.85, 422);
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);
    msgs = await getMessages(page);
    expect(msgs.filter((m) => m.type === 'tap').at(-1)).toEqual({ type: 'tap', zone: 'prev' });

    // Tap center zone (50% width) -> center, stays on page 1
    await page.mouse.click(390 * 0.5, 422);
    await expect.poll(async () => {
      const list = (await getMessages(page)).filter((m) => m.type === 'tap');
      return list.at(-1)?.zone;
    }).toBe('center');
    expect((await getLatestPosition(page))?.page).toBe(1);

    // 2. LTR book: right = next, left = prev, center = center
    const ltrBook = parseBook(sampleEnText, 'sample-en.md');
    await sendBridge(page, {
      type: 'load',
      book: ltrBook,
      settings: { disableAnimation: true },
    });
    await expect.poll(async () => {
      const p = await getLatestPosition(page);
      return p?.page === 1 && p?.chapterId === 'ch01' && (await page.locator('.chapter').first().getAttribute('dir')) === 'ltr';
    }).toBe(true);

    // Tap right zone (85% width) -> next page in LTR
    await page.mouse.click(390 * 0.85, 422);
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(2);
    msgs = await getMessages(page);
    expect(msgs.filter((m) => m.type === 'tap').at(-1)).toEqual({ type: 'tap', zone: 'next' });

    // Tap left zone (15% width) -> prev page in LTR
    await page.mouse.click(390 * 0.15, 422);
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);
    msgs = await getMessages(page);
    expect(msgs.filter((m) => m.type === 'tap').at(-1)).toEqual({ type: 'tap', zone: 'prev' });

    // Tap center zone (50% width) -> center, stays on page 1
    await page.mouse.click(390 * 0.5, 422);
    await expect.poll(async () => {
      const list = (await getMessages(page)).filter((m) => m.type === 'tap');
      return list.at(-1)?.zone;
    }).toBe('center');
    expect((await getLatestPosition(page))?.page).toBe(1);
  });

  test('(e) a 20,000-word chapter emits ready in less than 1500ms', async ({ page }) => {
    await mountEngine(page);
    const hugeBook = buildTwentyThousandWordChapterBook();
    expect(hugeBook.chapters[0]!.wordCount).toBeGreaterThanOrEqual(20_000);

    const elapsedMs = await page.evaluate(async (book) => {
      const win = window as unknown as {
        __bridgeMessages: WebToRNMessage[];
        ReactNativeWebView: { postMessage: (d: string) => void };
      };
      const start = performance.now();

      return new Promise<number>((resolve, reject) => {
        const origPost = win.ReactNativeWebView.postMessage.bind(win.ReactNativeWebView);
        win.ReactNativeWebView.postMessage = (data: string) => {
          origPost(data);
          try {
            const parsed = JSON.parse(data) as WebToRNMessage;
            if (parsed.type === 'ready') {
              resolve(performance.now() - start);
            }
          } catch {
            // ignore
          }
        };

        setTimeout(() => reject(new Error('Timed out waiting for ready')), 5000);
        window.postMessage(JSON.stringify({ type: 'load', book }), '*');
      });
    }, hugeBook);

    expect(elapsedMs).toBeLessThan(1500);
  });

  test('(f) registers @font-face rules from local fontBaseUrl and loads offline woff2 fonts', async ({ page }) => {
    await mountEngine(page);
    const fontsDirUrl = pathToFileURL(path.resolve(__dirname, '../../../apps/mobile/assets/fonts')).href + '/';
    const rtlBook = parseBook(sampleArText, 'sample-ar.md');

    await sendBridge(page, {
      type: 'load',
      book: rtlBook,
      fontBaseUrl: fontsDirUrl,
      settings: { fontFamily: 'Amiri', disableAnimation: true },
    });

    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe('ch01');

    const fontCheck = await page.evaluate(async () => {
      const styleEl = document.getElementById('rewiaty-font-faces');
      await document.fonts.ready;
      const loadedFamilies = Array.from(document.fonts)
        .filter((f) => f.status === 'loaded')
        .map((f) => f.family.replace(/['"]/g, ''));
      const totalFaces = document.fonts.size;
      return {
        hasStyleEl: Boolean(styleEl && styleEl.textContent?.includes('@font-face')),
        totalFaces,
        loadedFamilies,
      };
    });

    expect(fontCheck.hasStyleEl).toBe(true);
    expect(fontCheck.totalFaces).toBeGreaterThanOrEqual(8);
    expect(fontCheck.loadedFamilies).toContain('Amiri');

    await sendBridge(page, { type: 'settings', partial: { fontFamily: 'Noto Naskh Arabic' } });
    const notoLoaded = await page.evaluate(async () => {
      await document.fonts.load('400 20px "Noto Naskh Arabic"', 'تجربة');
      return Array.from(document.fonts).some(
        (f) => f.family.replace(/['"]/g, '') === 'Noto Naskh Arabic' && f.status === 'loaded',
      );
    });
    expect(notoLoaded).toBe(true);
  });
});
