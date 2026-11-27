import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook, type Book } from '../../book-format/src/index.js';
import type { RNToWebMessage, WebToRNMessage } from '../src/types.js';

/**
 * Issue #44 — «ضياع مكان القراية والكتابة فوقه بصفر لو الـ anchor محفوظ في فصل فاضي».
 *
 * An empty chapter (a chapter with zero blocks) has no block to anchor to, so
 * `captureCurrentAnchor()` emits the chapter's own id as the anchor block id. Restoring a
 * book from that anchor used to fail (`setBook` only searched `ch.blocks`), silently
 * falling back to chapter 0 / page 1 / 0%, which the host then persisted over the real
 * reading position.
 *
 * The engine must now resolve that anchor back to the empty chapter — and keep doing so
 * when only the saved `chapterId` survives, or when the saved block id belongs to a block
 * that was edited/deleted from that chapter (chapter-id prefix).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readerHtmlUrl = pathToFileURL(path.resolve(__dirname, '../dist/reader.html')).href;

const ARABIC_PARA =
  'كَانَتِ الرِّيَاحُ تَهُبُّ بِهُدُوءٍ فَوْقَ الْمِينَاءِ الْقَدِيمِ، حَيْثُ تَرْتَطِمُ الْأَمْوَاجُ بِأَخْشَابِ الْمَرَاكِبِ وَيَتَأَمَّلُ سَلِيمٌ أَوْرَاقَ وَالِدِهِ الْمَكْتُوبَةَ بِعِنَايَةٍ وَدِقَّةٍ قَبْلَ سَنَوَاتٍ طَوِيلَةٍ فِي لَيْلَةٍ صَافِيَةٍ.';

/** Three chapters, the middle one deliberately heading-only (`blocks: []`). */
function buildEmptyChapterBook(): Book {
  const lines = [
    '---',
    'title: "حَالَاتُ الْحُدُودِ"',
    'author: "اختبار"',
    'lang: ar',
    'dir: rtl',
    '---',
    '',
    '# الْفَصْلُ الْأَوَّلُ',
    '',
    `${ARABIC_PARA} (1.1)`,
    '',
    '# فصل فارغ',
    '',
    '# الْفَصْلُ الثَّالِثُ',
    '',
    `${ARABIC_PARA} (3.1)`,
    '',
  ];
  return parseBook(lines.join('\n'), 'empty-chapter.md');
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

async function getLatestPosition(page: Page) {
  return page.evaluate(() => {
    const messages = (window as unknown as { __bridgeMessages: WebToRNMessage[] }).__bridgeMessages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.type === 'position') return m;
    }
    return null;
  });
}

/** Simulate the app being reopened: fresh document, fresh message buffer. */
async function reopen(page: Page): Promise<void> {
  await page.reload();
  await page.waitForSelector('#reader-stage');
}

test.describe('Issue #44 — empty-chapter anchor restore', () => {
  test('captures an empty chapter anchor and restores it from anchor, chapterId and a stale block id', async ({
    page,
  }) => {
    await mountEngine(page);
    const book = buildEmptyChapterBook();
    const emptyChapter = book.chapters[1]!;
    expect(emptyChapter.blocks).toEqual([]);

    await sendBridge(page, {
      type: 'load',
      book,
      settings: { disableAnimation: true },
    });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe('ch01');

    // Navigate to the empty chapter the way the TOC does.
    await sendBridge(page, { type: 'goto', chapterId: emptyChapter.id });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe(emptyChapter.id);

    const saved = (await getLatestPosition(page))!;
    // The only anchor an empty chapter can emit is its own id — this is the value that
    // the host writes to `.reader-state.json`.
    expect(saved.anchor).toEqual({ blockId: emptyChapter.id, charOffset: 0 });
    expect(saved.page).toBeGreaterThan(1);
    expect(saved.bookProgress).toBeGreaterThan(0);

    // (1) Reopen with the saved anchor: must come back to the empty chapter, not page 1.
    await reopen(page);
    await sendBridge(page, {
      type: 'load',
      book,
      anchor: saved.anchor,
      settings: { disableAnimation: true },
    });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe(emptyChapter.id);
    const restoredByAnchor = (await getLatestPosition(page))!;
    expect(restoredByAnchor.anchor.blockId).toBe(emptyChapter.id);
    expect(restoredByAnchor.page).toBeGreaterThan(1);
    expect(restoredByAnchor.bookProgress).toBeGreaterThan(0);

    // (2) Reopen with only the saved chapterId (anchor missing/lost).
    await reopen(page);
    await sendBridge(page, {
      type: 'load',
      book,
      chapterId: emptyChapter.id,
      settings: { disableAnimation: true },
    });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe(emptyChapter.id);
    const restoredByChapter = (await getLatestPosition(page))!;
    expect(restoredByChapter.page).toBeGreaterThan(1);
    expect(restoredByChapter.bookProgress).toBeGreaterThan(0);

    // (3) Reopen with a block id that used to exist in that chapter (chapter-id prefix):
    // the chapter was heading-only at save time, so this is a stale/deleted block.
    await reopen(page);
    await sendBridge(page, {
      type: 'load',
      book,
      anchor: { blockId: `${emptyChapter.id}_p0007`, charOffset: 3 },
      settings: { disableAnimation: true },
    });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe(emptyChapter.id);
    const restoredByStaleBlock = (await getLatestPosition(page))!;
    expect(restoredByStaleBlock.page).toBeGreaterThan(1);
    expect(restoredByStaleBlock.bookProgress).toBeGreaterThan(0);
  });

  test('goto(anchor) resolves an empty chapter anchor and a stale block id from that chapter', async ({
    page,
  }) => {
    await mountEngine(page);
    const book = buildEmptyChapterBook();
    const emptyChapter = book.chapters[1]!;

    await sendBridge(page, {
      type: 'load',
      book,
      settings: { disableAnimation: true },
    });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe('ch01');

    await sendBridge(page, { type: 'goto', anchor: { blockId: emptyChapter.id, charOffset: 0 } });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe(emptyChapter.id);
    const byChapterAnchor = (await getLatestPosition(page))!;
    expect(byChapterAnchor.page).toBeGreaterThan(1);
    expect(byChapterAnchor.bookProgress).toBeGreaterThan(0);

    // Back to the start, then jump with a stale block id from the empty chapter.
    await sendBridge(page, { type: 'goto', chapterId: 'ch01' });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe('ch01');

    await sendBridge(page, {
      type: 'goto',
      anchor: { blockId: `${emptyChapter.id}_p0009`, charOffset: 0 },
    });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe(emptyChapter.id);
    const byStaleBlock = (await getLatestPosition(page))!;
    expect(byStaleBlock.page).toBeGreaterThan(1);
    expect(byStaleBlock.bookProgress).toBeGreaterThan(0);
  });

  test('longest chapter-id prefix wins over a shorter prefix and over fallback chapterId (Codex P3)', async ({
    page,
  }) => {
    await mountEngine(page);
    const base = buildEmptyChapterBook();
    const book: Book = {
      ...base,
      chapters: [
        base.chapters[0]!,
        { id: 'ch02', title: 'الفصل الثاني', blocks: [], wordCount: 0, hash: 'h-ch02' },
        { id: 'ch02_part', title: 'الجزء الفرعي', blocks: [], wordCount: 0, hash: 'h-ch02-part' },
        base.chapters[2]!,
      ],
    };

    await sendBridge(page, {
      type: 'load',
      book,
      anchor: { blockId: 'ch02_part_p0007', charOffset: 0 },
      chapterId: 'ch02',
      settings: { disableAnimation: true },
    });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe('ch02_part');
  });
});
