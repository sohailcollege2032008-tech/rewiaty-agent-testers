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

/**
 * The same 20,000-word fixture the engine suite uses (`samples/gen-long.mjs` scaled to one
 * huge chapter): a 50-word vocalised sentence repeated 420 times.
 */
function buildTwentyThousandWordChapterBook(): Book {
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
  return parseBook(lines.join('\n'), 'f18-20k.md');
}

type Position = Extract<WebToRNMessage, { type: 'position' }>;
type Toc = Extract<WebToRNMessage, { type: 'toc' }>;

interface IdleStubWindow {
  requestIdleCallback?: (cb: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void) => number;
  cancelIdleCallback?: (id: number) => void;
  __flushIdle?: () => boolean;
  __idlePending?: () => number;
}

/**
 * Make the engine's progressive mount deterministic: `requestIdleCallback` is replaced by a
 * queue that only the test drains, one callback at a time. The engine asks for idle work
 * right after `ready` (and on every settings change), so without this stub "did the chapter
 * really mount in batches?" would be a race against the browser's scheduler.
 *
 * Must be installed as an init script, before the reader page loads.
 */
async function installManualIdle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as IdleStubWindow;
    const queue: Array<{ id: number; cb: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void }> =
      [];
    let nextId = 1;
    win.requestIdleCallback = (cb) => {
      const id = nextId++;
      queue.push({ id, cb });
      return id;
    };
    win.cancelIdleCallback = (id) => {
      const index = queue.findIndex((entry) => entry.id === id);
      if (index >= 0) queue.splice(index, 1);
    };
    win.__flushIdle = () => {
      const entry = queue.shift();
      if (!entry) return false;
      entry.cb({ didTimeout: true, timeRemaining: () => 0 });
      return true;
    };
    win.__idlePending = () => queue.length;
  });
}

async function mountEngine(
  page: Page,
  options: { manualIdle?: boolean } = {},
): Promise<void> {
  if (options.manualIdle) await installManualIdle(page);
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

/** Wait until every chapter's page count is a real measurement, not a projection. */
async function waitUntilMeasured(page: Page, timeoutMs = 180_000): Promise<Position> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const position = await latestPosition(page);
    if (position && !position.estimated) return position;
    await page.waitForTimeout(200);
  }
  throw new Error('the page map never became exact');
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

/** Run ONE queued idle callback (the stub installed by {@link installManualIdle}). */
async function flushIdle(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as IdleStubWindow).__flushIdle?.() ?? false);
}

async function idlePending(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as IdleStubWindow).__idlePending?.() ?? 0);
}

/** Drain the manual idle queue: run callbacks until the engine stops asking for work. */
async function drainIdle(page: Page, limit = 80): Promise<number> {
  let ran = 0;
  while (ran < limit && (await flushIdle(page))) ran++;
  return ran;
}

type MountState = { chapterId: string; blocks: number; chars: number };

/** Every chapter currently in the DOM, with how much of it is mounted. */
async function mountedChapters(page: Page): Promise<MountState[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('#reader-track .chapter')).map((el) => ({
      chapterId: el.getAttribute('data-chapter-id') ?? '',
      blocks: el.querySelectorAll('[data-block-id]').length,
      chars: el.textContent?.length ?? 0,
    })),
  );
}

async function mountedBlocksOf(page: Page, chapterId: string): Promise<number> {
  const entry = (await mountedChapters(page)).find((c) => c.chapterId === chapterId);
  return entry?.blocks ?? 0;
}

/** The rendered text of every mounted block of one chapter, in document order. */
async function chapterBlockTexts(page: Page, chapterId: string): Promise<string[]> {
  return page.evaluate((id) => {
    const chapter = document.querySelector<HTMLElement>(`[data-chapter-id="${id}"]`);
    if (!chapter) return [];
    return Array.from(chapter.querySelectorAll<HTMLElement>('[data-block-id]')).map(
      (el) => el.textContent ?? '',
    );
  }, chapterId);
}

