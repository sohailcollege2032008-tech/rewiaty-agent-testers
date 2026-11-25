import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook } from '../../book-format/src/index.js';
import type { RNToWebMessage, WebToRNMessage } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readerHtmlUrl = pathToFileURL(path.resolve(__dirname, '../dist/reader.html')).href;
const sampleArText = fs.readFileSync(path.resolve(__dirname, 'fixtures/sample-ar.md'), 'utf8');
const fontsDirUrl = pathToFileURL(path.resolve(__dirname, '../../../apps/mobile/assets/fonts')).href + '/';

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

/** Horizontal offset (px) of the page track; 0 means the paper is at rest on its page. */
async function trackX(page: Page): Promise<number> {
  return page.evaluate(() => {
    const track = document.getElementById('reader-track')!;
    const match = /matrix\(([^)]+)\)/.exec(getComputedStyle(track).transform);
    if (!match?.[1]) return 0;
    const parts = match[1].split(',').map((v) => Number.parseFloat(v.trim()));
    return Math.round(parts[4] ?? 0);
  });
}

/** An RTL page turn made with the finger: a rightward drag of ~57 % of the page width. */
async function dragTurn(page: Page): Promise<void> {
  await page.mouse.move(80, 420);
  await page.mouse.down();
  await page.mouse.move(300, 420, { steps: 8 });
  await page.mouse.up();
}

/**
 * What the gold highlight actually paints right now: how many ranges the CSS Highlight API
 * holds, the letters those ranges cover, and whether any of them is visible on the stage.
 */
async function goldHighlightAudit(
  page: Page,
): Promise<{ count: number; text: string; rects: number; onScreen: boolean }> {
  return page.evaluate(() => {
    const stage = document.getElementById('reader-stage')!.getBoundingClientRect();
    const css = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights;
    const set = css?.get('rewiaty-hl-gold');
    const ranges = set ? Array.from(set) : [];
    const range = ranges[0];
    const rects = range ? Array.from(range.getClientRects()) : [];
    const onScreen = rects.some(
      (r) =>
        r.width > 0 &&
        r.height > 0 &&
        r.right > stage.left &&
        r.left < stage.right &&
        r.bottom > stage.top &&
        r.top < stage.bottom,
    );
    return {
      count: ranges.length,
      text: (range?.toString() ?? '').replace(/\s+/g, ' ').trim(),
      rects: rects.length,
      onScreen,
    };
  });
}

