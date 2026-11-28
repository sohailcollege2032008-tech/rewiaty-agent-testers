import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook, type Book } from '../../book-format/src/index.js';
import type {
  RNToWebMessage,
  ReaderSettings,
  ReadingFocusMode,
  WebToRNMessage,
} from '../src/types.js';
import { contrastRatio } from '../src/types.js';

/**
 * F33 — مسطرة القراية ووضع التركيز: قبول أعمى من الـ spec.
 *
 * القاعدة اللي بيتحدد بيها «الفقرة الحالية» أو موضع المسطرة:
 * خط أفقي واحد عند ٤٠٪ من ارتفاع منطقة النص في الصفحة الظاهرة (أو من ارتفاع مساحة العرض في
 * وضع التمرير). الفقرة الحالية هي اللي الخط بيعدّي جواها؛ ولو وقع في المسافة بين فقرتين تبقى
 * أقرب فقرة. الحالات التلاتة:
 *  - إيقاف: الصفحة زي ما هي، مفيش كلاسات ولا خط.
 *  - تركيز الفقرة: الفقرة اللي على الخط بلون النص الكامل، والباقي بلون `muted` بتاع المظهر
 *    (واللي بيعدّي WCAG AA على نفس الورق، فالقراية تفضل ممكنة).
 *  - مسطرة التتبع: خط رفيع عند نفس الموضع، `pointer-events: none` فمش بيمنع اللمس/التظليل،
 *    وثابت في مكانه على الشاشة مع تقليب الصفحات والتمرير.
 *
 * والموضع بيتبعت للسير اللي فوق (RN) في رسالة `reading-focus` عشان الإعداد يبان إنه شغّال.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readerHtmlUrl = pathToFileURL(path.resolve(__dirname, '../dist/reader.html')).href;

const ARABIC_PARA =
  'كَانَتِ الرِّيَاحُ تَهُبُّ بِهُدُوءٍ فَوْقَ الْمِينَاءِ الْقَدِيمِ، حَيْثُ تَرْتَطِمُ الْأَمْوَاجُ بِأَخْشَابِ الْمَرَاكِبِ وَيَتَأَمَّلُ سَلِيمٌ أَوْرَاقَ وَالِدِهِ الْمَكْتُوبَةَ بِعِنَايَةٍ وَدِقَّةٍ قَبْلَ سَنَوَاتٍ طَوِيلَةٍ فِي لَيْلَةٍ صَافِيَةٍ.';

function buildBook(paragraphs: number): Book {
  const lines: string[] = ['---', 'title: "رِوَايَةُ التَّرْكِيزِ"', 'lang: ar', 'dir: rtl', '---', ''];
  lines.push('# الْفَصْلُ الْأَوَّلُ');
  lines.push('');
  for (let i = 1; i <= paragraphs; i++) {
    lines.push(`${ARABIC_PARA} (${i})`);
    lines.push('');
  }
  lines.push('# الْفَصْلُ الثَّانِي');
  lines.push('');
  for (let i = 1; i <= paragraphs; i++) {
    lines.push(`${ARABIC_PARA} (٢.${i})`);
    lines.push('');
  }
  return parseBook(lines.join('\n'), 'reading-focus.md');
}

type FocusMessage = { type: 'reading-focus' } & {
  mode: ReadingFocusMode;
  currentBlockId: string | null;
  currentIndex: number | null;
  blockCount: number;
  anchorY: number;
  anchorRatio: number;
};

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
  return page.evaluate(
    () => (window as unknown as { __bridgeMessages: WebToRNMessage[] }).__bridgeMessages,
  );
}

async function latestFocus(page: Page): Promise<FocusMessage | null> {
  const msgs = await getMessages(page);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.type === 'reading-focus') return m as unknown as FocusMessage;
  }
  return null;
}

async function waitForFocus(
  page: Page,
  predicate: (m: FocusMessage) => boolean = () => true,
): Promise<FocusMessage> {
  let last: FocusMessage | null = null;
  await expect
    .poll(
      async () => {
        const m = await latestFocus(page);
        if (!m) return false;
        last = m;
        return predicate(m);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return last as unknown as FocusMessage;
}

async function loadBook(
  page: Page,
  book: Book,
  settings: Partial<ReaderSettings> = {},
): Promise<void> {
  await sendBridge(page, {
    type: 'load',
    book,
    settings: { disableAnimation: true, readingFocus: 'off', ...settings },
  });
  await expect
    .poll(async () => (await getMessages(page)).some((m) => m.type === 'position'), {
      timeout: 30_000,
    })
    .toBe(true);
}

async function setFocus(page: Page, readingFocus: ReadingFocusMode): Promise<void> {
  await sendBridge(page, { type: 'settings', partial: { readingFocus } });
  await waitForFocus(page, (m) => m.mode === readingFocus);
}

type FocusDom = {
  attr: string | null;
  mode: ReadingFocusMode;
  current: Array<{ id: string; color: string; opacity: string }>;
  dimmed: Array<{ id: string; color: string; opacity: string }>;
  ruler: { visible: boolean; pointerEvents: string; top: number } | null;
  stage: { top: number; height: number; bottom: number };
  text: { color: string; bg: string };
  muted: string;
};

async function readFocusDom(page: Page): Promise<FocusDom> {
  return page.evaluate(() => {
    const root = document.getElementById('reader-root')!;
    const stage = document.getElementById('reader-stage')!;
    const stageRect = stage.getBoundingClientRect();
    const ruler = document.getElementById('reading-focus-ruler') as HTMLElement | null;
    const rulerRect = ruler?.getBoundingClientRect() ?? null;
    const rootStyle = getComputedStyle(document.documentElement);
    const collect = (selector: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector)).map((el) => ({
        id: el.getAttribute('data-block-id') ?? '',
        color: getComputedStyle(el).color,
        opacity: getComputedStyle(el).opacity,
      }));
    return {
      attr: root.getAttribute('data-reading-focus'),
      mode: (root.getAttribute('data-reading-focus') ?? 'off') as FocusDom['mode'],
      current: collect('.block-p.reading-focus-current'),
      dimmed: collect('.block-p.reading-focus-dim'),
      ruler: ruler
        ? {
            visible:
              getComputedStyle(ruler).display !== 'none' &&
              getComputedStyle(ruler).visibility !== 'hidden' &&
              rulerRect !== null &&
              rulerRect.height > 0,
            pointerEvents: getComputedStyle(ruler).pointerEvents,
            top: rulerRect?.top ?? -1,
          }
        : null,
      stage: { top: stageRect.top, height: stageRect.height, bottom: stageRect.bottom },
      text: {
        color: rootStyle.getPropertyValue('--text-color').trim(),
        bg: rootStyle.getPropertyValue('--bg-color').trim(),
      },
      muted: rootStyle.getPropertyValue('--muted-color').trim(),
    };
  });
}

/** CSS `rgb(...)` → `#rrggbb`, so computed colours can be compared with theme tokens. */
function rgbToHex(value: string): string {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return value.trim().toLowerCase();
  return `#${[match[1], match[2], match[3]]
    .map((part) => Number(part).toString(16).padStart(2, '0'))
    .join('')}`;
}