/** Per-block mismatches between the DOM and an expected list — a precise, char-level diff. */
async function blockTextMismatches(
  page: Page,
  chapterId: string,
  expected: string[],
): Promise<Array<{ index: number; actual: string; expected: string }>> {
  const actual = await chapterBlockTexts(page, chapterId);
  const mismatches: Array<{ index: number; actual: string; expected: string }> = [];
  const length = Math.max(actual.length, expected.length);
  for (let index = 0; index < length; index++) {
    if (actual[index] !== expected[index]) {
      mismatches.push({ index, actual: actual[index] ?? '<missing>', expected: expected[index] ?? '<missing>' });
    }
  }
  return mismatches;
}

/** The book's own text for every block of a chapter, exactly as the file has it. */
async function bookBlockTexts(book: Book, chapterId: string): Promise<string[]> {
  const chapter = book.chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new Error(`chapter ${chapterId} not found in the book`);
  const texts: string[] = [];
  for (const block of chapter.blocks) texts.push(await originalTextOfBlock(book, block.id));
  return texts;
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

  test('(f18-3) unmount → progressive remount applies the mode to every batch, and «كامل» restores the file', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    await page.setViewportSize(PORTRAIT);
    // Progressive mount is a browser-scheduler detail; the stub makes it deterministic so
    // "the chapter mounted in batches" is an observed fact, not a timing coincidence.
    await mountEngine(page, { manualIdle: true });

    const CHAPTER_PARAGRAPHS = 320; // ≈ 8,000 words: more than INITIAL_WORD_BUDGET (2,500)
    const book = buildBook([CHAPTER_PARAGRAPHS, 3, 3, 3, 3]);
    const expectedFull = await bookBlockTexts(book, 'ch01');
    expect(expectedFull.length, 'one block per paragraph').toBe(CHAPTER_PARAGRAPHS);
    const expectedNone = expectedFull.map((text) => stripTashkeel(text, 'none'));
    expect(countMarks(expectedFull.join('')), 'the fixture must be heavily vocalised').toBeGreaterThan(
      3000,
    );

    await sendBridge(page, {
      type: 'load',
      book,
      fontBaseUrl: fontsDirUrl,
      settings: { disableAnimation: true, tashkeel: 'none' },
    });
    await expect.poll(async () => (await latestPosition(page))?.page, { timeout: 20_000 }).toBe(1);
    await settledPosition(page);

    // ---------- progressive mount, first pass ----------
    const firstSlice = await mountedBlocksOf(page, 'ch01');
    expect(firstSlice, 'the initial slice must not be the whole chapter').toBeGreaterThan(0);
    expect(firstSlice, 'the initial slice must be partial').toBeLessThan(CHAPTER_PARAGRAPHS);

    // What is already on screen is already in «بدون» — the initial slice included.
    expect(await chapterBlockTexts(page, 'ch01')).toEqual(expectedNone.slice(0, firstSlice));
    expect(countMarks((await chapterBlockTexts(page, 'ch01')).join(''))).toBe(0);

    const series: number[] = [];
    for (let step = 0; step < 60; step++) {
      if (!(await flushIdle(page))) break;
      series.push(await mountedBlocksOf(page, 'ch01'));
    }
    expect(series.length, 'the chapter must mount in more than one idle batch').toBeGreaterThanOrEqual(2);
    expect(series.at(-1), 'progressive mount must finish the chapter').toBe(CHAPTER_PARAGRAPHS);
    const stillPartial = series.filter((count) => count < CHAPTER_PARAGRAPHS);
    for (let i = 1; i < stillPartial.length; i++) {
      expect(stillPartial[i]!, 'every batch must add blocks').toBeGreaterThan(stillPartial[i - 1]!);
    }
    expect(await idlePending(page), 'the idle queue must drain').toBe(0);

    // Every batch — the appended ones included — was written in the current mode.
    expect(await blockTextMismatches(page, 'ch01', expectedNone)).toEqual([]);

    // ---------- unmount a far chapter, then remount it ----------
    await sendBridge(page, { type: 'goto', chapterId: 'ch05' });
    await settledPosition(page);
    await drainIdle(page);
    const afterJump = (await mountedChapters(page)).map((entry) => entry.chapterId);
    expect(afterJump, 'the target chapter must be mounted').toContain('ch05');
    expect(afterJump, 'a far chapter must be unmounted when the reader jumps away').not.toContain('ch01');
    expect(
      await page.evaluate(() => document.querySelector('[data-chapter-id="ch01"]') !== null),
      'the evicted chapter element must be gone from the DOM',
    ).toBe(false);

    await sendBridge(page, { type: 'goto', chapterId: 'ch01' });
    await settledPosition(page);

    // The remount starts from a partial slice again — same budget, same slice.
    const remountSlice = await mountedBlocksOf(page, 'ch01');
    expect(remountSlice, 'a remount starts partial, exactly like the first load').toBe(firstSlice);
    const remountMounted = await chapterBlockTexts(page, 'ch01');
    expect(remountMounted.length).toBe(remountSlice);
    expect(remountMounted, 'the partially-mounted text is already stripped').toEqual(
      expectedNone.slice(0, remountSlice),
    );

    await drainIdle(page);
    expect(await mountedBlocksOf(page, 'ch01'), 'the remount must complete').toBe(CHAPTER_PARAGRAPHS);
    expect(await blockTextMismatches(page, 'ch01', expectedNone), '«بدون» after remount').toEqual([]);

    // ---------- back to «كامل»: the file's text, character by character ----------
    await sendBridge(page, { type: 'settings', partial: { tashkeel: 'full' } });
    await settledPosition(page);
    expect(
      await mountedBlocksOf(page, 'ch01'),
      'a mode switch must not unmount or remount the chapter',
    ).toBe(CHAPTER_PARAGRAPHS);
    expect(
      await blockTextMismatches(page, 'ch01', expectedFull),
      '«كامل» must give the book file back char by char',
    ).toEqual([]);

    // The whole chapter text, not just the blocks: the header plus every block, in order.
    const chapterText = await page.evaluate(
      () => document.querySelector<HTMLElement>('[data-chapter-id="ch01"]')?.textContent ?? '',
    );
    expect(chapterText.endsWith(expectedFull.join(''))).toBe(true);
  });

  test('(f18-4) switching the mode on a 20,000-word chapter is fast and never moves the anchor', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    await page.setViewportSize(PORTRAIT);
    await mountEngine(page);

    const book = buildTwentyThousandWordChapterBook();
    expect(book.chapters[0]!.wordCount).toBeGreaterThanOrEqual(20_000);
    const chapterBlockCount = book.chapters[0]!.blocks.length;
    const chapterWords = book.chapters[0]!.wordCount;

    await sendBridge(page, {
      type: 'load',
      book,
      fontBaseUrl: fontsDirUrl,
      settings: { disableAnimation: true, tashkeel: 'full' },
    });
    await expect.poll(async () => (await latestPosition(page))?.page, { timeout: 20_000 }).toBe(1);

    // A page deep inside the huge chapter that starts mid-block, so the anchor has a real
    // offset and a raw DOM offset would visibly disagree with the original-text one.
    let landed: Position | null = null;
    for (let pageNumber = 3; pageNumber <= 30 && !landed; pageNumber++) {
      await sendBridge(page, { type: 'goto', chapterId: 'ch01', page: pageNumber });
      const position = await settledPosition(page);
      if (position.chapterId !== 'ch01' || position.chapterPage !== pageNumber) continue;
      if (position.anchor.charOffset <= 40) continue;
      landed = position;
    }
    expect(landed, 'the 20k chapter must offer a mid-block page').toBeTruthy();
    const anchor = landed!.anchor;
    const anchorOriginal = await originalTextOfBlock(book, anchor.blockId);
    expect(countMarks(anchorOriginal), 'the anchor block must be vocalised').toBeGreaterThan(40);

    // Let the whole chapter be measured: the timings below must be about real numbers.
    const measured = await waitUntilMeasured(page);
    expect(measured.anchor, 'measuring the chapter must not move the anchor').toEqual(anchor);
    expect(await mountedBlocksOf(page, 'ch01'), 'the whole chapter is mounted now').toBe(
      chapterBlockCount,
    );
    const measuredPage = measured.page;
    const measuredChapterPage = measured.chapterPage;
    const measuredPageCount = measured.pageCount;

    // ---------- the timed switch: settings message → first position with clean text ----------
    const timing = await page.evaluate(() => {
      const win = window as unknown as {
        __bridgeMessages: Array<Record<string, unknown> & { type: string }>;
      };
      const hasMarks = (text: string) => /[\u064b-\u065f\u0670\u06d6-\u06ed]/.test(text);
      const start = performance.now();
      const beforePositions = win.__bridgeMessages.filter((m) => m.type === 'position').length;
      return new Promise<{ ms: number; position: Record<string, unknown> }>((resolve, reject) => {
        const deadline = start + 30_000;
        const tick = () => {
          const positions = win.__bridgeMessages.filter((m) => m.type === 'position');
          const chapter = document.querySelector<HTMLElement>('[data-chapter-id="ch01"]');
          if (positions.length > beforePositions && chapter && !hasMarks(chapter.textContent ?? '')) {
            resolve({ ms: performance.now() - start, position: positions[positions.length - 1]! });
            return;
          }
          if (performance.now() > deadline) {
            reject(new Error('the mode switch never produced a stripped position'));
            return;
          }
          requestAnimationFrame(tick);
        };
        window.postMessage(JSON.stringify({ type: 'settings', partial: { tashkeel: 'none' } }), '*');
        requestAnimationFrame(tick);
      });
    });

    console.log(
      `F18 timing — «بدون» on ${chapterWords} words / ${chapterBlockCount} blocks: ${timing.ms.toFixed(1)} ms`,
    );
    test.info().annotations.push({
      type: 'F18 timing',
      description: `${timing.ms.toFixed(1)} ms to switch «بدون» on a ${chapterWords}-word chapter (${chapterBlockCount} blocks)`,
    });
    expect(timing.ms, 'switching the mode must stay interactive').toBeLessThan(5000);

    const nonePosition = timing.position as unknown as Position;
    expect(nonePosition.anchor, 'the anchor must not move when the marks are hidden').toEqual(anchor);
    expect(nonePosition.chapterId, 'a tashkeel change must never jump to another chapter').toBe('ch01');
    // The diacritics are combining marks: zero advance width, so the page cannot change.
    expect(nonePosition.chapterPage, 'the anchor stays on the same page').toBe(measuredChapterPage);
    expect(nonePosition.page).toBe(measuredPage);

    expect(await renderedBlockText(page, anchor.blockId), '«بدون» on screen').toBe(
      stripTashkeel(anchorOriginal, 'none'),
    );
    expect(countMarks(await renderedBlockText(page, anchor.blockId))).toBe(0);

    // ---------- «شدّة وتنوين بس» ----------
    const intermediate = await setMode(page, 'shadda-tanween');
    expect(intermediate.anchor).toEqual(anchor);
    expect(intermediate.chapterId).toBe('ch01');
    expect(intermediate.chapterPage).toBe(measuredChapterPage);
    expect(await renderedBlockText(page, anchor.blockId)).toBe(
      stripTashkeel(anchorOriginal, 'shadda-tanween'),
    );

    // ---------- back to «كامل» ----------
    const restored = await setMode(page, 'full');
    expect(restored.anchor).toEqual(anchor);
    expect(restored.page, 'the original layout must come back exactly').toBe(measuredPage);
    expect(restored.chapterPage).toBe(measuredChapterPage);
    expect(restored.pageCount).toBe(measuredPageCount);
    expect(await renderedBlockText(page, anchor.blockId), '«كامل» must be lossless').toBe(
      anchorOriginal,
    );
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
