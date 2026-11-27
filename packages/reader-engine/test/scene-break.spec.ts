import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook, type Book } from '../../book-format/src/index.js';
import type { RNToWebMessage, WebToRNMessage } from '../src/types.js';
import { pngDataUrl } from './support/png.js';

/**
 * P2 (QA r1) — Issue #47: an orphan scene break.
 *
 * `.block-break` could be pushed to the top of a fresh column on its own. `break-after: avoid`
 * keeps the *next* block with the break, but it cannot help when the block before the break
 * already fills the column (a figure capped to almost the page height): the column box has no
 * choice but to start a new column, and the reader turns to a page whose only ink is `✦ ✦ ✦`.
 * CSS has no "never break before this one if it would be alone", so the paginator collapses
 * such a break out of the flow while it measures the chapter.
 *
 * The sweep below measures with `getClientRects()` — a block split across columns has one rect
 * per column — and judges EACH column, not the page as a whole: on a page that keeps a
 * paragraph in one column, a break in the neighbouring column is still an orphan page.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readerHtmlUrl = pathToFileURL(path.resolve(__dirname, '../dist/reader.html')).href;

const ARABIC_PARA =
  'كَانَتِ الرِّيَاحُ تَهُبُّ بِهُدُوءٍ فَوْقَ الْمِينَاءِ الْقَدِيمِ، حَيْثُ تَرْتَطِمُ الْأَمْوَاجُ بِأَخْشَابِ الْمَرَاكِبِ وَيَتَأَمَّلُ سَلِيمٌ أَوْرَاقَ وَالِدِهِ الْمَكْتُوبَةَ بِعِنَايَةٍ وَدِقَّةٍ قَبْلَ سَنَوَاتٍ طَوِيلَةٍ فِي لَيْلَةٍ صَافِيَةٍ.';

/**
 * A figure whose intrinsic size is much taller than a column. The CSS height cap shrinks it to
 * `page height - padding - 24px`, which leaves no room for a following scene break in the same
 * column — the exact geometry that used to orphan the break.
 */
const COLUMN_FILLING_FIGURE = pngDataUrl(400, 1400);

/**
 * Chapters of growing length, each CLOSING on a scene break. Every chapter starts on a fresh
 * page, so the last break of some chapter is guaranteed to fall near a column boundary — the
 * exact place the orphan used to appear (the break gets pushed alone to the next column while
 * the preceding paragraph stays behind on the previous page).
 */
function buildTrailingBreakBook(chapters: number): Book {
  const lines = ['---', 'title: "فُصُولٌ تنتهي بمشهد"', 'lang: ar', 'dir: rtl', '---', ''];
  for (let c = 1; c <= chapters; c++) {
    lines.push(`# الْفَصْلُ رَقْمُ ${c}`, '');
    for (let p = 1; p <= c; p++) {
      lines.push(`${ARABIC_PARA} (${c}.${p})`, '');
    }
    lines.push('***', '');
  }
  return parseBook(lines.join('\n'), 'scene-break-trailing.md');
}

/**
 * A scene break after every paragraph, so half the column boundaries fall between a paragraph
 * and a break and the rest between a break and the next paragraph.
 */
function buildBreakHeavyBook(paragraphs: number): Book {
  const lines = ['---', 'title: "فَصْلٌ بِمَشَاهِدَ كَثِيرَةٍ"', 'lang: ar', 'dir: rtl', '---', ''];
  for (let p = 1; p <= paragraphs; p++) {
    lines.push(`${ARABIC_PARA} (${p})`, '', '***', '');
  }
  return parseBook(lines.join('\n'), 'scene-break-heavy.md');
}

