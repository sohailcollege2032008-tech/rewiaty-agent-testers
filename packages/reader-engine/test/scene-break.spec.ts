import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook, type Book } from '../../book-format/src/index.js';
import type { RNToWebMessage, WebToRNMessage } from '../src/types.js';

/**
 * P2 (QA r1) — Issue #47: an orphan scene break.
 *
 * `.block-break` could be pushed to the top of a fresh column on its own (`break-after` was
 * not avoided), so a `✦ ✦ ✦` that happened to sit near a column boundary produced a page whose
 * only visible element was the scene break. The CSS now keeps the break inside its column and
 * with its neighbours. This spec sweeps every page of a break-heavy chapter and asserts no
 * page is break-only.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readerHtmlUrl = pathToFileURL(path.resolve(__dirname, '../dist/reader.html')).href;

const ARABIC_PARA =
  'كَانَتِ الرِّيَاحُ تَهُبُّ بِهُدُوءٍ فَوْقَ الْمِينَاءِ الْقَدِيمِ، حَيْثُ تَرْتَطِمُ الْأَمْوَاجُ بِأَخْشَابِ الْمَرَاكِبِ وَيَتَأَمَّلُ سَلِيمٌ أَوْرَاقَ وَالِدِهِ الْمَكْتُوبَةَ بِعِنَايَةٍ وَدِقَّةٍ قَبْلَ سَنَوَاتٍ طَوِيلَةٍ فِي لَيْلَةٍ صَافِيَةٍ.';

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

type VisibleElement = { kind: string; text: string };

/**
 * Elements actually painted inside the stage on the current page. Chapter titles count as
 * content: a page that shows only a title is fine, a page that shows only `.block-break` is not.
 */
async function visiblePageElements(page: Page): Promise<VisibleElement[]> {
  return page.evaluate(() => {
    const stage = document.getElementById('reader-stage')!.getBoundingClientRect();
    const chapter = document.querySelector<HTMLElement>('.chapter[aria-hidden="false"]');
    if (!chapter) return [];
    const nodes = Array.from(
      chapter.querySelectorAll<HTMLElement>(
        '.chapter-title, .chapter-ornament, [data-block-id]',
      ),
    );
    const out: Array<{ kind: string; text: string }> = [];
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      // Must actually overlap the visible column, not merely be mounted nearby.
      if (rect.right <= stage.left + 1 || rect.left >= stage.right - 1) continue;
      if (rect.bottom <= stage.top + 1 || rect.top >= stage.bottom - 1) continue;
      const kind = node.classList.contains('block-break')
        ? 'break'
        : node.classList.contains('chapter-title') || node.classList.contains('chapter-ornament')
          ? 'heading'
          : 'text';
      out.push({ kind, text: (node.textContent ?? '').slice(0, 24) });
    }
    return out;
  });
}

test.describe('Scene break pagination (Issue #47)', () => {
  test('no page shows a scene break as its only visible element', async ({ page }) => {
    await mountEngine(page);
    await sendBridge(page, {
      type: 'load',
      book: buildBreakHeavyBook(70),
      settings: { disableAnimation: true, fontSize: 20, lineHeight: 1.95 },
    });

    const first = await exactPosition(page);
    expect(first.pageCount).toBeGreaterThan(2);

    const orphans: Array<{ page: number; visible: VisibleElement[] }> = [];
    const breakPages: number[] = [];

    for (let pageNo = 1; pageNo <= first.pageCount; pageNo++) {
      if (pageNo > 1) {
        await sendBridge(page, { type: 'goto', page: pageNo });
        await expect
          .poll(async () => (await latestPosition(page))?.page ?? 0, { timeout: 10_000 })
          .toBe(pageNo);
      }
      // One frame for the transform/scroll to land before measuring.
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

      const visible = await visiblePageElements(page);
      if (visible.some((v) => v.kind === 'break')) breakPages.push(pageNo);
      // A page that shows nothing at all is a blank spread pad, not an orphan break.
      if (visible.length > 0 && visible.every((v) => v.kind === 'break')) {
        orphans.push({ page: pageNo, visible });
      }
    }

    // Sanity: the book really does paint breaks on pages, otherwise the sweep proves nothing.
    expect(breakPages.length).toBeGreaterThan(0);
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

    const orphans: Array<{ page: number; visible: VisibleElement[] }> = [];
    let breakPages = 0;

    for (let pageNo = 1; pageNo <= first.pageCount; pageNo++) {
      if (pageNo > 1) {
        await sendBridge(page, { type: 'goto', page: pageNo });
        await expect
          .poll(async () => (await latestPosition(page))?.page ?? 0, { timeout: 10_000 })
          .toBe(pageNo);
      }
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

      const visible = await visiblePageElements(page);
      if (visible.some((v) => v.kind === 'break')) breakPages += 1;
      if (visible.length > 0 && visible.every((v) => v.kind === 'break')) {
        orphans.push({ page: pageNo, visible });
      }
    }

    expect(breakPages).toBeGreaterThan(0);
    expect(orphans).toEqual([]);
  });
});
