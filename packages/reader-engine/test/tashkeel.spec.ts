import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook, type Anchor, type Book } from '../../book-format/src/index.js';
import type { RNToWebMessage, WebToRNMessage } from '../src/types.js';
import {
  displayOffsetForOriginalOffset,
  originalOffsetForDisplayOffset,
  stripTashkeel,
  type TashkeelMode,
} from '../src/tashkeel.js';

/**
 * F18 — أوضاع التشكيل.
 *
 * The reader promise has two halves and both are pinned here:
 *
 *   1. the mode is applied *inside the engine, at render time, on text nodes only* — no
 *      `<span>` ever lands inside a word (that breaks Arabic shaping) and the parsed book
 *      markup is never rewritten;
 *   2. the anchor stays in **original-text coordinates**. Search (FTS) and the bookmarks
 *      address the file's own text, so an anchor captured while diacritics are hidden must
 *      still point at the same character once they are shown again — and the page must not
 *      jump somewhere else in between (Sohail's explicit requirement).
 *
 * The expected display offsets below are produced by the pure, unit-tested mapping in
 * `src/tashkeel.ts` (see `test/tashkeel.test.ts`); the geometry is read from the browser's
 * own layout, so the engine is not graded against its own arithmetic alone.
 *
 * Measured, not assumed: the diacritics are combining marks, so they add **no advance
 * width** — a chapter loses ~40% of its characters and still lays out in the exact same box
 * (the test asserts both halves of that). So the page numbers of a mode may well equal the
 * ones of another mode, and the promise that has to be proven is not "fewer pages" but
 * "the pagination of «بدون» is the pagination of the same text with the marks stripped in
 * the file" — which the control book at the end of the first test does.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readerHtmlUrl = pathToFileURL(path.resolve(__dirname, '../dist/reader.html')).href;
const fontsDirUrl =
  pathToFileURL(path.resolve(__dirname, '../../../apps/mobile/assets/fonts')).href + '/';

const PORTRAIT = { width: 390, height: 844 };

/** Heavily vocalised: every letter carries a haraka, and the shadda recurs. */
const ARABIC_PARA =
  'كَانَتِ الرِّيَاحُ تَهُبُّ بِهُدُوءٍ فَوْقَ الْمِينَاءِ الْقَدِيمِ، حَيْثُ تَرْتَطِمُ الْأَمْوَاجُ بِأَخْشَابِ الْمَرَاكِبِ وَيَتَأَمَّلُ سَلِيمٌ أَوْرَاقَ وَالِدِهِ الْمَكْتُوبَةَ بِعِنَايَةٍ وَدِقَّةٍ قَبْلَ سَنَوَاتٍ طَوِيلَةٍ فِي لَيْلَةٍ صَافِيَةٍ.';

function buildBook(paragraphsPerChapter: number[], mode: TashkeelMode = 'full'): Book {
  const text = (value: string) => stripTashkeel(value, mode);
  const lines = ['---', `title: "${text('رِوَايَةُ التَّشْكِيلِ')}"`, 'lang: ar', 'dir: rtl', '---', ''];
  for (let c = 1; c <= paragraphsPerChapter.length; c++) {
    lines.push(`# ${text('الْفَصْلُ رَقْمُ')} ${c}`, '');
    for (let p = 1; p <= paragraphsPerChapter[c - 1]!; p++) {
      lines.push(`${text(ARABIC_PARA)} (${c}.${p})`, '');
    }
  }
  return parseBook(lines.join('\n'), 'f18-tashkeel.md');
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

async function latestPosition(page: Page): Promise<Position | null> {
  const messages = await page.evaluate(
    () => (window as unknown as { __bridgeMessages: WebToRNMessage[] }).__bridgeMessages,
  );
  const positions = messages.filter((m): m is Position => m.type === 'position');
  return positions.length ? positions[positions.length - 1]! : null;
}

async function latestToc(page: Page): Promise<Toc | null> {
  const messages = await page.evaluate(
    () => (window as unknown as { __bridgeMessages: WebToRNMessage[] }).__bridgeMessages,
  );
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.type === 'toc') return m;
  }
  return null;
}