/** A column-filling figure immediately followed by a break: the geometry from the bug report. */
function buildFigureBreakBook(): Book {
  const lines = [
    '---',
    'title: "مَشْهَدٌ بَعْدَ صُورَةٍ طَوِيلَةٍ"',
    'lang: ar',
    'dir: rtl',
    '---',
    '',
    '# الْفَصْلُ الْأَوَّلُ',
    '',
    `${ARABIC_PARA} (قبل الصورة)`,
    '',
    `![شكل طويل](${COLUMN_FILLING_FIGURE})`,
    '',
    '***',
    '',
    `${ARABIC_PARA} (بعد الفاصل)`,
    '',
    `${ARABIC_PARA} (بعد الفاصل ٢)`,
    '',
    `${ARABIC_PARA} (بعد الفاصل ٣)`,
  ];
  return parseBook(lines.join('\n'), 'scene-break-figure.md');
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

type Position = Extract<WebToRNMessage, { type: 'position' }>;

async function latestPosition(page: Page): Promise<Position | null> {
  return page.evaluate(() => {
    const msgs = (window as unknown as { __bridgeMessages: WebToRNMessage[] }).__bridgeMessages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m?.type === 'position') return m;
    }
    return null;
  });
}

/** Wait until the page map is exact, so the total we sweep is the reader's real total. */
async function exactPosition(page: Page): Promise<Position> {
  const deadline = Date.now() + 20_000;
  let last: Position | null = null;
  while (Date.now() < deadline) {
    const pos = await latestPosition(page);
    if (pos) {
      last = pos;
      if (!pos.estimated && pos.pageCount > 1) return pos;
    }
    await page.waitForTimeout(250);
  }
  if (last) return last;
  throw new Error('engine never reported a position');
}

type FragmentKind = 'break' | 'heading' | 'text';

/**
 * Every painted fragment of the visible chapter, grouped into its page column by horizontal
 * band. Returns one array of kinds per column, left to right.
 *
 * Deliberately `getClientRects()`: a column break splits a block into one rect per column, so
 * `getBoundingClientRect()` would report a paragraph on column 2 while the break sits alone on
 * column 3 and hide exactly the orphan this suite exists to catch.
 */
async function visibleColumns(page: Page): Promise<FragmentKind[][]> {
  return page.evaluate(() => {
    const stage = document.getElementById('reader-stage')!.getBoundingClientRect();
    const chapter = document.querySelector<HTMLElement>('.chapter[aria-hidden="false"]');
    if (!chapter) return [];
    const fragments: Array<{ kind: string; left: number; right: number }> = [];
    const nodes = chapter.querySelectorAll<HTMLElement>(
      '.chapter-title, .chapter-ornament, [data-block-id]',
    );
    for (const node of Array.from(nodes)) {
      const kind = node.classList.contains('block-break')
        ? 'break'
        : node.classList.contains('chapter-title') || node.classList.contains('chapter-ornament')
          ? 'heading'
          : 'text';
      const rects = node.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i]!;
        if (rect.width <= 0 || rect.height <= 0) continue;
        // Must actually overlap the visible column, not merely be mounted nearby.
        if (rect.right <= stage.left + 1 || rect.left >= stage.right - 1) continue;
        if (rect.bottom <= stage.top + 1 || rect.top >= stage.bottom - 1) continue;
        fragments.push({ kind, left: rect.left, right: rect.right });
      }
    }

    const columns: Array<{ left: number; right: number; kinds: string[] }> = [];
    for (const fragment of fragments) {
      let column = columns.find((candidate) => {
        const overlap =
          Math.min(candidate.right, fragment.right) - Math.max(candidate.left, fragment.left);
        return overlap > Math.min(candidate.right - candidate.left, fragment.right - fragment.left) * 0.5;
      });
      if (!column) {
        column = { left: fragment.left, right: fragment.right, kinds: [] };
        columns.push(column);
      }
      column.kinds.push(fragment.kind);
    }

    return columns.sort((a, b) => a.left - b.left).map((column) => column.kinds) as FragmentKind[][];
  });
}

