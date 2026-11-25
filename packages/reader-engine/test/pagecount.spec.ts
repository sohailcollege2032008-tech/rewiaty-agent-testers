import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook, type Book } from '../../book-format/src/index.js';
import type { RNToWebMessage, WebToRNMessage } from '../src/types.js';

/**
 * R3 — page numbers and the table of contents must agree, and the book total must not
 * move on its own.
 *
 * The reported bug (preview 5, P2-3): for one book and one layout the footer counted
 * "6" then "5" then "7" while the reader was only turning pages, and the TOC claimed a
 * chapter began on page 4 while `goto` landed on "3 of 6". The causes were (a) a total
 * recomputed per call from a mix of exact and estimated counts, (b) the estimate being
 * re-calibrated against whatever was mounted at that instant, and (c) the very first
 * measurement being taken before the webfont swapped in, so the whole book was scaled
 * from a too-wide fallback face.
 *
 * These tests pin the two promises the reader can see:
 *   1. while a chapter is still unmeasured the total is flagged `estimated` and stays
 *      put; once every chapter is measured it becomes exact — and it never moves back;
 *   2. `goto(toc[i].startPage)` reports exactly `toc[i].startPage`.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readerHtmlUrl = pathToFileURL(path.resolve(__dirname, '../dist/reader.html')).href;
const fontsDirUrl =
  pathToFileURL(path.resolve(__dirname, '../../../apps/mobile/assets/fonts')).href + '/';

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 1366, height: 1024 };

const ARABIC_PARA =
  'كَانَتِ الرِّيَاحُ تَهُبُّ بِهُدُوءٍ فَوْقَ الْمِينَاءِ الْقَدِيمِ، حَيْثُ تَرْتَطِمُ الْأَمْوَاجُ بِأَخْشَابِ الْمَرَاكِبِ وَيَتَأَمَّلُ سَلِيمٌ أَوْرَاقَ وَالِدِهِ الْمَكْتُوبَةَ بِعِنَايَةٍ وَدِقَّةٍ قَبْلَ سَنَوَاتٍ طَوِيلَةٍ فِي لَيْلَةٍ صَافِيَةٍ.';

/**
 * Three chapters of unequal size. The first one alone is bigger than the engine's
 * initial mount budget, so it is still progressively mounting (and therefore still
 * estimated) while the reader is already turning pages — exactly the window in which
 * the reported total used to drift.
 */
function buildBook(paragraphsPerChapter: number[]): Book {
  const lines = ['---', 'title: "رِوَايَةُ ثَلَاثَةِ فُصُولٍ"', 'lang: ar', 'dir: rtl', '---', ''];
  paragraphsPerChapter.forEach((paragraphs, c) => {
    lines.push(`# الْفَصْلُ رَقْمُ ${c + 1}`, '');
    for (let p = 1; p <= paragraphs; p++) {
      lines.push(`${ARABIC_PARA} (${c + 1}.${p})`, '');
    }
  });
  return parseBook(lines.join('\n'), 'r3-pagecount.md');
}

type Position = Extract<WebToRNMessage, { type: 'position' }>;
type Toc = Extract<WebToRNMessage, { type: 'toc' }>;

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
          /* ignore */
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
  return page.evaluate(
    () => (window as unknown as { __bridgeMessages: WebToRNMessage[] }).__bridgeMessages,
  );
}

async function clearMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __bridgeMessages: WebToRNMessage[] }).__bridgeMessages.length = 0;
  });
}

async function positions(page: Page): Promise<Position[]> {
  return (await getMessages(page)).filter((m): m is Position => m.type === 'position');
}

async function latestPosition(page: Page): Promise<Position | null> {
  const all = await positions(page);
  return all.length ? all[all.length - 1]! : null;
}

async function latestToc(page: Page): Promise<Toc | null> {
  const msgs = await getMessages(page);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.type === 'toc') return m;
  }
  return null;
}

/** Wait until two consecutive TOC samples are identical — i.e. measuring went idle. */
async function stableToc(page: Page): Promise<Toc> {
  let prev = JSON.stringify(await latestToc(page));
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(200);
    const current = JSON.stringify(await latestToc(page));
    if (current === prev && prev !== 'null') return JSON.parse(current) as Toc;
    prev = current;
  }
  throw new Error('TOC never stabilised');
}

/** Advance one page (or spread); `null` means the reader is already on the last one. */
async function stepForward(page: Page): Promise<Position | null> {
  const before = (await positions(page)).length;
  await sendBridge(page, { type: 'next' });
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(50);
    if ((await positions(page)).length > before) return await latestPosition(page);
  }
  return null;
}

/**
 * The heart of the regression: every position emitted for one layout must agree on a
 * single total. While chapters are unmeasured that total is flagged `estimated`; the
 * moment the last chapter is measured it becomes exact, and it may never go back or
 * wobble between the two states.
 */