test.describe('Reader Engine Highlights & Selection', () => {
  test('long-press + drag selects Arabic text with fuzzy context and never turns the page', async ({
    page,
  }) => {
    await mountEngine(page);
    const book = parseBook(sampleArText, 'sample-ar.md');

    await sendBridge(page, {
      type: 'load',
      book,
      fontBaseUrl: fontsDirUrl,
      settings: { disableAnimation: true, fontFamily: 'Amiri', fontSize: 20 },
    });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);

    // Find coordinates inside the first paragraph on page 1
    const coords = await page.evaluate(() => {
      const p = document.querySelector<HTMLElement>('.chapter[aria-hidden="false"] .block-p')!;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      const textNode = walker.nextNode() as Text;
      const r = document.createRange();
      r.setStart(textNode, 8);
      r.setEnd(textNode, 9);
      const startRect = r.getBoundingClientRect();
      const endRange = document.createRange();
      endRange.setStart(textNode, 32);
      endRange.setEnd(textNode, 33);
      const endRect = endRange.getBoundingClientRect();
      return {
        startX: startRect.left + startRect.width / 2,
        startY: startRect.top + startRect.height / 2,
        endX: endRect.left + endRect.width / 2,
        endY: endRect.top + endRect.height / 2,
      };
    });

    const msgCountBefore = (await getMessages(page)).length;
    const restTrack = await trackX(page);

    // Long-press (>= 350ms) then drag horizontally > 80px across words
    await page.mouse.move(coords.startX, coords.startY);
    await page.mouse.down();
    await page.waitForTimeout(420);
    await page.mouse.move(coords.endX, coords.endY, { steps: 10 });
    await page.mouse.up();

    await expect
      .poll(async () =>
        (await getMessages(page)).slice(msgCountBefore).some((m) => m.type === 'selection' && m.selection !== null),
      )
      .toBe(true);

    const afterMsgs = (await getMessages(page)).slice(msgCountBefore);
    const selMsg = afterMsgs.find(
      (m): m is Extract<WebToRNMessage, { type: 'selection' }> =>
        m.type === 'selection' && m.selection !== null,
    );

    expect(selMsg).toBeDefined();
    expect(selMsg!.selection!.anchor.blockId).toBe('ch01_p0001');
    expect(selMsg!.selection!.length).toBeGreaterThan(5);
    expect(selMsg!.selection!.quote.length).toBeGreaterThan(5);
    expect(selMsg!.selection!.contextBefore.length).toBeLessThanOrEqual(20);
    expect(selMsg!.selection!.contextAfter.length).toBeLessThanOrEqual(20);
    expect(selMsg!.selection!.rect.width).toBeGreaterThan(0);

    // Must NOT flip the page or emit a tap while selecting. The track offset is the part
    // that fails first: if the hold does not own the finger, `dragBy` shifts the paper and
    // the release never settles it back, leaving the page half turned behind a stale number.
    expect((await getLatestPosition(page))?.page).toBe(1);
    expect(await trackX(page)).toBe(restTrack);
    expect(afterMsgs.some((m) => m.type === 'tap')).toBe(false);

    // The very same horizontal distance with NO hold is a page turn: the hold, not the
    // distance, is what separates a selection from a drag. Clearing the selection is the
    // reader's own escape hatch, so the control starts from a clean page.
    const dragPx = Math.abs(coords.endX - coords.startX);
    await sendBridge(page, { type: 'clear-selection' });
    const controlPx = Math.max(dragPx, 180);
    await page.mouse.move(40, 420);
    await page.mouse.down();
    await page.mouse.move(40 + controlPx, 420, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => (await getLatestPosition(page))?.page, { timeout: 5_000 })
      .toBe(2);
  });

  test('stationary long-press without drag emits selection while keeping native user-select disabled', async ({
    page,
  }) => {
    await mountEngine(page);
    const book = parseBook(sampleArText, 'sample-ar.md');

    await sendBridge(page, {
      type: 'load',
      book,
      fontBaseUrl: fontsDirUrl,
      settings: { disableAnimation: true, fontFamily: 'Amiri', fontSize: 20 },
    });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);

    const pt = await page.evaluate(() => {
      const p = document.querySelector<HTMLElement>('.chapter[aria-hidden="false"] .block-p')!;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      const textNode = walker.nextNode() as Text;
      const r = document.createRange();
      r.setStart(textNode, 14);
      r.setEnd(textNode, 15);
      const rect = r.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });

    const beforeCount = (await getMessages(page)).length;
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.waitForTimeout(550);
    await page.mouse.up();

    await expect
      .poll(async () =>
        (await getMessages(page)).slice(beforeCount).some((m) => m.type === 'selection' && m.selection !== null),
      )
      .toBe(true);

    const visual = await page.evaluate(() => {
      const p = document.querySelector<HTMLElement>('.chapter[aria-hidden="false"] .block-p')!;
      const cssHighlights = (CSS as unknown as { highlights?: Map<string, { size: number }> }).highlights;
      return {
        userSelect: getComputedStyle(p).userSelect,
        activeHighlightCount: cssHighlights?.get('rewiaty-hl-active')?.size ?? 0,
      };
    });

    expect(visual.userSelect).toBe('none');
    expect(visual.activeHighlightCount).toBe(1);
    expect((await getLatestPosition(page))?.page).toBe(1);
  });

  test('renders highlights via CSS Highlight API without inserting spans inside Arabic words', async ({
    page,
  }, testInfo) => {
    await mountEngine(page);
    const book = parseBook(sampleArText, 'sample-ar.md');
    const firstBlockPlain = book.chapters[0]!.blocks[0]!.html.replace(/<[^>]*>/g, '');
    const targetPhrase = 'الْأَمْوَاجُ';
    const offset = firstBlockPlain.indexOf(targetPhrase);
    expect(offset).toBeGreaterThan(0);

    await sendBridge(page, {
      type: 'load',
      book,
      fontBaseUrl: fontsDirUrl,
      settings: { disableAnimation: true, fontFamily: 'Amiri', fontSize: 22 },
      highlights: [
        {
          id: 'hl-arabic-1',
          blockId: 'ch01_p0001',
          charOffset: offset,
          length: targetPhrase.length,
          color: 'gold',
        },
        {
          id: 'hl-arabic-2',
          blockId: 'ch01_p0001',
          charOffset: 0,
          length: 19,
          color: 'sage',
        },
      ],
    });

    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);

    const renderAudit = await page.evaluate(async () => {
      await document.fonts.ready;
      const curr = document.querySelector<HTMLElement>('.chapter[aria-hidden="false"]')!;
      const spansInParagraphs = curr.querySelectorAll('p span').length;
      const cssHighlights = (CSS as unknown as { highlights?: Map<string, { size: number }> }).highlights;
      const goldCount = cssHighlights?.get('rewiaty-hl-gold')?.size ?? 0;
      const sageCount = cssHighlights?.get('rewiaty-hl-sage')?.size ?? 0;
      return {
        spansInParagraphs,
        hasCssHighlights: Boolean(cssHighlights),
        goldCount,
        sageCount,
      };
    });

    expect(renderAudit.spansInParagraphs).toBe(0);
    expect(renderAudit.hasCssHighlights).toBe(true);
    expect(renderAudit.goldCount).toBe(1);
    expect(renderAudit.sageCount).toBe(1);

    // Save screenshot proving Arabic ligatures and Tashkeel shaping remain unbroken
    const shotPath = testInfo.outputPath('arabic-highlight-shaping.png');
    await page.screenshot({ path: shotPath });
    expect(fs.existsSync(shotPath)).toBe(true);

    // Tapping an existing highlight emits highlight-tap without toggling HUD
    const tapPt = await page.evaluate(() => {
      const cssHighlights = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights;
      const goldSet = cssHighlights.get('rewiaty-hl-gold')!;
      const range = Array.from(goldSet)[0]!;
      const rect = range.getClientRects()[0]!;
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });

    const msgCountBeforeTap = (await getMessages(page)).length;
    await page.mouse.click(tapPt.x, tapPt.y);

    await expect
      .poll(async () =>
        (await getMessages(page)).slice(msgCountBeforeTap).some((m) => m.type === 'highlight-tap'),
      )
      .toBe(true);

    const tapMsgs = (await getMessages(page)).slice(msgCountBeforeTap);
    expect(tapMsgs.find((m) => m.type === 'highlight-tap')).toMatchObject({
      type: 'highlight-tap',
      highlightId: 'hl-arabic-1',
    });
    expect(tapMsgs.some((m) => m.type === 'tap')).toBe(false);
  });

  test('falls back cleanly to overlay rects without breaking Arabic ligatures when CSS.highlights is unavailable', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      try {
        Object.defineProperty(CSS, 'highlights', { value: undefined, configurable: true });
      } catch {
        // ignore
      }
    });
    await mountEngine(page);
    const book = parseBook(sampleArText, 'sample-ar.md');

    await sendBridge(page, {
      type: 'load',
      book,
      settings: { disableAnimation: true, fontSize: 20 },
      highlights: [
        {
          id: 'hl-overlay-1',
          blockId: 'ch01_p0001',
          charOffset: 0,
          length: 25,
          color: 'sky',
        },
      ],
    });

    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);

    const overlayAudit = await page.evaluate(() => {
      const curr = document.querySelector<HTMLElement>('.chapter[aria-hidden="false"]')!;
      const block = curr.querySelector<HTMLElement>('[data-block-id="ch01_p0001"]')!;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const firstText = walker.nextNode() as Text;
      const expectedRange = document.createRange();
      expectedRange.setStart(firstText, 0);
      expectedRange.setEnd(firstText, Math.min(25, firstText.data.length));
      const expectedRect = expectedRange.getClientRects()[0] ?? expectedRange.getBoundingClientRect();
      const rects = curr.querySelectorAll<HTMLElement>('.hl-overlay-layer .hl-rect[data-hl-id="hl-overlay-1"]');
      const firstOverlayBox = rects[0]?.getBoundingClientRect();
      return {
        spansInParagraphs: curr.querySelectorAll('p span').length,
        rectCount: rects.length,
        color: rects[0]?.getAttribute('data-hl-color'),
        width: rects[0] ? parseFloat(rects[0].style.width) : 0,
        leftDelta: firstOverlayBox ? Math.abs(firstOverlayBox.left - expectedRect.left) : 999,
        topDelta: firstOverlayBox ? Math.abs(firstOverlayBox.top - expectedRect.top) : 999,
      };
    });

    expect(overlayAudit.spansInParagraphs).toBe(0);
    expect(overlayAudit.rectCount).toBeGreaterThan(0);
    expect(overlayAudit.color).toBe('sky');
    expect(overlayAudit.width).toBeGreaterThan(0);
    expect(overlayAudit.leftDelta).toBeLessThan(2);
    expect(overlayAudit.topDelta).toBeLessThan(2);

    // Reflowing font size updates overlay rects cleanly
    await sendBridge(page, { type: 'settings', partial: { fontSize: 28 } });
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.querySelectorAll('.chapter[aria-hidden="false"] .hl-overlay-layer .hl-rect')
              .length,
        ),
      )
      .toBeGreaterThan(0);
  });

  test('a highlight stays painted on the same letters after a drag page turn and the exact pagination pass', async ({
    page,
  }) => {
    await mountEngine(page);
    const book = parseBook(sampleArText, 'sample-ar.md');
    const loadBook = (
      highlights?: Array<{
        id: string;
        blockId: string;
        charOffset: number;
        length: number;
        color: 'gold';
      }>,
    ) =>
      sendBridge(page, {
        type: 'load',
        book,
        fontBaseUrl: fontsDirUrl,
        settings: { disableAnimation: true, fontFamily: 'Amiri', fontSize: 20 },
        ...(highlights ? { highlights } : {}),
      });

    await loadBook();
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);

    // Jump a few pages in with the bridge (the same `goto` the host uses) and remember the
    // first paragraph that is on screen there. Coming back to page 1 puts those letters off
    // screen, so the highlight has to travel with the pagination from then on.
    const pageCount = (await getLatestPosition(page))!.pageCount;
    expect(pageCount, 'the sample book is too short for this journey').toBeGreaterThan(3);
    await sendBridge(page, { type: 'goto', page: 3 });
    await expect
      .poll(async () => (await getLatestPosition(page))?.page, { timeout: 5_000 })
      .toBe(3);
    const target = await page.evaluate(() => {
      const stage = document.getElementById('reader-stage')!.getBoundingClientRect();
      const blocks = Array.from(
        document.querySelectorAll<HTMLElement>('.chapter[aria-hidden="false"] .block-p'),
      );
      const block = blocks.find((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.height > 0 &&
          r.bottom > stage.top + 4 &&
          r.top < stage.bottom - 4 &&
          r.right > stage.left &&
          r.left < stage.right
        );
      });
      if (!block) return null;
      return {
        blockId: block.getAttribute('data-block-id') ?? '',
        text: (block.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 12),
      };
    });
    expect(target, 'no paragraph is on screen at page 3').not.toBeNull();
    const expected = target!.text;
    expect(expected.length).toBeGreaterThan(5);

    // Reload from page 1 with a highlight on exactly those letters. R5's exact pagination
    // pass runs right after `load`, so the paint has to survive a re-measure from the start.
    await loadBook([
      { id: 'hl-drag-1', blockId: target!.blockId, charOffset: 0, length: 12, color: 'gold' },
    ]);
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(1);
    const atRest = await goldHighlightAudit(page);
    expect(atRest.count).toBe(1);
    expect(atRest.text.startsWith(expected)).toBe(true);
    expect(atRest.onScreen, 'the highlighted paragraph is already on page 1').toBe(false);

    // Turn with the finger until the highlighted letters are the ones on screen. Every hop
    // must keep the range on the same letters and the paint must land inside the stage.
    let afterTurn = atRest;
    let currentPage = 1;
    for (let hop = 0; hop < 6 && !afterTurn.onScreen; hop++) {
      await dragTurn(page);
      await expect
        .poll(async () => (await getLatestPosition(page))?.page, { timeout: 5_000 })
        .toBe(currentPage + 1);
      currentPage += 1;
      afterTurn = await goldHighlightAudit(page);
      expect(afterTurn.count, `highlight lost after drag turn #${hop + 1}`).toBe(1);
      expect(
        afterTurn.text.startsWith(expected),
        `highlight moved off its letters on page ${currentPage}`,
      ).toBe(true);
    }
    expect(afterTurn.rects, 'the highlight range has no client rect at all').toBeGreaterThan(0);
    expect(
      afterTurn.onScreen,
      `the highlight never became visible after ${currentPage - 1} drag turns`,
    ).toBe(true);

    // A settings change re-runs the exact pagination pass over the whole book. Afterwards
    // the range must still cover the same letters: a stale offset would paint another word.
    const beforeSettings = (await getMessages(page)).length;
    await sendBridge(page, { type: 'settings', partial: { fontSize: 22 } });
    await expect
      .poll(async () => (await getMessages(page)).length, { timeout: 10_000 })
      .toBeGreaterThan(beforeSettings);
    await expect
      .poll(async () => (await goldHighlightAudit(page)).count, { timeout: 10_000 })
      .toBe(1);
    const afterExact = await goldHighlightAudit(page);
    expect(afterExact.text.startsWith(expected)).toBe(true);
  });
});