/** Sweep every page and report columns whose only painted content is a scene break. */
async function sweepOrphanColumns(
  page: Page,
  pageCount: number,
): Promise<{ orphans: Array<{ page: number; column: number }>; breakColumns: number }> {
  const orphans: Array<{ page: number; column: number }> = [];
  let breakColumns = 0;

  for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
    if (pageNo > 1) {
      await sendBridge(page, { type: 'goto', page: pageNo });
      await expect
        .poll(async () => (await latestPosition(page))?.page ?? 0, { timeout: 10_000 })
        .toBe(pageNo);
    }
    // One frame for the transform/scroll to land before measuring.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );

    const columns = await visibleColumns(page);
    columns.forEach((kinds, index) => {
      if (!kinds.includes('break')) return;
      breakColumns += 1;
      // A column that shows nothing at all is a blank spread pad, not an orphan break.
      if (kinds.length > 0 && kinds.every((kind) => kind === 'break')) {
        orphans.push({ page: pageNo, column: index });
      }
    });
  }

  return { orphans, breakColumns };
}

test.describe('Scene break pagination (Issue #47)', () => {
  // The sweep visits every column of a multi-chapter book with a real reader turn per page, so
  // it is minutes of deliberate work on a loaded shared runner — not a hang.
  test.setTimeout(120_000);

  test('no column shows a scene break as its only visible element', async ({ page }) => {
    await mountEngine(page);
    await sendBridge(page, {
      type: 'load',
      book: buildBreakHeavyBook(70),
      settings: { disableAnimation: true, fontSize: 20, lineHeight: 1.95 },
    });

    const first = await exactPosition(page);
    expect(first.pageCount).toBeGreaterThan(2);

    const { orphans, breakColumns } = await sweepOrphanColumns(page, first.pageCount);
    // Sanity: the book really does paint breaks on pages, otherwise the sweep proves nothing.
    expect(breakColumns).toBeGreaterThan(0);
    expect(orphans).toEqual([]);
  });

  test('a chapter that ends on a scene break never gives that break its own page', async ({ page }) => {
    await mountEngine(page);
    await sendBridge(page, {
      type: 'load',
      book: buildTrailingBreakBook(36),
      settings: { disableAnimation: true, fontSize: 20, lineHeight: 1.95 },
    });

    const first = await exactPosition(page);
    expect(first.pageCount).toBeGreaterThan(10);

    const { orphans, breakColumns } = await sweepOrphanColumns(page, first.pageCount);
    expect(breakColumns).toBeGreaterThan(0);
    expect(orphans).toEqual([]);
  });

  test('a break after a column-filling figure does not get a page of its own', async ({ page }) => {
    await mountEngine(page);
    const before = await page.evaluate(
      () => (window as unknown as { __bridgeMessages: unknown[] }).__bridgeMessages.length,
    );
    await sendBridge(page, {
      type: 'load',
      book: buildFigureBreakBook(),
      settings: { disableAnimation: true, fontSize: 20, lineHeight: 1.95 },
    });

    // The figure changes the chapter height when it decodes, so wait for the paint proof and
    // then for a position reported *after* it — the page map we sweep must be the post-figure one.
    await page.waitForFunction(
      () =>
        (window as unknown as { __bridgeMessages: Array<{ type?: string }> }).__bridgeMessages.some(
          (m) => m?.type === 'image-rendered',
        ),
      undefined,
      { timeout: 20_000 },
    );
    const proofIndex = await page.evaluate(() => {
      const msgs = (window as unknown as { __bridgeMessages: unknown[] }).__bridgeMessages;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if ((msgs[i] as { type?: string })?.type === 'image-rendered') return i;
      }
      return msgs.length;
    });
    await expect
      .poll(
        () =>
          page.evaluate(
            (from) =>
              (window as unknown as { __bridgeMessages: Array<{ type?: string }> })
                .__bridgeMessages.slice(from)
                .some((m) => m?.type === 'position'),
            Math.max(proofIndex + 1, before),
          ),
        { timeout: 20_000 },
      )
      .toBe(true);

    const first = await exactPosition(page);
    expect(first.pageCount).toBeGreaterThan(1);

    const { orphans, breakColumns } = await sweepOrphanColumns(page, first.pageCount);
    expect(breakColumns).toBeGreaterThan(0);
    expect(orphans).toEqual([]);
  });
});