/** Wait until the engine stops reporting (background measuring went idle). */
async function settledPosition(page: Page): Promise<Position> {
  let previous = JSON.stringify(await latestPosition(page));
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(150);
    const current = JSON.stringify(await latestPosition(page));
    if (current === previous) return JSON.parse(current) as Position;
    previous = current;
  }
  throw new Error('position never settled');
}

async function latestTocStable(page: Page): Promise<Toc> {
  let previous = JSON.stringify(await latestToc(page));
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(150);
    const current = JSON.stringify(await latestToc(page));
    if (current === previous && previous !== 'null') return JSON.parse(current) as Toc;
    previous = current;
  }
  throw new Error('TOC never settled');
}

async function setMode(page: Page, mode: TashkeelMode): Promise<Position> {
  await sendBridge(page, { type: 'settings', partial: { tashkeel: mode } });
  await expect.poll(async () => (await latestPosition(page))?.page, { timeout: 20_000 }).not.toBe(0);
  return exactPosition(page);
}

/**
 * The settled position once every chapter has been re-measured for the current layout.
 * A total is only comparable across modes when it is exact — an estimate is a coarse
 * word-count projection that is deliberately pinned, so it cannot answer "did this text
 * need the same room?".
 */
async function exactPosition(page: Page): Promise<Position> {
  let settled = await settledPosition(page);
  for (let i = 0; i < 40 && settled.estimated; i++) {
    await page.waitForTimeout(250);
    settled = await settledPosition(page);
  }
  return settled;
}

/** The laid-out width of the chapter that holds `blockId` — its real column geometry. */
async function chapterScrollWidth(page: Page, blockId: string): Promise<number> {
  return page.evaluate(
    (id) => document.querySelector<HTMLElement>(`[data-block-id="${id}"]`)?.closest<HTMLElement>('.chapter')
      ?.scrollWidth ?? -1,
    blockId,
  );
}

/** Characters in the chapter that holds `blockId`, i.e. the text the layout was measured on. */
async function chapterTextLength(page: Page, blockId: string): Promise<number> {
  return page.evaluate(
    (id) =>
      document.querySelector<HTMLElement>(`[data-block-id="${id}"]`)?.closest<HTMLElement>('.chapter')
        ?.textContent?.length ?? -1,
    blockId,
  );
}

/** The rendered text of one block, exactly as the reader sees it. */
async function renderedBlockText(page: Page, blockId: string): Promise<string> {
  return page.evaluate(
    (id) => document.querySelector(`[data-block-id="${id}"]`)?.textContent ?? '',
    blockId,
  );
}

/**
 * Independent geometry probe: the reading column (0-based) of the character at
 * `displayOffset` of `blockId`, computed with the browser's own layout.
 */
async function columnOfDisplayOffset(
  page: Page,
  blockId: string,
  displayOffset: number,
): Promise<number> {
  return page.evaluate(
    ({ id, offset }) => {
      const block = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
      const chapter = block?.closest<HTMLElement>('.chapter');
      if (!block || !chapter) return -1;
      const pageWidth =
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--page-width'),
        ) || 1;
      const dir = chapter.getAttribute('dir') === 'ltr' ? 'ltr' : 'rtl';

      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let remaining = Math.max(0, offset);
      let node = walker.nextNode() as Text | null;
      let target: { node: Text; offset: number } | null = null;
      while (node) {
        if (remaining < node.data.length) {
          target = { node, offset: remaining };
          break;
        }
        remaining -= node.data.length;
        node = walker.nextNode() as Text | null;
      }
      if (!target) return -10;

      const range = document.createRange();
      range.setStart(target.node, target.offset);
      range.setEnd(target.node, Math.min(target.node.data.length, target.offset + 1));
      const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
      const chRect = chapter.getBoundingClientRect();
      const x =
        dir === 'ltr'
          ? rect.left - chRect.left + 1
          : chRect.right - rect.right + 1;
      return Math.max(0, Math.floor(x / pageWidth));
    },
    { id: blockId, offset: displayOffset },
  );
}