test.describe('F33 reading focus', () => {
  test.use({ hasTouch: true });

  test('(f1) off is the default: the page keeps its ink and no ruler is painted', async ({
    page,
  }) => {
    await mountEngine(page);
    await loadBook(page, buildBook(12));

    const dom = await readFocusDom(page);
    expect(dom.attr).toBe('off');
    expect(dom.current).toHaveLength(0);
    expect(dom.dimmed).toHaveLength(0);
    expect(dom.ruler?.visible ?? false).toBe(false);
  });

  test('(f2) paragraph focus highlights the paragraph on the reading line and dims the rest readably', async ({
    page,
  }) => {
    await mountEngine(page);
    await loadBook(page, buildBook(24));
    await setFocus(page, 'paragraph');
    await page.waitForTimeout(120);

    const dom = await readFocusDom(page);
    expect(dom.attr).toBe('paragraph');
    // Exactly one paragraph is the current one, and it is painted in full body ink.
    expect(dom.current).toHaveLength(1);
    expect(rgbToHex(dom.current[0]!.color)).toBe(rgbToHex(dom.text.color));
    // Everything else on that page is dimmed, and the dimmed ink is the theme's readable muted token.
    expect(dom.dimmed.length).toBeGreaterThan(0);
    for (const dim of dom.dimmed) {
      expect(rgbToHex(dim.color)).toBe(rgbToHex(dom.muted));
      expect(contrastRatio(rgbToHex(dim.color), rgbToHex(dom.text.bg))).toBeGreaterThanOrEqual(4.5);
      expect(dim.opacity).toBe('1');
    }
    // The current paragraph is the only one NOT dimmed.
    const dimmedIds = new Set(dom.dimmed.map((d) => d.id));
    expect(dimmedIds.has(dom.current[0]!.id)).toBe(false);

    const message = await waitForFocus(page, (m) => m.mode === 'paragraph');
    expect(message.currentBlockId).toBe(dom.current[0]!.id);
    expect(message.currentIndex).not.toBeNull();
    expect(message.blockCount).toBe(dom.current.length + dom.dimmed.length);
    // The reading line is inside the page's text area, around 40% of the page height.
    const ratio = (message.anchorY - dom.stage.top) / dom.stage.height;
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.5);
  });

  test('(f3) the focus follows the new page on every turn and never stays stale', async ({
    page,
  }) => {
    await mountEngine(page);
    await loadBook(page, buildBook(40));
    await setFocus(page, 'paragraph');
    await page.waitForTimeout(120);

    const before = await readFocusDom(page);
    expect(before.current).toHaveLength(1);
    const beforeId = before.current[0]!.id;

    for (let turn = 0; turn < 3; turn++) {
      await sendBridge(page, { type: 'next' });
      await page.waitForTimeout(140);
      const after = await readFocusDom(page);
      expect(after.current).toHaveLength(1);
      expect(after.dimmed.length).toBeGreaterThan(0);
      // The previous page's paragraph must not stay marked as current.
      expect(after.current[0]!.id).not.toBe(beforeId);
      // Still exactly one current paragraph per page and it is the only full-ink one.
      const dimmedIds = new Set(after.dimmed.map((d) => d.id));
      expect(dimmedIds.has(after.current[0]!.id)).toBe(false);
    }
  });

  test('(f4) ruler mode paints a pass-through line at the reading line and keeps it fixed across turns', async ({
    page,
  }) => {
    await mountEngine(page);
    await loadBook(page, buildBook(40));
    await setFocus(page, 'ruler');
    await page.waitForTimeout(140);

    const first = await readFocusDom(page);
    expect(first.attr).toBe('ruler');
    expect(first.ruler?.visible).toBe(true);
    // A line, not a veil: it must never eat the tap, the drag or the long-press.
    expect(first.ruler?.pointerEvents).toBe('none');
    // No paragraph dimming in ruler mode — the line is the whole effect.
    expect(first.dimmed).toHaveLength(0);
    expect(first.current).toHaveLength(0);

    const message = await waitForFocus(page, (m) => m.mode === 'ruler');
    // The line is 2px tall and centred on the anchor (±1px), plus sub-pixel rounding in the
    // reported `anchorY`, so allow 2px.
    expect(Math.abs(first.ruler!.top - message.anchorY)).toBeLessThanOrEqual(2);

    for (let turn = 0; turn < 2; turn++) {
      await sendBridge(page, { type: 'next' });
      await page.waitForTimeout(140);
      const after = await readFocusDom(page);
      expect(after.ruler?.visible).toBe(true);
      // The line is anchored to the viewport, so it cannot travel with the page.
      expect(Math.abs(after.ruler!.top - first.ruler!.top)).toBeLessThanOrEqual(1);
    }

    // A tap at the line still reaches the text underneath it (selection/turn keep working).
    const hitAtLine = await page.evaluate(() => {
      const root = document.getElementById('reader-root')!;
      const rect = root.getBoundingClientRect();
      const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height * 0.4);
      return {
        tag: el?.tagName ?? '',
        inParagraph: Boolean(el?.closest('.block-p')),
        isRuler: Boolean(el?.closest('#reading-focus-ruler')),
      };
    });
    expect(hitAtLine.isRuler).toBe(false);
    expect(hitAtLine.inParagraph).toBe(true);
  });

  test('(f5) switching back to off removes every trace of the effect', async ({ page }) => {
    await mountEngine(page);
    await loadBook(page, buildBook(24));
    await setFocus(page, 'paragraph');
    await page.waitForTimeout(120);
    expect((await readFocusDom(page)).current).toHaveLength(1);

    await setFocus(page, 'ruler');
    expect((await readFocusDom(page)).ruler?.visible).toBe(true);

    await setFocus(page, 'off');
    await page.waitForTimeout(80);
    const dom = await readFocusDom(page);
    expect(dom.attr).toBe('off');
    expect(dom.current).toHaveLength(0);
    expect(dom.dimmed).toHaveLength(0);
    expect(dom.ruler?.visible ?? false).toBe(false);
  });

  test('(f6) scroll mode re-evaluates the focus on scroll and keeps the ruler fixed on screen', async ({
    page,
  }) => {
    await mountEngine(page);
    await loadBook(page, buildBook(40), { readingMode: 'scroll', readingFocus: 'paragraph' });
    await page.waitForTimeout(200);

    const before = await readFocusDom(page);
    expect(before.current).toHaveLength(1);
    // The paragraph under the line is the one flowing under 40% of the viewport.
    const anchorMsg = await waitForFocus(page, (m) => m.mode === 'paragraph');
    expect(anchorMsg.anchorY).toBeGreaterThan(before.stage.top + before.stage.height * 0.3);
    expect(anchorMsg.anchorY).toBeLessThan(before.stage.top + before.stage.height * 0.5);

    await page.evaluate(() => {
      const stage = document.getElementById('reader-stage')!;
      stage.scrollTop = Math.floor(stage.clientHeight * 1.5);
    });
    await page.waitForTimeout(350);

    const after = await readFocusDom(page);
    expect(after.current).toHaveLength(1);
    expect(after.current[0]!.id).not.toBe(before.current[0]!.id);
    // Still inside the viewport, which is what keeps it readable while scrolling.
    const rect = await page.evaluate((id) => {
      const el = document.querySelector<HTMLElement>(`.block-p[data-block-id="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }, after.current[0]!.id);
    expect(rect).not.toBeNull();
    expect(rect!.top).toBeLessThan(after.stage.bottom);
    expect(rect!.bottom).toBeGreaterThan(after.stage.top);

    // Ruler mode in the same scroll layout: the line does not scroll away with the text.
    await sendBridge(page, { type: 'settings', partial: { readingFocus: 'ruler' } });
    await waitForFocus(page, (m) => m.mode === 'ruler');
    const rulerBefore = await readFocusDom(page);
    await page.evaluate(() => {
      const stage = document.getElementById('reader-stage')!;
      stage.scrollTop = Math.floor(stage.clientHeight * 3);
    });
    await page.waitForTimeout(350);
    const rulerAfter = await readFocusDom(page);
    expect(rulerAfter.ruler?.visible).toBe(true);
    expect(Math.abs(rulerAfter.ruler!.top - rulerBefore.ruler!.top)).toBeLessThanOrEqual(1);
  });
});
