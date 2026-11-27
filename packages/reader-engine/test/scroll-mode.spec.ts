import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook, type Book } from '../../book-format/src/index.js';
import type { RNToWebMessage, ReaderSettings, ScenePlaceholder, WebToRNMessage } from '../src/types.js';

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

    // Every chapter owns a slot, so the scroll track already spans the whole book even
    // though only the visible window is mounted. Wait for the slot table to be complete
    // (that is what makes "the end" the real end, not the end of what is mounted so far).
    await expect
      .poll(async () =>
        page.evaluate(() => document.querySelectorAll('#reader-track .scroll-chapter-slot').length),
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

  /**
   * P1-1 (lead review): the host persists `charOffset`, so a position that is restored and
   * then handed back must keep the character offset — not just the block. A programmatic
   * placement must never look like a user scroll.
   */
  test('(m9) a restored anchor keeps its character offset across paginated -> scroll -> paginated', async ({
    page,
  }) => {
    await mountEngine(page);
    const book = buildArabicBook(200, 6);
    await loadBook(page, book, { fontSize: 20 });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);

    // Walk forward until a page starts mid-block: only then does the anchor carry a real
    // character offset, which is the part a naive re-derivation loses.
    let paginated = (await getLatestPosition(page))!;
    for (let i = 0; i < 25 && (paginated.anchor.charOffset ?? 0) === 0; i++) {
      const before = paginated.page;
      await sendBridge(page, { type: 'next' });
      await expect.poll(async () => (await getLatestPosition(page))?.page ?? 0).toBeGreaterThan(before);
      paginated = (await getLatestPosition(page))!;
    }
    expect(
      paginated.anchor.charOffset,
      'expected to reach a paginated page that starts in the middle of a block',
    ).toBeGreaterThan(0);

    await enterScroll(page);
    // The engine reports on scroll settle (100 ms); let it run so the assertion below is
    // about the settled state, not the synchronous one.
    await page.waitForTimeout(300);
    const inScroll = (await getLatestPosition(page))!;
    expect(inScroll.readingMode).toBe('scroll');
    expect(inScroll.anchor.blockId).toBe(paginated.anchor.blockId);
    expect(inScroll.anchor.charOffset).toBe(paginated.anchor.charOffset);

    // The restored block really is on the reading line, so "same anchor" is not just a
    // bookkeeping lie.
    expect(
      await page.evaluate((blockId) => {
        const stage = document.getElementById('reader-stage')!;
        const stageRect = stage.getBoundingClientRect();
        const el = document.querySelector<HTMLElement>(`.chapter [data-block-id="${blockId}"]`);
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.bottom > stageRect.top && rect.top < stageRect.top + 160;
      }, inScroll.anchor.blockId),
    ).toBe(true);

    await sendBridge(page, { type: 'settings', partial: { readingMode: 'paginated' } });
    await expect.poll(async () => (await getLatestPosition(page))?.readingMode).toBe('paginated');
    const back = (await getLatestPosition(page))!;
    expect(back.anchor.blockId).toBe(paginated.anchor.blockId);
    expect(back.anchor.charOffset).toBe(paginated.anchor.charOffset);
  });

  /**
   * P2-1 (lead review): chapters are virtualized by slot, not mounted all at once. A jump
   * deep into a long book must land correctly while only a small window of chapters is real
   * DOM, and the window must stay bounded as the reader scrolls on.
   */
  test('(m10) a deep jump mounts only a bounded window of chapters around the visible one', async ({
    page,
  }) => {
    await mountEngine(page);
    const book = buildArabicBook(240, 20);
    await loadBook(page, book, { fontSize: 20, readingMode: 'scroll' });
    await expect.poll(async () => (await getLatestPosition(page))?.readingMode).toBe('scroll');

    // Every chapter keeps its slot, so the track spans the whole book from the first frame.
    await expect
      .poll(async () =>
        page.evaluate(() => document.querySelectorAll('#reader-track .scroll-chapter-slot').length),
      )
      .toBe(book.chapters.length);

    await sendBridge(page, { type: 'goto', chapterId: 'ch15' });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe('ch15');
    await page.waitForTimeout(150);

    const mounted = (): Promise<string[]> =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('#reader-track .chapter')).map(
          (el) => el.dataset.chapterId ?? '',
        ),
      );

    const atJump = await mounted();
    expect(atJump).toContain('ch15');
    expect(atJump.length, `mounted too many chapters: ${atJump.join(',')}`).toBeLessThanOrEqual(5);
    // The far end of the book was never materialized — that is the whole point of the slot.
    expect(atJump).not.toContain('ch01');
    expect(atJump).not.toContain('ch20');

    // The reserved track is still the whole book: the slot heights, not the mounted set,
    // define how far the reader can scroll.
    const track = await stageScroll(page);
    expect(track.scrollHeight).toBeGreaterThan(track.height * 10);

    // Scrolling to the end recycles the window instead of accumulating DOM.
    await scrollStageTo(page, track.max);
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe('ch20');
    const atEnd = await mounted();
    expect(atEnd).toContain('ch20');
    expect(atEnd.length, `mounted too many chapters at the end: ${atEnd.join(',')}`).toBeLessThanOrEqual(
      5,
    );
  });

  /**
   * P2-2 (lead review): in scroll mode a chapter's own `pageCount` is a frozen estimate; the
   * in-chapter count that `goto({page})` must use is the one the page map measured.
   */
  test('(m11) goto({page}) uses the measured page map and reports that exact page', async ({ page }) => {
    await mountEngine(page);
    const book = buildArabicBook(180, 5);
    await loadBook(page, book, { fontSize: 20 });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);
    await stableToc(page);
    await enterScroll(page);

    const toc = await stableToc(page);
    // A chapter with several pages, so "page 2 of it" cannot be confused with its start.
    const target = [...toc.chapters].filter((c) => c.pageCount >= 3).sort((a, b) => b.pageCount - a.pageCount)[0];
    expect(target, 'the fixture must contain a chapter of at least three pages').toBeTruthy();
    const requested = target!.startPage + 1;

    await sendBridge(page, { type: 'goto', page: requested });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(requested);
    const landed = (await getLatestPosition(page))!;
    expect(landed.chapterId).toBe(target!.id);
    expect(landed.chapterPage).toBe(2);
  });

  /**
   * P2-3 (lead review): `scrollTop` is clamped at the end of the track, so a final chapter
   * shorter than the viewport can only reach the reading line if the track reserves the
   * missing tail. Without it `goto(last chapter)` silently lands on the previous one.
   */
  test('(m12) a short final chapter still reaches the reading line', async ({ page }) => {
    await mountEngine(page);
    const lines: string[] = ['---', 'title: "ذَيْلٌ قَصِيرٌ"', 'lang: ar', 'dir: rtl', '---', ''];
    for (let c = 1; c <= 3; c++) {
      lines.push(`# الْفَصْلُ رَقْمُ ${c}`, '');
      for (let p = 1; p <= 40; p++) lines.push(`${ARABIC_PARA} (${c}.${p})`, '');
    }
    lines.push('# الْفَصْلُ الْأَخِيرُ', '', `${ARABIC_PARA} (4.1)`, '');
    const book = parseBook(lines.join('\n'), 'short-tail.md');

    await loadBook(page, book, { fontSize: 20, readingMode: 'scroll' });
    await expect.poll(async () => (await getLatestPosition(page))?.readingMode).toBe('scroll');

    await sendBridge(page, { type: 'goto', chapterId: 'ch04' });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe('ch04');
    await page.waitForTimeout(150);
    expect((await getLatestPosition(page))!.chapterId).toBe('ch04');

    const geometry = await page.evaluate(() => {
      const stage = document.getElementById('reader-stage')!;
      const track = document.getElementById('reader-track')!;
      const last = document.querySelector<HTMLElement>('.chapter[data-chapter-id="ch04"]');
      if (!last) return null;
      const stageRect = stage.getBoundingClientRect();
      return {
        top: stage.scrollTop,
        max: Math.max(0, stage.scrollHeight - stage.clientHeight),
        lastTop: last.getBoundingClientRect().top - stageRect.top,
        trackPaddingTop: Number.parseFloat(getComputedStyle(track).paddingTop),
        trackPaddingBottom: Number.parseFloat(getComputedStyle(track).paddingBottom),
        lastHeight: last.getBoundingClientRect().height,
      };
    });
    expect(geometry).not.toBeNull();
    const g = geometry!;
    // The reserved tail is what lets the clamp go far enough; it must be real, not the base pad.
    expect(g.lastHeight).toBeLessThan(600);
    expect(g.trackPaddingBottom).toBeGreaterThan(g.lastHeight);
    // Pinned to the end of the track (a few px of rounding), with the short last chapter
    // sitting on the reading line — the clamp is no longer what decides the position.
    expect(g.top).toBeGreaterThan(g.max - 40);
    expect(Math.abs(g.lastTop - g.trackPaddingTop)).toBeLessThanOrEqual(6);
  });

  /**
   * P2-4 (lead review): a scene frame has flow height, so it must be in the DOM *before* the
   * slot height is measured, and a frame whose box changes while scrolling must re-anchor —
   * otherwise the reader is pushed off the line by the frame's height.
   */
  test('(m13) a scene frame is measured with the chapter and re-anchors when its box changes', async ({
    page,
  }) => {
    await mountEngine(page);
    const book = buildArabicBook(200, 8);
    const anchorChapter = book.chapters[1]!;
    const placeholder: ScenePlaceholder = {
      id: 'scene-scroll-1',
      afterBlockId: anchorChapter.blocks[2]!.id,
      caption: 'مَشْهَدٌ بَيْنَ السُّطُورِ',
      prompt: {
        setting: 'ميناء قديم عند الفجر',
        mood: 'حنين هادئ',
        characters: 'سليم وأبوه',
        style: 'حبر وورق حرفي',
      },
      status: 'idle',
      aspectRatio: 1.6,
      collapsed: false,
    };
    const targetBlock = anchorChapter.blocks[3]!.id;

    await sendBridge(page, {
      type: 'load',
      book,
      settings: { disableAnimation: true, fontSize: 20, readingMode: 'scroll' },
      scenePlaceholders: [placeholder],
      sceneDisplayMode: 'expanded',
    });
    await expect.poll(async () => (await getLatestPosition(page))?.readingMode).toBe('scroll');
    await expect(page.locator('figure.scene-placeholder')).toHaveCount(1);

    // The block after the frame lands on the reading line: the frame's height was part of
    // the slot when the chapter was measured.
    const lineOffset = (blockId: string): Promise<number> =>
      page.evaluate((id) => {
        const stage = document.getElementById('reader-stage')!;
        const stageRect = stage.getBoundingClientRect();
        const track = document.getElementById('reader-track')!;
        const paddingTop = Number.parseFloat(getComputedStyle(track).paddingTop);
        const el = document.querySelector<HTMLElement>(`.chapter [data-block-id="${id}"]`);
        if (!el) return Number.NaN;
        return el.getBoundingClientRect().top - (stageRect.top + paddingTop);
      }, blockId);

    await sendBridge(page, { type: 'goto', anchor: { blockId: targetBlock, charOffset: 0 } });
    await expect.poll(async () => (await getLatestPosition(page))?.anchor.blockId).toBe(targetBlock);
    await page.waitForTimeout(150);
    expect(Math.abs(await lineOffset(targetBlock))).toBeLessThanOrEqual(8);

    const beforeHeight = await page.evaluate(
      () => document.querySelector('figure.scene-placeholder')!.getBoundingClientRect().height,
    );

    // Growing the frame (taller aspect box) changes the flow height *above* the line.
    await sendBridge(page, {
      type: 'scene-update',
      placeholder: { ...placeholder, aspectRatio: 0.5 },
    });
    await expect
      .poll(async () =>
        page.evaluate(
          () => document.querySelector('figure.scene-placeholder')!.getBoundingClientRect().height,
        ),
      )
      .toBeGreaterThan(beforeHeight + 40);
    await page.waitForTimeout(150);
    // Re-anchored, not pushed: the same block is still the line.
    expect(Math.abs(await lineOffset(targetBlock))).toBeLessThanOrEqual(8);
    expect((await getLatestPosition(page))!.anchor.blockId).toBe(targetBlock);

    // Virtualization evicts the chapter; coming back must re-mount the frame with the flow.
    const stage = await stageScroll(page);
    await scrollStageTo(page, stage.max);
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe('ch08');
    await expect(page.locator('.chapter[data-chapter-id="ch02"]')).toHaveCount(0);

    await sendBridge(page, { type: 'goto', anchor: { blockId: targetBlock, charOffset: 0 } });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe('ch02');
    await expect(page.locator('figure.scene-placeholder')).toHaveCount(1);
    await page.waitForTimeout(150);
    expect(Math.abs(await lineOffset(targetBlock))).toBeLessThanOrEqual(8);
  });
});