/**
 * The first displayed character of a block that the browser lays out on `column`
 * (0-based). Binary search over the *displayed* text, same question the engine answers
 * internally with `getCharacterRect`.
 */
async function firstDisplayOffsetOnColumn(
  page: Page,
  blockId: string,
  column: number,
): Promise<number> {
  return page.evaluate(
    ({ id, targetColumn }) => {
      const block = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
      const chapter = block?.closest<HTMLElement>('.chapter');
      if (!block || !chapter) return -1;
      const pageWidth =
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--page-width'),
        ) || 1;
      const dir = chapter.getAttribute('dir') === 'ltr' ? 'ltr' : 'rtl';
      const chRect = chapter.getBoundingClientRect();

      const nodes: Text[] = [];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode() as Text | null;
      while (node) {
        nodes.push(node);
        node = walker.nextNode() as Text | null;
      }
      const total = nodes.reduce((sum, n) => sum + n.data.length, 0);
      if (total === 0) return 0;

      const columnAt = (offset: number): number => {
        let remaining = Math.max(0, Math.min(total - 1, offset));
        for (const candidate of nodes) {
          if (remaining < candidate.data.length) {
            const range = document.createRange();
            range.setStart(candidate, remaining);
            range.setEnd(candidate, Math.min(candidate.data.length, remaining + 1));
            const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
            const x =
              dir === 'ltr' ? rect.left - chRect.left + 1 : chRect.right - rect.right + 1;
            return Math.max(0, Math.floor(x / pageWidth));
          }
          remaining -= candidate.data.length;
        }
        return 0;
      };

      let lo = 0;
      let hi = total - 1;
      let found = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (columnAt(mid) >= targetColumn) {
          found = mid;
          hi = mid - 1;
        } else {
          lo = mid + 1;
        }
      }
      return found;
    },
    { id: blockId, targetColumn: column },
  );
}

/** Blocks that actually carry diacritics — the ones a `<span>`-per-word hack would break. */
async function stageHtml(page: Page): Promise<string> {
  return page.evaluate(() => document.getElementById('reader-track')?.innerHTML ?? '');
}

function countMarks(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code >= 0x064b && code <= 0x065f) || code === 0x0670) count++;
  }
  return count;
}

function countChar(text: string, code: string): number {
  let count = 0;
  for (const ch of text) if (ch === code) count++;
  return count;
}

/**
 * The element structure of an HTML fragment — every tag with its attributes, every character
 * of text dropped. Two fragments with the same structure differ only in their text, which is
 * precisely the only thing a tashkeel mode is allowed to change.
 */
function tagsOf(html: string): string {
  return (html.match(/<[^>]+>/g) ?? []).join('|');
}