function assertTotalIsStable(all: Position[]): Position {
  expect(all.length).toBeGreaterThan(1);

  const estimated = all.filter((p) => p.estimated);
  const exact = all.filter((p) => !p.estimated);

  // Estimated totals are pinned for the layout: one value, never re-derived.
  for (const p of estimated) {
    expect(p.pageCount, `total drifted while still estimated (page ${p.page})`).toBe(
      estimated[0]!.pageCount,
    );
  }
  // An exact reading is final for that layout.
  for (const p of exact) {
    expect(p.pageCount, `total drifted after it became exact (page ${p.page})`).toBe(
      exact[0]!.pageCount,
    );
  }

  // Exactness only ever moves forward, and the last word is the exact total.
  const firstExactIndex = all.findIndex((p) => !p.estimated);
  if (firstExactIndex >= 0) {
    expect(
      all.slice(firstExactIndex).every((p) => !p.estimated),
      'layout fell back from an exact total to an estimate',
    ).toBe(true);
    return all[firstExactIndex]!;
  }
  return estimated[0]!;
}

/** TOC counts are cumulative on real pages and end exactly on the book total. */
function assertTocIsCumulative(toc: Toc, total: number): void {
  let acc = 1;
  for (const chapter of toc.chapters) {
    expect(chapter.startPage, `start page of ${chapter.id}`).toBe(acc);
    expect(chapter.pageCount, `page count of ${chapter.id}`).toBeGreaterThan(0);
    acc += chapter.pageCount;
  }
  expect(acc - 1, 'the TOC must describe exactly the pages the footer counts').toBe(total);
}

/** The page the TOC advertises must be the page the app jumps to. */
async function expectTocTargetsAreReachable(page: Page): Promise<void> {
  const toc = await stableToc(page);
  for (const chapter of toc.chapters) {
    await sendBridge(page, { type: 'goto', page: chapter.startPage });
    await expect
      .poll(async () => (await latestPosition(page))?.chapterId, { timeout: 5_000 })
      .toBe(chapter.id);
    const pos = (await latestPosition(page))!;
    expect(pos.page, `goto ${chapter.id} landed on the wrong page`).toBe(chapter.startPage);
    expect(pos.chapterPage, `goto ${chapter.id} did not land on its first page`).toBe(1);
    expect(pos.chapterPageCount).toBe(chapter.pageCount);
  }
}

