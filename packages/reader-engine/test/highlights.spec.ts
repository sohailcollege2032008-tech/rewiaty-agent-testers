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

    // Must NOT flip the page or emit a tap while selecting
    expect((await getLatestPosition(page))?.page).toBe(1);
    expect(afterMsgs.some((m) => m.type === 'tap')).toBe(false);

    // Clear selection and verify quick swipe STILL turns the page normally in RTL (swipe right -> next)
    await sendBridge(page, { type: 'clear-selection' });
    await page.mouse.move(80, 420);
    await page.mouse.down();
    await page.mouse.move(260, 420, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(2);
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
});
