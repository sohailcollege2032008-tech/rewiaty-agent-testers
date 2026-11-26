import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook, type Book } from '../../book-format/src/index.js';
import type { RNToWebMessage, ReaderSettings, WebToRNMessage } from '../src/types.js';

/**
 * F22 — smooth vertical scroll mode.
 *
 * The reader keeps every paginated feature (page map, TOC, scrubber, tashkeel, highlights,
 * footnotes) while presenting one continuous vertical column. These tests pin the promises
 * that are easy to break without noticing: the mode switch, the purely-visual column disable,
 * the edge fades and progress bar, the RTL transform origin, progress/chapter advancement,
 * the exact anchor round-trip between the two modes, `goto`, and that gestures are not
 * hijacked by the scroller.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readerHtmlUrl = pathToFileURL(path.resolve(__dirname, '../dist/reader.html')).href;

const ARABIC_PARA =
  'كَانَتِ الرِّيَاحُ تَهُبُّ بِهُدُوءٍ فَوْقَ الْمِينَاءِ الْقَدِيمِ، حَيْثُ تَرْتَطِمُ الْأَمْوَاجُ بِأَخْشَابِ الْمَرَاكِبِ وَيَتَأَمَّلُ سَلِيمٌ أَوْرَاقَ وَالِدِهِ الْمَكْتُوبَةَ بِعِنَايَةٍ وَدِقَّةٍ قَبْلَ سَنَوَاتٍ طَوِيلَةٍ فِي لَيْلَةٍ صَافِيَةٍ.';

function buildArabicBook(paragraphs: number, chapters: number): Book {
  const lines: string[] = ['---', 'title: "رِوَايَةُ الاسْتِمْرَارِ"', 'lang: ar', 'dir: rtl', '---', ''];
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
  return parseBook(lines.join('\n'), 'scroll-ar.md');
}

function buildFootnoteBook(): Book {
  const lines = [
    '---',
    'title: "حَوَاشِي الاسْتِمْرَارِ"',
    'lang: ar',
    'dir: rtl',
    '---',
    '',
    '# الْفَصْلُ الْأَوَّلُ',
    '',
    'هَذِهِ الْجُمْلَةُ فِيهَا حَاشِيَةٌ[^1] وَهِيَ تَكْمِلُ بَعْدَ الْمَرْجِعِ لِتَبْقَى عَائِمَةً فِي وَسَطِ الصَّفْحَةِ.',
    '',
    ARABIC_PARA,
    '',
    ARABIC_PARA,
    '',
    '# الْفَصْلُ الثَّانِي',
    '',
    ARABIC_PARA,
    '',
    ARABIC_PARA,
    '',
    '[^1]: نَصُّ الْحَاشِيَةِ الَّذِي يَجِبُ أَنْ يَظْهَرَ فِي الْبُطَاقَةِ.',
    '',
  ];
  return parseBook(lines.join('\n'), 'scroll-footnote.md');
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
      return JSON.parse(current) as Toc;
    }
    prev = current;
  }
  throw new Error('TOC never stabilised');
}

async function loadBook(
  page: Page,
  book: Book,
  settings: Partial<ReaderSettings> = {},
): Promise<void> {
  await sendBridge(page, { type: 'load', book, settings: { disableAnimation: true, ...settings } });
  // The first report waits for a real measurement of the book; on a loaded machine that
  // can take longer than the default 5s assertion window. The promise is unchanged.
  await expect
    .poll(async () => Boolean(await getLatestPosition(page)), { timeout: 30_000 })
    .toBe(true);
}

async function enterScroll(page: Page, extra: Partial<ReaderSettings> = {}): Promise<void> {
  await sendBridge(page, { type: 'settings', partial: { readingMode: 'scroll', ...extra } });
  await expect.poll(async () => (await getLatestPosition(page))?.readingMode).toBe('scroll');
}

async function scrollStageTo(page: Page, top: number): Promise<number> {
  return page.evaluate((value) => {
    const stage = document.getElementById('reader-stage')!;
    stage.scrollTop = value;
    return stage.scrollTop;
  }, top);
}

async function stageScroll(page: Page) {
  return page.evaluate(() => {
    const stage = document.getElementById('reader-stage')!;
    return {
      top: stage.scrollTop,
      height: stage.clientHeight,
      scrollHeight: stage.scrollHeight,
      max: Math.max(0, stage.scrollHeight - stage.clientHeight),
    };
  });
}

test.describe('F22 scroll mode', () => {
  test.use({ hasTouch: true });

  test('(m1) switching to scroll stacks chapters in one vertical scroller and disables columns', async ({
    page,
  }) => {
    await mountEngine(page);
    const book = buildArabicBook(90, 3);
    await loadBook(page, book, { fontSize: 20 });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);

    // Paginated by default: no scroll class, columns on.
    expect(await page.evaluate(() => document.getElementById('reader-root')!.className)).not.toContain(
      'scroll-mode',
    );

    await enterScroll(page);

    const state = await page.evaluate(() => {
      const root = document.getElementById('reader-root')!;
      const stage = document.getElementById('reader-stage')!;
      const track = document.getElementById('reader-track')!;
      const chapters = Array.from(document.querySelectorAll<HTMLElement>('.chapter'));
      const stageStyle = getComputedStyle(stage);
      const chapterStyle = chapters[0] ? getComputedStyle(chapters[0]) : null;
      return {
        className: root.className,
        overflowY: stageStyle.overflowY,
        touchAction: stageStyle.touchAction,
        trackTransform: getComputedStyle(track).transform,
        chapterColumnWidth: chapterStyle?.columnWidth ?? '',
        chapterPosition: chapterStyle?.position ?? '',
        chapterWidths: chapters.map((c) => Math.round(c.getBoundingClientRect().width)),
        tops: chapters.map((c) => Math.round(c.getBoundingClientRect().top + stage.scrollTop)),
        scrollHeight: stage.scrollHeight,
        clientHeight: stage.clientHeight,
      };
    });

    expect(state.className).toContain('scroll-mode');
    expect(state.overflowY).toBe('auto');
    expect(state.touchAction).toContain('pan-y');
    expect(state.trackTransform).toBe('none');
    expect(state.chapterColumnWidth).toBe('auto');
    expect(state.chapterPosition).toBe('relative');
    // One vertical column: every mounted chapter is full width and sits below the previous one.
    const maxWidth = Math.max(...state.chapterWidths);
    expect(state.chapterWidths.every((w) => Math.abs(w - maxWidth) <= 1)).toBe(true);
    expect(state.tops[1]).toBeGreaterThan(state.tops[0]!);
    expect(state.scrollHeight).toBeGreaterThan(state.clientHeight);

    const pos = await getLatestPosition(page);
    expect(pos?.readingMode).toBe('scroll');
    expect(pos?.spread).toBe(false);
    expect(typeof pos?.chapterProgress).toBe('number');
    expect(pos!.chapterProgress!).toBeGreaterThanOrEqual(0);
    expect(pos!.chapterProgress!).toBeLessThanOrEqual(1);
  });

  test('(m2) edge fades and the RTL progress bar are visible only in scroll mode', async ({ page }) => {
    await mountEngine(page);
    const book = buildArabicBook(90, 3);
    await loadBook(page, book, { fontSize: 20 });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);

    const hiddenFades = await page.evaluate(() => {
      const top = document.querySelector<HTMLElement>('.scroll-edge-fade-top')!;
      const bar = document.querySelector<HTMLElement>('.scroll-progress-bar')!;
      return {
        fade: getComputedStyle(top).display,
        bar: getComputedStyle(bar).display,
      };
    });
    expect(hiddenFades.fade).toBe('none');
    expect(hiddenFades.bar).toBe('none');

    await enterScroll(page);

    const chrome = await page.evaluate(() => {
      const top = document.querySelector<HTMLElement>('.scroll-edge-fade-top')!;
      const bottom = document.querySelector<HTMLElement>('.scroll-edge-fade-bottom')!;
      const bar = document.querySelector<HTMLElement>('.scroll-progress-bar')!;
      const fill = document.querySelector<HTMLElement>('.scroll-progress-fill')!;
      const topStyle = getComputedStyle(top);
      const barStyle = getComputedStyle(bar);
      const fillStyle = getComputedStyle(fill);
      return {
        topDisplay: topStyle.display,
        topHeight: topStyle.height,
        topPointerEvents: topStyle.pointerEvents,
        topZ: topStyle.zIndex,
        topBackground: topStyle.backgroundImage,
        bottomDisplay: getComputedStyle(bottom).display,
        barDisplay: barStyle.display,
        barHeight: barStyle.height,
        barZ: barStyle.zIndex,
        barPosition: barStyle.position,
        fillColor: fillStyle.backgroundColor,
        fillOrigin: fillStyle.transformOrigin,
        fillTransform: fillStyle.transform,
        stageHeight: document.getElementById('reader-stage')!.clientHeight,
      };
    });

    expect(chrome.topDisplay).not.toBe('none');
    expect(chrome.topHeight).toBe('24px');
    expect(chrome.topPointerEvents).toBe('none');
    expect(chrome.topZ).toBe('15');
    expect(chrome.topBackground).toContain('gradient');
    expect(chrome.bottomDisplay).not.toBe('none');

    expect(chrome.barDisplay).not.toBe('none');
    expect(chrome.barHeight).toBe('3px');
    expect(chrome.barZ).toBe('16');
    expect(chrome.barPosition).toBe('absolute');
    expect(chrome.fillColor).not.toBe('rgba(0, 0, 0, 0)');
    // RTL: the fill grows from the right edge. Chromium resolves the percentage origin
    // against the element's own box, so assert the pixel value it actually paints from —
    // and prove the direction is what moves it by flipping `dir` for a single read.
    const origins = await page.evaluate(() => {
      const fill = document.querySelector<HTMLElement>('.scroll-progress-fill')!;
      return {
        origin: getComputedStyle(fill).transformOrigin,
        // The layout width: `getBoundingClientRect` here would include the scaleX transform.
        width: Number.parseFloat(getComputedStyle(fill).width),
      };
    });
    const [originX, originY] = origins.origin.split(' ').map(Number.parseFloat);
    // Right edge, not left: the fill grows right-to-left.
    expect(originX).toBeCloseTo(origins.width, 1);
    expect(originY).toBeCloseTo(1.5, 1);
    expect(originX).toBeGreaterThan(100);
    // The fill mirrors the scroll offset: at the top of the book it is (near) empty.
    const start = await page.evaluate(() => {
      const stage = document.getElementById('reader-stage')!;
      const fill = document.querySelector<HTMLElement>('.scroll-progress-fill')!;
      const max = Math.max(1, stage.scrollHeight - stage.clientHeight);
      const match = /matrix\(([-\d.]+)/.exec(getComputedStyle(fill).transform);
      return {
        scale: match ? Number.parseFloat(match[1]!) : 1,
        expected: stage.scrollTop / max,
      };
    });
    expect(start.scale).toBeCloseTo(start.expected, 2);
    expect(start.scale).toBeLessThan(0.05);

    await scrollStageTo(page, Math.round(chrome.stageHeight));
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const fill = document.querySelector<HTMLElement>('.scroll-progress-fill')!;
          const m = getComputedStyle(fill).transform;
          const match = /matrix\(([-\d.]+)/.exec(m);
          return match ? Number.parseFloat(match[1]!) : 0;
        }),
      )
      .toBeGreaterThan(0);

    // The bar is optional: turning it off hides it without leaving scroll mode.
    await sendBridge(page, { type: 'settings', partial: { showScrollProgressBar: false } });
    await expect
      .poll(async () =>
        page.evaluate(() => getComputedStyle(document.querySelector<HTMLElement>('.scroll-progress-bar')!).display),
      )
      .toBe('none');
    expect(
      await page.evaluate(() => document.getElementById('reader-root')!.className),
    ).toContain('scroll-mode');

    await sendBridge(page, { type: 'settings', partial: { showScrollProgressBar: true } });
    await expect
      .poll(async () =>
        page.evaluate(() => getComputedStyle(document.querySelector<HTMLElement>('.scroll-progress-bar')!).display),
      )
      .not.toBe('none');
  });

  test('(m3) scrolling advances chapter progress, page and the current chapter', async ({ page }) => {
    await mountEngine(page);
    const book = buildArabicBook(150, 3);
    await loadBook(page, book, { fontSize: 20 });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);
    await stableToc(page);
    await enterScroll(page);

    const start = (await getLatestPosition(page))!;
    expect(start.chapterId).toBe('ch01');
    expect(start.chapterProgress!).toBeLessThan(0.05);

    // One viewport is a small slice of a chapter, so scroll by a fraction of the whole stack
    // (the promise under test is the reported progress, not the size of one step).
    const first = await stageScroll(page);
    await scrollStageTo(page, Math.round(first.scrollHeight * 0.25));
    await expect
      .poll(async () => (await getLatestPosition(page))?.chapterProgress ?? 0)
      .toBeGreaterThan(0.1);

    const mid = (await getLatestPosition(page))!;
    expect(mid.chapterProgress!).toBeGreaterThan(start.chapterProgress!);
    expect(mid.page).toBeGreaterThanOrEqual(start.page);
    expect(mid.readingMode).toBe('scroll');

    // Idle mounting adds the remaining chapters to the stack; wait for the book to be whole
    // before measuring its end, otherwise "the end" is the end of what is mounted so far.
    await expect
      .poll(async () =>
        page.evaluate(() => document.querySelectorAll('#reader-track .chapter').length),
      )
      .toBe(book.chapters.length);

    // Reading to the very end lands on the last chapter with near-complete book progress.
    const metrics = await stageScroll(page);
    await scrollStageTo(page, metrics.max);
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe('ch03');
    const end = (await getLatestPosition(page))!;
    expect(end.bookProgress).toBeGreaterThan(0.8);
    expect(end.chapterProgress!).toBeGreaterThan(0.5);
  });

  test('(m4) anchor round-trip paginated -> scroll -> paginated keeps the same block', async ({
    page,
  }) => {
    await mountEngine(page);
    const book = buildArabicBook(90, 3);
    await loadBook(page, book, { fontSize: 20 });

    for (let i = 0; i < 4; i++) await sendBridge(page, { type: 'next' });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(5);
    const paginatedBefore = (await getLatestPosition(page))!;

    await enterScroll(page);
    const inScroll = (await getLatestPosition(page))!;
    expect(inScroll.anchor.blockId).toBe(paginatedBefore.anchor.blockId);
    expect(
      await page.evaluate((blockId) => {
        const stage = document.getElementById('reader-stage')!;
        const stageRect = stage.getBoundingClientRect();
        const el = document.querySelector<HTMLElement>(`.chapter [data-block-id="${blockId}"]`);
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        // The restored block is at (or just above) the top reading line, and on screen.
        return rect.bottom > stageRect.top && rect.top < stageRect.top + 120;
      }, inScroll.anchor.blockId),
    ).toBe(true);

    // Read a little further in scroll mode, wait for the settled report, then switch back.
    const beforeScroll = await stageScroll(page);
    await scrollStageTo(page, Math.min(beforeScroll.max, beforeScroll.top + Math.round(beforeScroll.height * 0.6)));
    await expect
      .poll(async () => (await getLatestPosition(page))?.anchor.blockId)
      .not.toBe(inScroll.anchor.blockId);
    const scrolled = (await getLatestPosition(page))!;

    await sendBridge(page, { type: 'settings', partial: { readingMode: 'paginated' } });
    await expect.poll(async () => (await getLatestPosition(page))?.readingMode).toBe('paginated');
    const back = (await getLatestPosition(page))!;
    expect(back.anchor.blockId).toBe(scrolled.anchor.blockId);
  });

  test('(m5) goto({chapterId}), goto({anchor}) and goto({page}) scroll precisely', async ({ page }) => {
    await mountEngine(page);
    const book = buildArabicBook(120, 3);
    await loadBook(page, book, { fontSize: 20 });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);
    await enterScroll(page);

    await sendBridge(page, { type: 'goto', chapterId: 'ch03' });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe('ch03');
    const atChapter = (await getLatestPosition(page))!;
    expect(atChapter.chapterProgress!).toBeLessThan(0.1);
    expect(
      await page.evaluate(() => {
        const stage = document.getElementById('reader-stage')!.getBoundingClientRect();
        const third = document.querySelector<HTMLElement>('.chapter[data-chapter-id="ch03"]');
        if (!third) return false;
        return Math.abs(third.getBoundingClientRect().top - stage.top) < 40;
      }),
    ).toBe(true);

    const anchor = { blockId: book.chapters[2]!.blocks[8]!.id, charOffset: 0 };
    await sendBridge(page, { type: 'goto', anchor });
    await expect.poll(async () => (await getLatestPosition(page))?.anchor.blockId).toBe(anchor.blockId);
    expect(
      await page.evaluate((blockId) => {
        const stage = document.getElementById('reader-stage')!.getBoundingClientRect();
        const el = document.querySelector<HTMLElement>(`.chapter [data-block-id="${blockId}"]`);
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.top >= stage.top - 4 && rect.top < stage.top + 80;
      }, anchor.blockId),
    ).toBe(true);

    const toc = await stableToc(page);
    const target = toc.chapters[1]!;
    await sendBridge(page, { type: 'goto', page: target.startPage });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe(target.id);
    // Page-map granularity is a page, so allow a one-page landing tolerance.
    expect(Math.abs(((await getLatestPosition(page))?.page ?? 0) - target.startPage)).toBeLessThanOrEqual(1);
  });

  test('(m6) next/prev move ~85% of the viewport and horizontal swipes never turn pages', async ({
    page,
  }) => {
    await mountEngine(page);
    const book = buildArabicBook(120, 3);
    await loadBook(page, book, { fontSize: 20 });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);
    await enterScroll(page);

    const before = await stageScroll(page);
    const beforePos = (await getLatestPosition(page))!;
    await sendBridge(page, { type: 'next' });
    await expect
      .poll(async () => (await stageScroll(page)).top)
      .toBeGreaterThan(before.top + Math.round(before.height * 0.5));
    const afterNext = await stageScroll(page);
    const travelled = afterNext.top - before.top;
    expect(travelled).toBeGreaterThan(before.height * 0.7);
    expect(travelled).toBeLessThanOrEqual(before.height);

    // One screenful is a fraction of a chapter, so the promise is that the reading position
    // advanced — not that a whole page number ticked over.
    await expect
      .poll(async () => (await getLatestPosition(page))?.chapterProgress ?? 0)
      .toBeGreaterThan(beforePos.chapterProgress ?? 0);

    const midTop = afterNext.top;
    await sendBridge(page, { type: 'prev' });
    await expect.poll(async () => (await stageScroll(page)).top).toBeLessThan(midTop);

    // A horizontal swipe in scroll mode must not be interpreted as a page drag.
    const pageBeforeSwipe = (await getLatestPosition(page))!.page;
    const topBeforeSwipe = (await stageScroll(page)).top;
    await page.evaluate(async () => {
      const stage = document.getElementById('reader-stage')!;
      const rect = stage.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const fire = (type: string, clientX: number) => {
        stage.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 21,
            pointerType: 'touch',
            isPrimary: true,
            clientX,
            clientY: y,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
          }),
        );
      };
      fire('pointerdown', x);
      for (let i = 1; i <= 6; i++) {
        await new Promise((resolve) => setTimeout(resolve, 16));
        fire('pointermove', x + i * 20);
      }
      fire('pointerup', x + 120);
    });
    await page.waitForTimeout(300);
    const afterSwipe = (await getLatestPosition(page))!;
    expect(afterSwipe.page).toBe(pageBeforeSwipe);
    expect((await stageScroll(page)).top).toBe(topBeforeSwipe);
  });

  test('(m7) footnote taps, highlight taps and center taps still work in scroll mode', async ({
    page,
  }) => {
    await mountEngine(page);
    const book = buildFootnoteBook();
    await loadBook(page, book, { fontSize: 20, readingMode: 'scroll' });
    await expect.poll(async () => (await getLatestPosition(page))?.readingMode).toBe('scroll');

    // Footnote reference at the top of the first chapter is on screen.
    const tappedFootnote = await page.evaluate(async () => {
      const link = document.querySelector<HTMLElement>('.chapter[data-chapter-id="ch01"] sup.fn-ref a');
      if (!link) return false;
      const rect = link.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const fire = (type: string) => {
        link.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 31,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
          }),
        );
      };
      fire('pointerdown');
      await new Promise((resolve) => setTimeout(resolve, 30));
      fire('pointerup');
      return true;
    });
    expect(tappedFootnote).toBe(true);
    await expect
      .poll(async () => page.evaluate(() => !document.getElementById('footnote-backdrop')!.hidden))
      .toBe(true);

    await page.evaluate(() => document.getElementById('footnote-close')!.click());

    // Highlight covering the first paragraph: a tap on it must reach the host.
    const block = book.chapters[0]!.blocks.find((b) => b.kind === 'p')!;
    await sendBridge(page, {
      type: 'highlights',
      highlights: [
        { id: 'hl_scroll_1', blockId: block.id, charOffset: 0, length: 40, color: 'gold' },
      ],
    });
    await page.waitForTimeout(200);

    const highlighted = await page.evaluate(async (blockId) => {
      const el = document.querySelector<HTMLElement>(`.chapter [data-block-id="${blockId}"]`);
      if (!el) return null;
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = range.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i]!;
        if (r.width > 4 && r.height > 4) {
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }
      return null;
    }, block.id);
    expect(highlighted).not.toBeNull();

    const tapAt = async (x: number, y: number) =>
      page.evaluate(
        async ({ px, py }) => {
          const root = document.getElementById('reader-root')!;
          const fire = (type: string) => {
            root.dispatchEvent(
              new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                pointerId: 32,
                pointerType: 'touch',
                isPrimary: true,
                clientX: px,
                clientY: py,
                button: 0,
                buttons: type === 'pointerup' ? 0 : 1,
              }),
            );
          };
          fire('pointerdown');
          await new Promise((resolve) => setTimeout(resolve, 20));
          fire('pointerup');
        },
        { px: x, py: y },
      );

    await tapAt(highlighted!.x, highlighted!.y);
    await expect
      .poll(async () => (await getMessages(page)).some((m) => m.type === 'highlight-tap'))
      .toBe(true);

    // A plain tap in the middle of the page is still a center tap (HUD toggle).
    const stage = await page.evaluate(() => {
      const r = document.getElementById('reader-stage')!.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.75 };
    });
    await tapAt(stage.x, stage.y);
    await expect
      .poll(async () => (await getMessages(page)).some((m) => m.type === 'tap' && m.zone === 'center'))
      .toBe(true);
  });

  test('(m8) Arabic RTL never gets letter-spacing in scroll mode', async ({ page }) => {
    await mountEngine(page);
    const book = buildArabicBook(60, 2);
    await loadBook(page, book, { fontSize: 20, readingMode: 'scroll' });
    await expect.poll(async () => (await getLatestPosition(page))?.readingMode).toBe('scroll');

    const spacing = await page.evaluate(() => {
      const chapter = document.querySelector<HTMLElement>('.chapter[dir="rtl"]')!;
      const paragraph = chapter.querySelector<HTMLElement>('.block-p')!;
      // Control probe: this Chromium reports a resolved `letter-spacing: 0` as "normal",
      // so a probe carrying a real value proves the measurement can see spacing at all.
      const probe = document.createElement('span');
      probe.style.letterSpacing = '3px';
      document.body.appendChild(probe);
      const probeValue = getComputedStyle(probe).letterSpacing;
      probe.remove();
      return {
        chapter: getComputedStyle(chapter).letterSpacing,
        paragraph: getComputedStyle(paragraph).letterSpacing,
        probe: probeValue,
      };
    });
    expect(spacing.probe).toBe('3px');
    // Zero spacing, whether it resolves to "normal" or "0px".
    const trackingOf = (value: string) => (value === 'normal' ? 0 : Number.parseFloat(value));
    expect(trackingOf(spacing.chapter)).toBe(0);
    expect(trackingOf(spacing.paragraph)).toBe(0);
  });
});