test.describe('Rewiaty page numbering (R3)', () => {
  test('(r3-1) the total is pinned through a whole-book read, and every TOC page is reachable', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(PORTRAIT);
    await mountEngine(page);
    const book = buildBook([120, 60, 60]);
    expect(book.chapters.length).toBe(3);

    await sendBridge(page, {
      type: 'load',
      book,
      fontBaseUrl: fontsDirUrl,
      settings: { disableAnimation: true },
    });
    await expect.poll(async () => (await latestPosition(page))?.page).toBe(1);

    const atStart = (await latestPosition(page))!;
    expect(atStart.spread).toBe(false);
    const tocAtStart = await stableToc(page);
    assertTocIsCumulative(tocAtStart, atStart.pageCount);

    // ---------- read the whole book, one page at a time ----------
    let pos = atStart;
    for (let turn = 0; turn < 240; turn++) {
      const next = await stepForward(page);
      if (!next) break; // the reader is on the last page
      expect(
        next.page,
        'the page number must never go backwards while reading forward',
      ).toBeGreaterThanOrEqual(pos.page);
      pos = next;
    }

    const all = await positions(page);
    const settled = assertTotalIsStable(all);
    const total = settled.pageCount;

    // Reaching the end proves the total was never an undercount.
    expect(pos.page, 'the last page must be the page the footer called last').toBe(total);
    expect(pos.estimated, 'every chapter was visited, so the total must be exact now').toBe(false);
    expect(pos.chapterId).toBe(book.chapters[2]!.id);

    // A whole-book read must not lose or invent pages: the first snapshot's total and
    // the settled one describe the same book and the same layout.
    expect(total).toBe(atStart.pageCount);

    const finalToc = await stableToc(page);
    assertTocIsCumulative(finalToc, total);

    // ---------- the TOC page is the page the reader lands on ----------
    await expectTocTargetsAreReachable(page);

    // ---------- opening and closing the settings sheet ----------
    await clearMessages(page);
    await sendBridge(page, { type: 'settings', partial: { fontSize: 22 } });
    await expect
      .poll(async () => (await positions(page)).length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    const bigger = await latestPosition(page);
    expect(bigger).not.toBeNull();
    expect(bigger!.pageCount, 'a new layout must not silently reuse the old total').not.toBe(0);

    await clearMessages(page);
    await sendBridge(page, { type: 'settings', partial: { fontSize: 20 } });
    await expect
      .poll(async () => (await latestPosition(page))?.pageCount, { timeout: 10_000 })
      .toBe(total);

    // Back on the original layout the numbers are the same numbers again.
    const restored = (await latestPosition(page))!;
    expect(restored.estimated).toBe(false);
    const restoredToc = await stableToc(page);
    assertTocIsCumulative(restoredToc, total);
    await expectTocTargetsAreReachable(page);
  });

  test('(r3-3) the total is pinned only after the webfont has settled, and never moves for it', async ({
    page,
  }) => {
    // Why (product): this is the CI-only failure. On a runner the webfont is still
    // fetching when the first background batch reports, so the total was pinned to
    // fallback-face metrics ("of 56") and corrected to the real one ("of 55") a moment
    // later — the same number the reader was already looking at. Delaying the faces
    // reproduces that window deterministically; a fixed engine reports exactly one
    // total and it is the exact one.
    test.setTimeout(180_000);
    await page.route('**/*.woff2', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 450));
      await route.continue();
    });
    await page.setViewportSize(PORTRAIT);
    await mountEngine(page);
    const book = buildBook([120, 60, 60]);

    await sendBridge(page, {
      type: 'load',
      book,
      fontBaseUrl: fontsDirUrl,
      settings: { disableAnimation: true },
    });
    await expect.poll(async () => (await latestPosition(page))?.page, { timeout: 10_000 }).toBe(1);

    const atStart = (await latestPosition(page))!;
    // Nothing derived from a half-loaded face may be published: the very first total the
    // reader sees is already the settled one.
    const facesLoaded = await page.evaluate(() => document.fonts?.status !== 'loading');
    expect(facesLoaded, 'the first position must wait for the faces it measures').toBe(true);

    let pos = atStart;
    for (let turn = 0; turn < 240; turn++) {
      const next = await stepForward(page);
      if (!next) break;
      expect(next.page).toBeGreaterThanOrEqual(pos.page);
      pos = next;
    }

    const all = await positions(page);
    const settled = assertTotalIsStable(all);
    const total = settled.pageCount;
    expect(pos.page).toBe(total);
    expect(pos.estimated).toBe(false);
    expect(total).toBe(atStart.pageCount);
    assertTocIsCumulative(await stableToc(page), total);
  });

  test('(r3-2) two-page spreads: the same numbers, and blank pad pages are never counted', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(LANDSCAPE);
    await mountEngine(page);
    const book = buildBook([120, 60, 60]);

    await sendBridge(page, {
      type: 'load',
      book,
      fontBaseUrl: fontsDirUrl,
      settings: { disableAnimation: true, fontSize: 20 },
    });
    await expect.poll(async () => (await latestPosition(page))?.page).toBe(1);

    const atStart = (await latestPosition(page))!;
    expect(atStart.spread).toBe(true);
    const tocAtStart = await stableToc(page);
    assertTocIsCumulative(tocAtStart, atStart.pageCount);

    // ---------- read the whole book, spread by spread ----------
    let pos = atStart;
    for (let turn = 0; turn < 240; turn++) {
      const next = await stepForward(page);
      if (!next) break; // the reader is on the last spread
      // A spread reports its first page, so it can never step past the last real page.
      expect(next.page).toBeLessThanOrEqual(atStart.pageCount);
      expect(next.page).toBeGreaterThanOrEqual(pos.page);
      pos = next;
    }

    const all = await positions(page);
    const settled = assertTotalIsStable(all);
    const total = settled.pageCount;
    expect(total).toBe(atStart.pageCount);
    // The last spread opens on the last page, or on the last pair when the total is even.
    expect(pos.page).toBeGreaterThanOrEqual(total - 1);
    expect(pos.page).toBeLessThanOrEqual(total);

    const finalToc = await stableToc(page);
    assertTocIsCumulative(finalToc, total);

    // Physical pages may exceed the total (each chapter pads to an even count), but the
    // pad is layout only: it must never appear as a page number, a TOC count or a total.
    const physical = await page.evaluate(() => {
      const pw =
        Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-width')) || 1;
      return Array.from(document.querySelectorAll<HTMLElement>('.chapter')).map((el) => ({
        id: el.getAttribute('data-chapter-id') ?? '',
        layoutPages: Math.max(1, Math.ceil(el.scrollWidth / pw)),
        padPages: el.querySelectorAll('.chapter-pad').length,
      }));
    });
    expect(physical.length).toBeGreaterThan(0);
    for (const mounted of physical) {
      const entry = finalToc.chapters.find((c) => c.id === mounted.id);
      expect(entry, `mounted chapter ${mounted.id} must appear in the TOC`).toBeTruthy();
      expect(mounted.layoutPages - mounted.padPages).toBe(entry!.pageCount);
      expect(mounted.padPages).toBeLessThanOrEqual(1);
    }

    await expectTocTargetsAreReachable(page);
  });
});
