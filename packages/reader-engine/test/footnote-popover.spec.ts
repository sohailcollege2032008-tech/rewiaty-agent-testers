import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook, type Book } from '../../book-format/src/index.js';
import type { RNToWebMessage, WebToRNMessage } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readerHtmlUrl = pathToFileURL(path.resolve(__dirname, '../dist/reader.html')).href;

/**
 * Regression cover for the footnote popover closing itself.
 *
 * Why this file exists: the engine opened the sheet on `pointerup`, and the `click` the
 * browser synthesises for the same tap was then hit-tested against the backdrop that had just
 * become visible. When the tapped reference sits above the sheet panel — anything in the top
 * ~55% of the page, which is most of it — that trailing click closed the sheet in the same
 * gesture. Device runs 45654469093, 45661209279 and 45668376498 all failed on exactly that.
 *
 * The tap below is a real touch (`touchscreen.tap`, a touch-capable context), not a synthetic
 * `element.click()`: the bug lives in the touch → pointerup → click sequence, so a DOM click
 * would never reproduce it.
 *
 * R5 (drag-tracking page turns) moved the reader to pointerdown/pointermove/pointerup, so the
 * same gesture path also has to prove the two neighbouring behaviours: a plain press on a
 * reference must not be counted as a page turn, and a real swipe that *starts* on a reference
 * must turn the page instead of opening the sheet.
 */
test.use({ hasTouch: true });

/** Filler words used to place the reference at a chosen height inside the first page. */
const FILLER_WORD = 'كَلِمَةٌ';
/** Movement (px) the engine uses to tell a drag from a tap (DRAG_START_PX in engine.ts). */
const DRAG_START_PX = 10;

function buildFootnoteBook(wordsBeforeRef: number, trailingParagraphs = 0): Book {
  const filler = Array.from({ length: wordsBeforeRef }, () => FILLER_WORD).join(' ');
  const refSentence =
    'هَذِهِ الْجُمْلَةُ فِيهَا حَاشِيَةٌ[^1] وَهِيَ تَكْمِلُ بَعْدَ الْمَرْجِعِ لِتَبْقَى عَائِمَةً فِي وَسَطِ الصَّفْحَةِ.';
  const tail = Array.from(
    { length: trailingParagraphs },
    (_, i) =>
      `فَقْرَةٌ رَقْمُ ${i + 1}: كَانَتِ الرِّيَاحُ تَهُبُّ بِهُدُوءٍ فَوْقَ الْمِينَاءِ الْقَدِيمِ، حَيْثُ تَرْتَطِمُ الْأَمْوَاجُ بِأَخْشَابِ الْمَرَاكِبِ وَيَتَأَمَّلُ سَلِيمٌ أَوْرَاقَ وَالِدِهِ الْمَكْتُوبَةَ بِعِنَايَةٍ.`,
  );
  const md = [
    '---',
    'title: "حَاشِيَةٌ فِي وَسَطِ الصَّفْحَةِ"',
    'lang: ar',
    'dir: rtl',
    '---',
    '',
    '# الْفَصْلُ الْأَوَّلُ',
    '',
    `${filler} ${refSentence}`.trim(),
    '',
    'جُمْلَةٌ أَخِيرَةٌ فِي الصَّفْحَةِ لِتَأْكِيدِ أَنَّ الْقَارِئَ فِي وَضْعِهِ الطَّبِيعِيِّ.',
    '',
    ...tail.flatMap((p) => [p, '']),
    '[^1]: نَصُّ الْحَاشِيَةِ الَّذِي يَجِبُ أَنْ يَظْهَرَ فِي الْبُطَاقَةِ وَلَا يَخْتَفِي.',
    '',
  ];
  return parseBook(md.join('\n'), 'footnote-mid-page.md');
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

async function messageCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __bridgeMessages: unknown[] }).__bridgeMessages.length,
  );
}

async function loadBook(page: Page, book: Book, sinceMessage: number): Promise<void> {
  const msg: RNToWebMessage = {
    type: 'load',
    book,
    settings: { disableAnimation: true, fontSize: 20, lineHeight: 1.95 },
  };
  await page.evaluate((payload) => {
    window.postMessage(JSON.stringify(payload), '*');
  }, msg);
  // Wait for the position belonging to THIS load, not one left over from a previous layout.
  await expect
    .poll(
      async () =>
        page.evaluate(
          (from) =>
            (window as unknown as { __bridgeMessages: Array<{ type?: string }> })
              .__bridgeMessages.slice(from)
              .some((m) => m?.type === 'position'),
          sinceMessage,
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
}

/** The page number the reader last reported, so a gesture can be checked against it. */
async function latestPage(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const msgs = (
      window as unknown as { __bridgeMessages: Array<{ type?: string; page?: number }> }
    ).__bridgeMessages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i];
      if (msg?.type === 'position' && typeof msg.page === 'number') return msg.page;
    }
    return null;
  });
}

interface RefGeometry {
  x: number;
  y: number;
  viewportWidth: number;
  viewportHeight: number;
  ratio: number;
}

async function measureRef(page: Page): Promise<RefGeometry | null> {
  return page.evaluate(() => {
    const link = document.querySelector<HTMLElement>('sup.fn-ref a');
    if (!link) return null;
    const rect = link.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    // Off-page (the paginator moves whole pages with a transform): not usable for this test.
    if (rect.width <= 0 || rect.height <= 0) return null;
    if (rect.top < 0 || rect.bottom > viewportHeight) return null;
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      viewportWidth,
      viewportHeight,
      ratio: (rect.y + rect.height / 2) / viewportHeight,
    };
  });
}