test.describe('F18 — tashkeel modes', () => {
  test('(f18-1) switching the mode keeps the anchor, and «بدون» paginates like stripped text', async ({
    page,
  }) => {
    test.setTimeout(360_000);
    await page.setViewportSize(PORTRAIT);
    await mountEngine(page);

    const book = buildBook([40, 40, 40]);
    await sendBridge(page, {
      type: 'load',
      book,
      fontBaseUrl: fontsDirUrl,
      settings: { disableAnimation: true, tashkeel: 'full' },
    });
    await expect.poll(async () => (await latestPosition(page))?.page, { timeout: 20_000 }).toBe(1);
    await sendBridge(page, { type: 'goto', chapterId: 'ch02' });
    await settledPosition(page);

    // A page whose top line begins *inside* a vocalised block. Its anchor therefore has a
    // real offset, and hiding the marks moves that same character to a much smaller
    // displayed offset — which is exactly what a raw DOM offset would get wrong.
    let anchor: Anchor | null = null;
    let atAnchor: Position | null = null;
    let originalText = '';
    for (let pageNumber = 2; pageNumber <= 10 && !anchor; pageNumber++) {
      await sendBridge(page, { type: 'goto', chapterId: 'ch02', page: pageNumber });
      const position = await settledPosition(page);
      if (position.chapterId !== 'ch02') break;
      if (position.chapterPage !== pageNumber) break; // the chapter ended before this page
      const original = await originalTextOfBlock(book, position.anchor.blockId);
      if (countMarks(original) < 40) continue;
      if (position.anchor.charOffset < 80) continue;
      if (
        displayOffsetForOriginalOffset(original, position.anchor.charOffset, 'none') >
        position.anchor.charOffset - 40
      ) {
        continue;
      }
      anchor = position.anchor;
      atAnchor = position;
      originalText = original;
    }
    expect(anchor, 'the fixture must contain a page that starts mid-block').toBeTruthy();
    const target = anchor!;
    const anchorBlockId = target.blockId;
    const anchorBlock = book.chapters
      .flatMap((chapter) => chapter.blocks)
      .find((b) => b.id === anchorBlockId);
    expect(anchorBlock, 'the anchor block must exist in the fixture').toBeTruthy();
    expect(countMarks(anchorBlock!.html), 'the block must be vocalised').toBeGreaterThan(40);

    // «كامل» on screen is the file's own text, already in original-text coordinates.
    expect(await renderedBlockText(page, anchorBlockId)).toBe(originalText);

    const full = await exactPosition(page);
    expect(full.anchor).toEqual(target);
    const fullPageCount = full.pageCount;
    const fullChapterPages = full.chapterPageCount;
    const fullBookPage = full.page;
    const fullChapterPage = full.chapterPage;
    const fullWidth = await chapterScrollWidth(page, anchorBlockId);
    const fullChars = await chapterTextLength(page, anchorBlockId);
    expect(fullChars).toBeGreaterThan(10_000);

    // ---------- «بدون» ----------
    const none = await setMode(page, 'none');
    expect(none.anchor, 'the anchor must not move when the marks are hidden').toEqual(target);
    expect(none.chapterId, 'a tashkeel change must never jump to another chapter').toBe('ch02');
    expect(none.estimated, 'every chapter must be measured again for the new text').toBe(false);

    const noneText = await renderedBlockText(page, anchorBlockId);
    expect(countMarks(noneText), 'no haraka may survive in «بدون»').toBe(0);
    expect(noneText, 'the displayed text is the pure strip of the original').toBe(
      stripTashkeel(originalText, 'none'),
    );
    expect(countChar(noneText, '\u0651'), 'shadda is a mark too — «بدون» hides it').toBe(0);

    // Why the page numbers may not move: the marks are combining characters, so they add
    // no advance width. The chapter is a third of its characters shorter and lays out in
    // exactly the same box — that is a property of the text, not of the engine, and it is
    // asserted here so the equality below is a measured consequence, not a guess.
    const noneChars = await chapterTextLength(page, anchorBlockId);
    expect(noneChars, 'the text really lost the marks').toBeLessThan(fullChars * 0.8);
    expect(await chapterScrollWidth(page, anchorBlockId), 'combining marks carry no advance width').toBe(
      fullWidth,
    );
    expect(none.pageCount, 'the same text width gives the same book length').toBe(fullPageCount);
    expect(none.chapterPageCount).toBe(fullChapterPages);

    // …and the page it reports is really the page the anchor's character sits on.
    const noneDisplayOffset = displayOffsetForOriginalOffset(originalText, target.charOffset, 'none');
    expect(noneDisplayOffset, 'the offsets must actually differ for a meaningful test').toBeLessThan(
      target.charOffset - 20,
    );
    expect(await columnOfDisplayOffset(page, anchorBlockId, noneDisplayOffset)).toBe(
      none.chapterPage - 1,
    );

    // The markup is untouched: no span inside the word, and the element structure is the
    // same one the parser produced — only the characters that must be hidden were dropped.
    expect(await stageHtml(page)).not.toContain('<span');
    const noneInnerHtml = await page.evaluate(
      (id) => document.querySelector(`[data-block-id="${id}"]`)?.innerHTML ?? '',
      anchorBlockId,
    );
    expect(noneInnerHtml).not.toContain('<span');
    expect(tagsOf(noneInnerHtml), 'the element structure must not change').toBe(
      tagsOf(anchorBlock!.html),
    );

    // ---------- «شدّة وتنوين بس» ----------
    const intermediate = await setMode(page, 'shadda-tanween');
    expect(intermediate.anchor).toEqual(target);
    expect(intermediate.chapterId).toBe('ch02');
    expect(intermediate.estimated).toBe(false);
    const intermediateText = await renderedBlockText(page, anchorBlockId);
    expect(intermediateText).toBe(stripTashkeel(originalText, 'shadda-tanween'));
    expect(countChar(intermediateText, '\u0651')).toBe(countChar(originalText, '\u0651'));
    expect(countChar(intermediateText, '\u0651')).toBeGreaterThan(0);
    expect(countChar(intermediateText, '\u064e'), 'fatha is hidden').toBe(0);
    expect(countChar(intermediateText, '\u0650'), 'kasra is hidden').toBe(0);
    expect(countChar(intermediateText, '\u0652'), 'sukun is hidden').toBe(0);
    expect(
      await chapterTextLength(page, anchorBlockId),
      'the intermediate mode sits between the other two',
    ).toBeGreaterThan(noneChars);
    expect(intermediate.pageCount).toBe(fullPageCount);
    expect(
      await columnOfDisplayOffset(
        page,
        anchorBlockId,
        displayOffsetForOriginalOffset(originalText, target.charOffset, 'shadda-tanween'),
      ),
    ).toBe(intermediate.chapterPage - 1);

    // ---------- back to «كامل» ----------
    const restored = await setMode(page, 'full');
    expect(restored.anchor).toEqual(target);
    expect(restored.pageCount, 'the original layout must come back exactly').toBe(fullPageCount);
    expect(restored.chapterPageCount).toBe(fullChapterPages);
    expect(restored.page).toBe(fullBookPage);
    expect(restored.chapterPage).toBe(fullChapterPage);
    // Lossless: the file's own text — and markup — is back on screen.
    expect(await renderedBlockText(page, anchorBlockId)).toBe(originalText);
    expect(
      await page.evaluate(
        (id) => document.querySelector(`[data-block-id="${id}"]`)?.innerHTML ?? '',
        anchorBlockId,
      ),
    ).toBe(anchorBlock!.html);

    // ---------- the control: the same book with the marks removed from the file ----------
    // If «بدون» is really the stripped text and nothing else, then the book the engine gets
    // when the marks were never in the file must paginate identically, and the character
    // the reader was anchored on must land on the same page of that book.
    await sendBridge(page, {
      type: 'load',
      book: buildBook([40, 40, 40], 'none'),
      fontBaseUrl: fontsDirUrl,
      settings: { disableAnimation: true },
    });
    await expect.poll(async () => (await latestPosition(page))?.page, { timeout: 20_000 }).toBe(1);
    await sendBridge(page, { type: 'goto', chapterId: 'ch02' });
    await settledPosition(page);
    expect(await chapterScrollWidth(page, anchorBlockId)).toBe(fullWidth);

    await sendBridge(page, {
      type: 'goto',
      anchor: { blockId: anchorBlockId, charOffset: noneDisplayOffset },
    });
    const control = await settledPosition(page);
    expect(control.chapterId).toBe('ch02');
    expect(control.pageCount, '«بدون» is the layout of the stripped text').toBe(none.pageCount);
    expect(control.chapterPageCount).toBe(none.chapterPageCount);
    expect(control.chapterPage, 'the same character sits on the same page of both books').toBe(
      none.chapterPage,
    );
  });

  test('(f18-2) a geometry capture reports original-text offsets, and nothing else changes', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(PORTRAIT);
    await mountEngine(page);

    const book = buildBook([40, 40, 40]);
    // A page in the middle of the second chapter: the page starts mid-block, which is
    // exactly where a display offset and an original offset disagree.
    await sendBridge(page, {
      type: 'load',
      book,
      fontBaseUrl: fontsDirUrl,
      settings: { disableAnimation: true, tashkeel: 'none' },
    });
    await expect.poll(async () => (await latestPosition(page))?.page, { timeout: 20_000 }).toBe(1);

    const toc = await latestTocStable(page);
    const chapterTwo = toc.chapters.find((c) => c.id === 'ch02');
    expect(chapterTwo, 'chapter 2 must be in the TOC').toBeTruthy();

    // 3rd page of the chapter: once «بدون» is on, the pages hold more text than «كامل».
    await sendBridge(page, { type: 'goto', page: chapterTwo!.startPage + 2 });
    const position = await settledPosition(page);
    expect(position.chapterId).toBe('ch02');
    expect(position.chapterPage).toBeGreaterThan(1);
    // `goto` cleared the remembered anchor, so this one was measured from the layout.
    const captured = position.anchor;
    expect(captured.blockId).toMatch(/^ch02_/);

    const displayed = await renderedBlockText(page, captured.blockId);
    const column = position.chapterPage - 1;
    const topDisplayOffset = await firstDisplayOffsetOnColumn(page, captured.blockId, column);
    expect(topDisplayOffset).toBeGreaterThan(0);

    const displayOffsetOfAnchor = displayOffsetForOriginalOffset(
      // The block's own text in the file. With «بدون» the DOM holds the stripped text, and
      // the mapping is invertible, so rebuilding the original from the display text is not
      // needed: compare against the expected original offset instead.
      await originalTextOfBlock(book, captured.blockId),
      captured.charOffset,
      'none',
    );

    // The engine reported the character the page starts on, expressed in *original*
    // coordinates: converting back gives the display offset the layout really starts at.
    expect(displayOffsetOfAnchor).toBe(topDisplayOffset);
    // …and that offset is larger than the display offset, which is the proof that the
    // anchor is not a raw DOM offset.
    expect(captured.charOffset).toBeGreaterThan(topDisplayOffset);
    expect(captured.charOffset).toBe(
      originalOffsetForDisplayOffset(
        await originalTextOfBlock(book, captured.blockId),
        topDisplayOffset,
        'none',
      ),
    );

    // No structural damage anywhere in the rendered stage, in any mode.
    for (const mode of ['full', 'shadda-tanween', 'none'] as const) {
      await setMode(page, mode);
      expect(await stageHtml(page)).not.toContain('<span');
    }

    // Page counts stay internally consistent: the TOC describes exactly the pages the
    // engine counts for the displayed text.
    const finalToc = await latestTocStable(page);
    const finalPosition = await settledPosition(page);
    const sum = finalToc.chapters.reduce((acc, c) => acc + c.pageCount, 0);
    expect(sum).toBe(finalPosition.pageCount);
  });
});

/** The block's text as the book file has it (the DOM may be showing a stripped version). */
async function originalTextOfBlock(book: Book, blockId: string): Promise<string> {
  for (const chapter of book.chapters) {
    const block = chapter.blocks.find((b) => b.id === blockId);
    if (block) {
      return block.html
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0*39;|&apos;/g, "'")
        .replace(/&amp;/g, '&');
    }
  }
  throw new Error(`block ${blockId} not found in the book`);
}