/**
 * Place the footnote reference in the band the bug needs: above the bottom-sheet panel (which
 * never starts higher than 55% of the viewport) and below the very top of the page, so the tap
 * is an ordinary mid-page tap on the text. Sizes are searched instead of hard-coded because the
 * Arabic fallback font differs between the CI runner and a dev box.
 */
async function placeRefMidPage(page: Page, trailingParagraphs = 0): Promise<RefGeometry> {
  const candidates = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
  const measured: Array<{ words: number; ratio: number }> = [];
  let best: RefGeometry | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const words of candidates) {
    const before = await messageCount(page);
    await loadBook(page, buildFootnoteBook(words, trailingParagraphs), before);
    const geometry = await measureRef(page);
    if (!geometry) continue;
    measured.push({ words, ratio: geometry.ratio });
    const distance = Math.abs(geometry.ratio - 0.38);
    if (geometry.ratio >= 0.3 && geometry.ratio <= 0.45) return geometry;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = geometry;
    }
  }

  if (best) return best;
  throw new Error(
    `could not place the footnote reference on the first page; measured ${JSON.stringify(measured)}`,
  );
}

/**
 * A horizontal gesture that starts on the footnote reference itself, dispatched as real
 * pointer events on the link (they bubble to the reader root, which owns the gesture).
 * `steps` pointermoves are spread evenly over `durationMs`.
 */
async function gestureOnRef(
  page: Page,
  ref: RefGeometry,
  distancePx: number,
  durationMs: number,
): Promise<void> {
  await page.evaluate(
    async ({ x, y, distancePx, durationMs }) => {
      const link = document.querySelector<HTMLElement>('sup.fn-ref a');
      if (!link) throw new Error('footnote reference vanished before the gesture');
      const steps = Math.max(3, Math.round(durationMs / 16));
      const fire = (type: string, clientX: number) => {
        link.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 11,
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
      for (let i = 1; i <= steps; i++) {
        await new Promise((resolve) => setTimeout(resolve, durationMs / steps));
        fire('pointermove', x + (distancePx * i) / steps);
      }
      fire('pointerup', x + distancePx);
    },
    { x: ref.x, y: ref.y, distancePx, durationMs },
  );
}

test.describe('Footnote popover', () => {
  test('a mid-page footnote reference opens the sheet and the same tap does not close it', async ({
    page,
  }) => {
    await mountEngine(page);
    const ref = await placeRefMidPage(page);
    console.log(
      `footnote ref placed at ${(ref.ratio * 100).toFixed(1)}% of the viewport (${Math.round(ref.y)}px of ${ref.viewportHeight})`,
    );

    // The tap must land above the sheet panel, otherwise the backdrop is never under the
    // finger and the regression this test guards could not happen.
    expect(ref.ratio).toBeGreaterThanOrEqual(0.3);
    expect(ref.ratio).toBeLessThanOrEqual(0.45);

    const pageBefore = await latestPage(page);

    // A real touch: touchStart/touchEnd, then the browser's own compatibility click.
    await page.touchscreen.tap(ref.x, ref.y);

    const backdrop = page.locator('#footnote-backdrop');
    await expect(backdrop).toBeVisible();
    await expect(page.locator('#footnote-title')).toHaveText('حاشية [1]');
    await expect(page.locator('#footnote-body')).toContainText('نَصُّ الْحَاشِيَةِ');

    // The synthesised click is dispatched after the sheet is on screen; give it room to land
    // and prove it did not take the sheet down with it.
    await page.waitForTimeout(400);
    await expect(backdrop).toBeVisible();

    // A press on a reference is a tap, not a page turn: the page number must not move.
    expect(await latestPage(page)).toBe(pageBefore);

    // And a deliberate tap on the backdrop is still a dismiss — the fix must not swallow it.
    await page.touchscreen.tap(ref.viewportWidth / 2, ref.viewportHeight * 0.12);
    await expect(backdrop).toBeHidden();
  });

  test('a wobble smaller than the drag threshold is still a tap on the reference', async ({ page }) => {
    await mountEngine(page);
    const ref = await placeRefMidPage(page);
    const pageBefore = await latestPage(page);

    // 6 px each way: a thumb that is not perfectly still. Under DRAG_START_PX (10 px) the
    // gesture must stay a tap — open the sheet, leave the page alone.
    await gestureOnRef(page, ref, 6, 120);

    const backdrop = page.locator('#footnote-backdrop');
    await expect(backdrop).toBeVisible();
    await page.waitForTimeout(400);
    await expect(backdrop).toBeVisible();
    expect(await latestPage(page)).toBe(pageBefore);
  });

  test('a swipe that starts on the reference turns the page instead of opening the sheet', async ({
    page,
  }) => {
    await mountEngine(page);
    // Enough trailing text that a forward turn has somewhere to go.
    const ref = await placeRefMidPage(page, 40);
    const pageBefore = await latestPage(page);
    expect(pageBefore).not.toBeNull();

    // RTL: rightward advances. 35% of the width over 500 ms is the deliberate-drag shape the
    // R5 suite uses, so it is a turn, not a nudge.
    await gestureOnRef(page, ref, ref.viewportWidth * 0.35, 500);

    const backdrop = page.locator('#footnote-backdrop');
    await expect(backdrop).toBeHidden();
    await expect
      .poll(async () => latestPage(page), { timeout: 5_000 })
      .toBe((pageBefore as number) + 1);
  });
});
