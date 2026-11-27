import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook, type Book } from '../../book-format/src/index.js';
import type { ReaderSettings, RNToWebMessage, WebToRNMessage } from '../src/types.js';

/**
 * F22 — Scroll Mode: blind acceptance tests.
 *
 * Written ONLY from the F22 contract, before the implementation exists. Nothing here reaches
 * into engine internals: every assertion is about observable behaviour — bridge messages, DOM
 * geometry, computed styles and real user input. Optional settings/fields are declared locally
 * (see `ScrollSettings` / `PositionMessage`) so this file typechecks on a branch where F22 has
 * not landed yet.
 *
 * Contract under test:
 *  1. `readingMode: 'scroll'` → continuous vertical scroll, no horizontal multi-column pages.
 *  2. 24px top/bottom gradient edge fades, `pointer-events: none`, absent in paginated mode.
 *  3. Optional thin progress bar (`showScrollProgressBar`, default true), `pointer-events: none`,
 *     fills right-to-left in RTL, hidden when false.
 *  4. Scrolling a multi-chapter book emits `position` with `chapterProgress` (0..1),
 *     `bookProgress` (0..1) and the chapter id crossing over.
 *  5. Anchor survives paginated → scroll → paginated, and the anchor block is really on screen.
 *  6. goto/chapter, goto/anchor, centre tap, footnote sheet, Arabic letter-spacing, and untouched
 *     paginated behaviour.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readerHtmlUrl = pathToFileURL(path.resolve(__dirname, '../dist/reader.html')).href;

/* ------------------------------------------------------------------ */
/* Local F22 types (not in src/types.ts yet, by design)                */
/* ------------------------------------------------------------------ */

type ReadingMode = 'paginated' | 'scroll';

type ScrollSettings = Partial<ReaderSettings> & {
  readingMode?: ReadingMode;
  showScrollProgressBar?: boolean;
};

type PositionMessage = Extract<WebToRNMessage, { type: 'position' }> & {
  chapterProgress?: number;
  readingMode?: ReadingMode;
};

type LoadMessage = Omit<Extract<RNToWebMessage, { type: 'load' }>, 'settings'> & {
  settings?: ScrollSettings;
};

type SettingsMessage = Omit<Extract<RNToWebMessage, { type: 'settings' }>, 'partial'> & {
  partial: ScrollSettings;
};

type BridgeMessage = RNToWebMessage | LoadMessage | SettingsMessage;

/* ------------------------------------------------------------------ */
/* Shapes returned by the in-page helpers                              */
/* ------------------------------------------------------------------ */

type RectLike = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

type ScrollerInfo = {
  found: boolean;
  tagName: string;
  id: string;
  className: string;
  overflowY: string;
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
  scrollTop: number;
};

type OverlayInfo = RectLike & {
  label: string;
  pseudo: string;
  pointerEvents: string;
  display: string;
  visibility: string;
  opacity: number;
  backgroundImage: string;
};

type ThinBarInfo = RectLike & {
  key: number;
  id: string;
  className: string;
  visible: boolean;
  backgroundImage: string;
  backgroundColor: string;
};

type ChapterStyleInfo = {
  chapterId: string;
  dir: string;
  columnCount: string;
  columnWidth: string;
  clientWidth: number;
  scrollWidth: number;
  ariaHidden: string | null;
};

type ParagraphStyleInfo = {
  count: number;
  letterSpacing: string;
  dir: string;
};

interface F22Helpers {
  findScroller(): ScrollerInfo;
  scrollTo(top: number): number;
  scrollTop(): number;
  overlays(): OverlayInfo[];
  thinBars(): ThinBarInfo[];
  blockRects(blockId: string): RectLike[];
  blockIndex(chapterId: string, blockId: string): number;
  chapterStyles(): ChapterStyleInfo[];
  paragraphStyle(): ParagraphStyleInfo;
  trackTranslateX(): number;
  stageRect(): RectLike;
  viewport(): { width: number; height: number };
  scrollBlockIntoView(blockId: string): boolean;
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

function buildLongArabicBook(paragraphCount: number, chaptersCount: number): Book {
  const basePara =
    'كَانَتِ الرِّيَاحُ تَهُبُّ بِهُدُوءٍ فَوْقَ الْمِينَاءِ الْقَدِيمِ، حَيْثُ تَرْتَطِمُ الْأَمْوَاجُ بِأَخْشَابِ الْمَرَاكِبِ وَيَتَأَمَّلُ سَلِيمٌ أَوْرَاقَ وَالِدِهِ الْمَكْتُوبَةَ بِعِنَايَةٍ وَدِقَّةٍ قَبْلَ سَنَوَاتٍ طَوِيلَةٍ فِي لَيْلَةٍ صَافِيَةٍ.';
  const lines: string[] = [
    '---',
    'title: "رِوَايَةٌ طَوِيلَةٌ لِلِاخْتِبَارِ"',
    'author: "اختبار"',
    'lang: ar',
    'dir: rtl',
    '---',
    '',
  ];

  const perChapter = Math.ceil(paragraphCount / chaptersCount);
  let created = 0;

  for (let c = 1; c <= chaptersCount; c++) {
    lines.push(`# الْفَصْلُ رَقْمُ ${c}`);
    lines.push('');
    for (let p = 1; p <= perChapter && created < paragraphCount; p++) {
      created++;
      if (p % 15 === 6) {
        lines.push(`## مَشْهَدٌ فَرْعِيٌّ ${c}-${p}`);
        lines.push('');
      } else if (p % 15 === 11) {
        lines.push('***');
        lines.push('');
      }
      lines.push(`${basePara} (${c}.${p}) وَسَارَ فِي الطَّرِيقِ الطَّوِيلِ حَتَّى وَصَلَ إِلَى الْمَنَارَةِ.`);
      lines.push('');
    }
  }

  return parseBook(lines.join('\n'), 'long-test.md');
}

/** One calm chapter with a footnote reference in its opening paragraph. */
function buildFootnoteScrollBook(): Book {
  const filler =
    'كَانَتِ الرِّيَاحُ تَهُبُّ بِهُدُوءٍ فَوْقَ الْمِينَاءِ الْقَدِيمِ وَالْأَمْوَاجُ تَرْتَطِمُ بِأَخْشَابِ الْمَرَاكِبِ.';
  const lines = [
    '---',
    'title: "حَاشِيَةٌ فِي وَضْعِ التَّمَرُّرِ"',
    'lang: ar',
    'dir: rtl',
    '---',
    '',
    '# الْفَصْلُ الْأَوَّلُ',
    '',
    `${filler} وَفِي هَذِهِ الْجُمْلَةِ حَاشِيَةٌ[^1] تُفْتَحُ بِاللَّمْسِ. ${filler}`,
    '',
  ];
  for (let i = 0; i < 30; i++) {
    lines.push(`${filler} (${i + 1})`);
    lines.push('');
  }
  lines.push('[^1]: نَصُّ الْحَاشِيَةِ الَّذِي يَجِبُ أَنْ يَظْهَرَ فِي الْبُطَاقَةِ.');
  lines.push('');

  return parseBook(lines.join('\n'), 'scroll-footnote.md');
}

/* ------------------------------------------------------------------ */
/* Harness                                                            */
/* ------------------------------------------------------------------ */

/**
 * Installs the bridge recorder (same shape as engine.spec.ts) plus a small read-only helper
 * object used to measure scroll geometry. The helpers are deliberately generic: they look for
 * *any* vertical scroll container, *any* 24px gradient overlay and *any* thin progress-ish bar,
 * so the tests do not depend on element ids the implementation has not chosen yet.
 */
async function installHarness(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as {
      __bridgeMessages: WebToRNMessage[];
      ReactNativeWebView: { postMessage: (data: string) => void };
      __f22: F22Helpers;
    };

    win.__bridgeMessages = [];
    win.ReactNativeWebView = {
      postMessage(data: string) {
        try {
          win.__bridgeMessages.push(JSON.parse(data) as WebToRNMessage);
        } catch {
          // ignore malformed payloads
        }
      },
    };

    const num = (value: string, fallback: number): number => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const rectOf = (r: DOMRect): RectLike => ({
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
      width: r.width,
      height: r.height,
    });

    const isStyledScroller = (el: HTMLElement): boolean => {
      const overflowY = getComputedStyle(el).overflowY;
      return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
    };

    const findScrollerElement = (): HTMLElement | null => {
      const marked = document.querySelector<HTMLElement>('[data-test-scroller="1"]');
      if (marked && marked.isConnected && marked.scrollHeight - marked.clientHeight > 24) {
        return marked;
      }

      const viewportHeight = window.innerHeight || 1;
      const candidates: HTMLElement[] = [];

      for (const el of Array.from(document.querySelectorAll<HTMLElement>('html, body, body *'))) {
        if (el.closest('#footnote-backdrop')) continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const verticalGap = el.scrollHeight - el.clientHeight;
        if (verticalGap <= 24) continue;
        if (el.clientHeight < viewportHeight * 0.4) continue;
        const isDocument = el === document.documentElement || el === document.body;
        if (!isStyledScroller(el) && !isDocument) continue;
        candidates.push(el);
      }

      if (candidates.length === 0) return null;

      // A real `overflow-y: auto|scroll` container wins over the document scroller.
      const styled = candidates.filter(isStyledScroller);
      const pool = styled.length > 0 ? styled : candidates;
      pool.sort((a, b) => {
        // The scroll-mode contract is one continuous scroll over the whole book, so a
        // container spanning several chapters beats a per-chapter scroller.
        const chaptersA = a.querySelectorAll('.chapter').length >= 2 ? 1 : 0;
        const chaptersB = b.querySelectorAll('.chapter').length >= 2 ? 1 : 0;
        if (chaptersA !== chaptersB) return chaptersB - chaptersA;
        return b.scrollHeight - a.scrollHeight;
      });
      const best = pool[0] ?? null;
      if (best) best.setAttribute('data-test-scroller', '1');
      return best;
    };

    const findScroller = (): ScrollerInfo => {
      const el = findScrollerElement();
      if (!el) {
        return {
          found: false,
          tagName: '',
          id: '',
          className: '',
          overflowY: '',
          scrollHeight: 0,
          clientHeight: 0,
          scrollWidth: 0,
          clientWidth: 0,
          scrollTop: 0,
        };
      }
      const doc = el === document.documentElement;
      return {
        found: true,
        tagName: el.tagName.toLowerCase(),
        id: el.id,
        className: typeof el.className === 'string' ? el.className : '',
        overflowY: getComputedStyle(el).overflowY,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollTop: doc ? window.scrollY : el.scrollTop,
      };
    };

    const scrollTo = (top: number): number => {
      const el = findScrollerElement();
      if (!el) {
        window.scrollTo(0, Math.max(0, top));
        return window.scrollY;
      }
      el.scrollTop = Math.max(0, top);
      return el === document.documentElement ? window.scrollY : el.scrollTop;
    };

    const scrollTop = (): number => {
      const el = findScrollerElement();
      if (!el) return window.scrollY;
      return el === document.documentElement ? window.scrollY : el.scrollTop;
    };

    const overlays = (): OverlayInfo[] => {
      const out: OverlayInfo[] = [];

      const push = (el: HTMLElement, pseudo: string | null): void => {
        const style = getComputedStyle(el, pseudo);
        const backgroundImage = style.backgroundImage || '';
        if (!backgroundImage.includes('gradient')) return;

        let rect: RectLike;
        if (!pseudo) {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return;
          rect = rectOf(r);
        } else {
          const parent = el.getBoundingClientRect();
          const height = num(style.height, 0);
          if (height <= 0) return;
          let top = parent.top;
          if (style.top !== 'auto' && Number.isFinite(Number.parseFloat(style.top))) {
            top = parent.top + num(style.top, 0);
          } else if (style.bottom !== 'auto' && Number.isFinite(Number.parseFloat(style.bottom))) {
            top = parent.bottom - num(style.bottom, 0) - height;
          }
          const width = num(style.width, parent.width);
          const left = parent.left + (parent.width - width) / 2;
          rect = { top, bottom: top + height, left, right: left + width, width, height };
        }

        out.push({
          ...rect,
          label: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${typeof el.className === 'string' ? el.className : ''}`,
          pseudo: pseudo ?? '',
          pointerEvents: style.pointerEvents,
          display: style.display,
          visibility: style.visibility,
          opacity: num(style.opacity || '1', 1),
          backgroundImage,
        });
      };

      // Real elements everywhere in the document.
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body, body *'))) {
        push(el, null);
      }
      // Pseudo-element fades are a plausible implementation, so look there too.
      for (const el of Array.from(
        document.querySelectorAll<HTMLElement>('#reader-root, #reader-stage, #reader-track, .chapter'),
      )) {
        push(el, '::before');
        push(el, '::after');
      }
      return out;
    };

    const thinBars = (): ThinBarInfo[] => {
      const out: ThinBarInfo[] = [];
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('body, body *'));
      // A stable per-element key: the DOM order is not stable while scroll-mode slot
      // virtualization mounts/evicts chapters between samples, but the chrome under test
      // keeps the same element and therefore the same key.
      const keyOf = (el: HTMLElement): number => {
        const stored = el.getAttribute('data-f22-key');
        if (stored !== null) return Number(stored);
        const state = win as unknown as { __f22KeySeq?: number };
        state.__f22KeySeq = (state.__f22KeySeq ?? 0) + 1;
        el.setAttribute('data-f22-key', String(state.__f22KeySeq));
        return state.__f22KeySeq;
      };
      nodes.forEach((el) => {
        if (el.closest('#footnote-backdrop')) return;
        const style = getComputedStyle(el);
        if (style.pointerEvents !== 'none') return;
        if (style.display === 'none' || style.visibility === 'hidden') return;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        out.push({
          ...rectOf(r),
          key: keyOf(el),
          id: el.id,
          className: typeof el.className === 'string' ? el.className : '',
          visible:
            r.bottom > 0 &&
            r.top < window.innerHeight &&
            r.right > 0 &&
            r.left < window.innerWidth &&
            num(style.opacity || '1', 1) > 0.05,
          backgroundImage: style.backgroundImage || '',
          backgroundColor: style.backgroundColor || '',
        });
      });
      return out;
    };

    const blockRects = (blockId: string): RectLike[] => {
      const out: RectLike[] = [];
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-block-id="${blockId}"]`),
      );
      for (const node of nodes) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of Array.from(range.getClientRects())) {
          if (r.width <= 0 || r.height <= 0) continue;
          out.push(rectOf(r));
        }
      }
      return out;
    };

    const blockIndex = (chapterId: string, blockId: string): number => {
      const chapter = document.querySelector<HTMLElement>(
        `.chapter[data-chapter-id="${chapterId}"]`,
      );
      if (!chapter) return -1;
      const ids = Array.from(chapter.querySelectorAll<HTMLElement>('[data-block-id]')).map((el) =>
        el.getAttribute('data-block-id'),
      );
      return ids.indexOf(blockId);
    };

    const chapterStyles = (): ChapterStyleInfo[] => {
      return Array.from(document.querySelectorAll<HTMLElement>('.chapter')).map((el) => {
        const style = getComputedStyle(el);
        return {
          chapterId: el.getAttribute('data-chapter-id') ?? '',
          dir: style.direction,
          columnCount: style.columnCount,
          columnWidth: style.columnWidth,
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          ariaHidden: el.getAttribute('aria-hidden'),
        };
      });
    };

    const paragraphStyle = (): ParagraphStyleInfo => {
      const paragraphs = Array.from(
        document.querySelectorAll<HTMLElement>('.chapter .block-p'),
      );
      const first = paragraphs[0];
      if (!first) return { count: 0, letterSpacing: '', dir: '' };
      const style = getComputedStyle(first);
      return { count: paragraphs.length, letterSpacing: style.letterSpacing, dir: style.direction };
    };

    const trackTranslateX = (): number => {
      const track = document.getElementById('reader-track');
      if (!track) return 0;
      const transform = getComputedStyle(track).transform;
      if (!transform || transform === 'none') return 0;
      const values = transform.slice(transform.indexOf('(') + 1, transform.lastIndexOf(')'));
      const parts = values.split(',').map((v) => Number.parseFloat(v.trim()));
      if (transform.startsWith('matrix3d')) return parts[12] ?? 0;
      return parts[4] ?? 0;
    };

    const stageRect = (): RectLike => {
      const stage = document.getElementById('reader-stage');
      if (!stage) return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
      return rectOf(stage.getBoundingClientRect());
    };

    const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

    const scrollBlockIntoView = (blockId: string): boolean => {
      const el = document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      return true;
    };

    win.__f22 = {
      findScroller,
      scrollTo,
      scrollTop,
      overlays,
      thinBars,
      blockRects,
      blockIndex,
      chapterStyles,
      paragraphStyle,
      trackTranslateX,
      stageRect,
      viewport,
      scrollBlockIntoView,
    };
  });

  await page.goto(readerHtmlUrl);
  await page.waitForSelector('#reader-stage');
}

/** Invokes one of the page-side helpers and serializes its plain-object result back. */
function call<K extends keyof F22Helpers>(
  page: Page,
  method: K,
  ...args: Parameters<F22Helpers[K]>
): Promise<ReturnType<F22Helpers[K]>> {
  return page.evaluate(
    ({ name, methodArgs }) => {
      const api = (window as unknown as { __f22: Record<string, (...a: unknown[]) => unknown> })
        .__f22;
      return api[name as string]!(...methodArgs);
    },
    { name: method as string, methodArgs: args as unknown[] },
  ) as Promise<ReturnType<F22Helpers[K]>>;
}

async function send(page: Page, msg: BridgeMessage): Promise<void> {
  await page.evaluate((payload) => {
    window.postMessage(JSON.stringify(payload), '*');
  }, msg);
}

async function getMessages(page: Page): Promise<WebToRNMessage[]> {
  return page.evaluate(() => {
    return (window as unknown as { __bridgeMessages: WebToRNMessage[] }).__bridgeMessages;
  });
}

async function getLatestPosition(page: Page): Promise<PositionMessage | null> {
  const msgs = await getMessages(page);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.type === 'position') return m as PositionMessage;
  }
  return null;
}

async function messageCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __bridgeMessages: unknown[] }).__bridgeMessages.length,
  );
}

/** Waits for a `position` message newer than `since` and returns the newest one. */
async function waitForPositionSince(
  page: Page,
  since: number,
  timeout = 10_000,
): Promise<PositionMessage> {
  await expect
    .poll(
      async () => {
        const msgs = await getMessages(page);
        return msgs.slice(since).some((m) => m?.type === 'position');
      },
      { timeout, intervals: [50, 100, 200, 400] },
    )
    .toBe(true);
  const latest = await getLatestPosition(page);
  if (!latest) throw new Error('a position message arrived but could not be read back');
  return latest;
}

/** Best-effort wait used while scrolling: a throttled reader may skip an emission. */
async function maybeWaitForPosition(
  page: Page,
  since: number,
  timeout = 2_000,
): Promise<PositionMessage | null> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const msgs = await getMessages(page);
    if (msgs.slice(since).some((m) => m?.type === 'position')) {
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m?.type === 'position') return m as PositionMessage;
      }
    }
    await page.waitForTimeout(60);
  }
  return null;
}

async function loadBook(page: Page, book: Book, settings: ScrollSettings): Promise<void> {
  const since = await messageCount(page);
  const msg: LoadMessage = {
    type: 'load',
    book,
    settings: { disableAnimation: true, ...settings },
  };
  await send(page, msg);
  await waitForPositionSince(page, since);
}

async function updateSettings(page: Page, partial: ScrollSettings): Promise<number> {
  const since = await messageCount(page);
  const msg: SettingsMessage = { type: 'settings', partial };
  await send(page, msg);
  return since;
}

async function scrollToAndSettle(page: Page, top: number): Promise<number> {
  await call(page, 'scrollTo', top);
  let previous = await call(page, 'scrollTop');
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(80);
    const current = await call(page, 'scrollTop');
    if (Math.abs(current - previous) < 1) return current;
    previous = current;
  }
  return previous;
}

/** Block is on screen inside the stage box (not merely present in the DOM). */
async function isBlockVisible(page: Page, blockId: string): Promise<boolean> {
  const stage: RectLike = await call(page, 'stageRect');
  const rects: RectLike[] = await call(page, 'blockRects', blockId);
  return rects.some(
    (r) =>
      r.bottom > stage.top + 1 &&
      r.top < stage.bottom - 1 &&
      r.right > stage.left + 1 &&
      r.left < stage.right - 1,
  );
}

function isPainted(bar: ThinBarInfo): boolean {
  if (bar.backgroundImage && bar.backgroundImage !== 'none') return true;
  return !/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|transparent/.test(
    bar.backgroundColor || '',
  );
}

function visibleThinBars(bars: ThinBarInfo[]): ThinBarInfo[] {
  return bars.filter((b) => b.visible && b.height >= 0.5 && b.height <= 12 && b.width >= 80);
}

function visibleProgressBars(bars: ThinBarInfo[]): ThinBarInfo[] {
  return visibleThinBars(bars).filter(isPainted);
}

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */

test.describe('F22 — Scroll reading mode', () => {
  test.setTimeout(90_000);

  test('(a) readingMode scroll gives continuous vertical flow with no horizontal pagination', async ({
    page,
  }) => {
    await installHarness(page);
    const book = buildLongArabicBook(120, 3);
    await loadBook(page, book, { readingMode: 'scroll' });

    const position = await getLatestPosition(page);
    expect(position).not.toBeNull();
    expect(position!.chapterId).toBe(book.chapters[0]!.id);

    // 1. A genuinely scrollable container with vertical overflow.
    const scroller: ScrollerInfo = await call(page, 'findScroller');
    expect(
      scroller.found,
      'scroll mode must expose a scrollable container with more content than fits',
    ).toBe(true);
    expect(scroller.scrollHeight - scroller.clientHeight).toBeGreaterThan(120);
    expect(['auto', 'scroll', 'overlay']).toContain(scroller.overflowY);

    // 2. No horizontal multi-column overflow: this is the pagination mechanism.
    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth + 2);
    expect(await call(page, 'trackTranslateX')).toBe(0);

    // 3. CSS columns are off on the chapter boxes, or at least never narrower than the page.
    const styles: ChapterStyleInfo[] = await call(page, 'chapterStyles');
    expect(styles.length).toBeGreaterThan(0);
    for (const style of styles) {
      expect(
        ['auto', '1'],
        `chapter ${style.chapterId} still uses column-count ${style.columnCount}`,
      ).toContain(style.columnCount);
      const columnWidth = style.columnWidth;
      const numeric = Number.parseFloat(columnWidth);
      const disabled =
        columnWidth === 'auto' ||
        columnWidth === 'normal' ||
        (Number.isFinite(numeric) && numeric >= style.clientWidth - 1);
      expect(
        disabled,
        `chapter ${style.chapterId} still paginates at column-width ${columnWidth}`,
      ).toBe(true);
    }

    // 4. Content really continues past the fold: scrolling down reveals later blocks of ch01.
    const info = await call(page, 'findScroller');
    const maxScroll = info.scrollHeight - info.clientHeight;
    const sinceScroll = await messageCount(page);
    await scrollToAndSettle(page, Math.round(maxScroll * 0.5));
    expect(await call(page, 'scrollTop')).toBeGreaterThan(120);
    const scrolledPosition = await maybeWaitForPosition(page, sinceScroll, 3_000);
    expect(scrolledPosition, 'scrolling down must emit a new position').not.toBeNull();
    expect(scrolledPosition!.chapterId).toBeTruthy();
    expect(scrolledPosition!.anchor.blockId).not.toBe(position!.anchor.blockId);
  });

  test('(b) 24px gradient edge fades exist in scroll mode with pointer-events none, and not while paginated', async ({
    page,
  }) => {
    await installHarness(page);
    const book = buildLongArabicBook(120, 3);
    await loadBook(page, book, { readingMode: 'scroll' });

    const readFades = async () => {
      const viewport = await call(page, 'viewport');
      const overlays: OverlayInfo[] = await call(page, 'overlays');
      const fades = overlays.filter(
        (o) =>
          o.pointerEvents === 'none' &&
          o.display !== 'none' &&
          o.visibility !== 'hidden' &&
          o.opacity > 0.05 &&
          o.width >= 80 &&
          Math.abs(o.height - 24) <= 1 &&
          o.bottom > 0 &&
          o.top < viewport.height,
      );
      return {
        viewport,
        overlays,
        top: fades.find((o) => o.top <= viewport.height * 0.2),
        bottom: fades.find((o) => o.bottom >= viewport.height * 0.8),
      };
    };

    await expect
      .poll(
        async () => {
          const { top, bottom } = await readFades();
          return Number(top !== undefined) + Number(bottom !== undefined);
        },
        { timeout: 5_000, intervals: [100, 200, 400] },
      )
      .toBe(2);

    const { viewport, overlays, top: topFade, bottom: bottomFade } = await readFades();

    expect(
      topFade,
      `no 24px top gradient fade with pointer-events:none; overlays=${JSON.stringify(
        overlays.map((o) => ({ label: o.label, pseudo: o.pseudo, h: o.height, top: o.top, pe: o.pointerEvents })),
      )}`,
    ).toBeTruthy();
    expect(
      bottomFade,
      `no 24px bottom gradient fade with pointer-events:none; overlays=${JSON.stringify(
        overlays.map((o) => ({ label: o.label, pseudo: o.pseudo, h: o.height, bottom: o.bottom, pe: o.pointerEvents })),
      )}`,
    ).toBeTruthy();
    expect(topFade!.width).toBeGreaterThanOrEqual(80);

    await expect(page.locator('#reader-stage')).toBeVisible();

    // Switching back to paginated removes them (or at least stops painting them).
    await updateSettings(page, { readingMode: 'paginated' });
    await expect
      .poll(async () => {
        const current: OverlayInfo[] = await call(page, 'overlays');
        return current.filter(
          (o) =>
            o.pointerEvents === 'none' &&
            o.display !== 'none' &&
            o.visibility !== 'hidden' &&
            o.opacity > 0.05 &&
            o.width >= 80 &&
            Math.abs(o.height - 24) <= 1,
        ).length;
      })
      .toBe(0);
  });

  test('(c) optional progress bar: thin, pointer-events none, fills right-to-left in RTL, hidden when off', async ({
    page,
  }) => {
    await installHarness(page);
    const book = buildLongArabicBook(120, 3);
    await loadBook(page, book, { readingMode: 'scroll' });

    const scroller: ScrollerInfo = await call(page, 'findScroller');
    expect(scroller.found).toBe(true);
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    expect(maxScroll).toBeGreaterThan(200);

    // The bar is part of scroll-mode chrome and may mount on the next frame.
    await expect
      .poll(async () => visibleProgressBars(await call(page, 'thinBars')).length, {
        timeout: 5_000,
        intervals: [100, 200, 400],
      })
      .toBeGreaterThan(0);

    // Progress-bar candidates: thin, visible, pointer-events none.
    const sample = async (ratio: number): Promise<ThinBarInfo[]> => {
      await scrollToAndSettle(page, Math.round(maxScroll * ratio));
      // Let a width/transform transition on the bar finish before measuring it.
      await page.waitForTimeout(250);
      return call(page, 'thinBars');
    };

    const early = await sample(0.25);
    const late = await sample(0.8);

    const paintedEarly = visibleProgressBars(early);
    expect(
      paintedEarly.length,
      'showScrollProgressBar defaults to true, so a thin bar must be visible',
    ).toBeGreaterThan(0);

    // Identify the element that grows as progress advances (track or fill, either is fine).
    const lateByKey = new Map(late.map((b) => [b.key, b]));
    let growing: { before: ThinBarInfo; after: ThinBarInfo; delta: number } | null = null;
    let previousDelta = -Infinity;
    for (const before of paintedEarly) {
      const after = lateByKey.get(before.key);
      if (!after) continue;
      const delta = after.width - before.width;
      if (delta <= 0) continue;
      if (delta > previousDelta) {
        previousDelta = delta;
        growing = { before, after, delta };
      }
    }

    expect(
      growing,
      `no progress-shaped element grew with scroll; early=${JSON.stringify(
        paintedEarly.map((b) => ({ cls: b.className, w: b.width, h: b.height, right: b.right })),
      )} late=${JSON.stringify(
        visibleProgressBars(late).map((b) => ({ cls: b.className, w: b.width, h: b.height, right: b.right })),
      )}`,
    ).not.toBeNull();
    expect(growing!.delta).toBeGreaterThan(20);
    expect(growing!.after.height, 'the progress bar must stay thin').toBeLessThanOrEqual(8);

    // RTL: the leading edge is the right one, so the bar grows leftwards.
    expect(growing!.after.right).toBeGreaterThan(growing!.before.right - 4);
    expect(growing!.after.right).toBeLessThan(growing!.before.right + 4);
    expect(growing!.after.left).toBeLessThan(growing!.before.left - 10);

    // Turning the bar off removes it without breaking the layout.
    await updateSettings(page, { showScrollProgressBar: false });
    await expect
      .poll(async () => visibleProgressBars(await call(page, 'thinBars')).length, {
        timeout: 5_000,
      })
      .toBe(0);

    // Fades stay: only the bar was disabled.
    const overlays: OverlayInfo[] = await call(page, 'overlays');
    expect(
      overlays.filter(
        (o) => o.pointerEvents === 'none' && Math.abs(o.height - 24) <= 1 && o.opacity > 0.05,
      ).length,
    ).toBeGreaterThan(0);
  });

  test('(d) scrolling a multi-chapter book reports increasing chapterProgress/bookProgress and crosses chapters', async ({
    page,
  }) => {
    await installHarness(page);
    const book = buildLongArabicBook(180, 3);
    await loadBook(page, book, { readingMode: 'scroll' });

    const first = (await getLatestPosition(page))!;
    expect(first.chapterId).toBe(book.chapters[0]!.id);

    const scroller: ScrollerInfo = await call(page, 'findScroller');
    expect(scroller.found).toBe(true);
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    expect(maxScroll, 'the whole book must be taller than the viewport').toBeGreaterThan(1_000);

    const steps = 14;
    const reported: PositionMessage[] = [];
    for (let step = 1; step <= steps; step++) {
      const since = await messageCount(page);
      await scrollToAndSettle(page, Math.round((maxScroll * step) / steps));
      const arrived = await maybeWaitForPosition(page, since, 2_500);
      if (arrived) reported.push(arrived);
    }
    if (reported.length === 0) {
      throw new Error('scrolling emitted no position messages at all');
    }

    // The scroll-mode contract: every position reported while scrolling carries chapterProgress.
    for (const message of reported) {
      expect(
        typeof message.chapterProgress,
        `position in ${message.chapterId} lacks chapterProgress (0..1)`,
      ).toBe('number');
      expect(message.chapterProgress!).toBeGreaterThanOrEqual(0);
      expect(message.chapterProgress!).toBeLessThanOrEqual(1);
      expect(message.bookProgress).toBeGreaterThanOrEqual(0);
      expect(message.bookProgress).toBeLessThanOrEqual(1);
      if (message.readingMode !== undefined) {
        expect(message.readingMode).toBe('scroll');
      }
    }

    // chapterProgress is non-decreasing within a chapter.
    for (const chapter of book.chapters) {
      const inChapter = reported.filter((m) => m.chapterId === chapter.id);
      for (let i = 1; i < inChapter.length; i++) {
        expect(
          inChapter[i]!.chapterProgress!,
          `chapterProgress went backwards inside ${chapter.id}`,
        ).toBeGreaterThanOrEqual(inChapter[i - 1]!.chapterProgress!);
      }
    }

    // …and it actually advances inside the first chapter.
    const firstChapter = reported.filter((m) => m.chapterId === book.chapters[0]!.id);
    if (firstChapter.length >= 2) {
      expect(firstChapter[firstChapter.length - 1]!.chapterProgress!).toBeGreaterThan(
        firstChapter[0]!.chapterProgress!,
      );
    }

    // bookProgress only moves forward, and it must actually move.
    for (let i = 1; i < reported.length; i++) {
      expect(
        reported[i]!.bookProgress,
        'bookProgress went backwards while scrolling down',
      ).toBeGreaterThanOrEqual(reported[i - 1]!.bookProgress);
    }
    expect(reported[reported.length - 1]!.bookProgress).toBeGreaterThan(
      reported[0]!.bookProgress,
    );

    // Crossing the bottom of ch01 lands the reader in a later chapter.
    const final = (await getLatestPosition(page))!;
    const finalIndex = book.chapters.findIndex((c) => c.id === final.chapterId);
    expect(finalIndex, `expected to leave ch01, ended in ${final.chapterId}`).toBeGreaterThan(0);
    expect(reported.some((m) => m.chapterId === book.chapters[1]!.id)).toBe(true);
  });

  test('(e) paginated → scroll keeps the block anchor (±1 block) and scrolls that block into view', async ({
    page,
  }) => {
    await installHarness(page);
    const book = buildLongArabicBook(150, 4);

    await loadBook(page, book, { readingMode: 'paginated', fontSize: 19, lineHeight: 1.95 });
    const targetChapter = book.chapters[1]!.id;
    await send(page, { type: 'goto', chapterId: targetChapter, page: 3 });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe(targetChapter);
    await expect.poll(async () => (await getLatestPosition(page))?.chapterPage).toBe(3);

    const anchorBefore = (await getLatestPosition(page))!.anchor.blockId;
    expect(anchorBefore.startsWith(`${targetChapter}_`)).toBe(true);

    const since = await updateSettings(page, { readingMode: 'scroll' });
    const switched = await waitForPositionSince(page, since);

    expect(switched.chapterId).toBe(targetChapter);
    expect(switched.readingMode === undefined || switched.readingMode === 'scroll').toBe(true);

    const indexBefore: number = await call(page, 'blockIndex', targetChapter, anchorBefore);
    const indexAfter: number = await call(
      page,
      'blockIndex',
      targetChapter,
      switched.anchor.blockId,
    );
    expect(indexBefore, `anchor ${anchorBefore} is not mounted in ${targetChapter}`).toBeGreaterThanOrEqual(0);
    expect(
      indexAfter,
      `restored anchor ${switched.anchor.blockId} is not in ${targetChapter}`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      Math.abs(indexAfter - indexBefore),
      `anchor moved from ${anchorBefore} to ${switched.anchor.blockId}`,
    ).toBeLessThanOrEqual(1);

    await expect
      .poll(async () => isBlockVisible(page, anchorBefore), {
        timeout: 5_000,
        intervals: [100, 200, 400],
      })
      .toBe(true);

    // And the reader is in a real scroll layout, not pagination with a shifted anchor.
    const scroller: ScrollerInfo = await call(page, 'findScroller');
    expect(scroller.found, 'switching to scroll mode must produce a scroll container').toBe(true);
  });

  test('(f) scroll → paginated restores the exact scrolled block and shows it on the active page', async ({
    page,
  }) => {
    await installHarness(page);
    const book = buildLongArabicBook(150, 4);

    await loadBook(page, book, { readingMode: 'scroll', fontSize: 19, lineHeight: 1.95 });
    await send(page, { type: 'goto', chapterId: book.chapters[1]!.id });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe(
      book.chapters[1]!.id,
    );

    const scroller: ScrollerInfo = await call(page, 'findScroller');
    expect(scroller.found).toBe(true);
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    expect(maxScroll).toBeGreaterThan(400);

    // goto() may still be settling, so read the resting offset before the extra scroll.
    await page.waitForTimeout(150);
    const restingTop = await call(page, 'scrollTop');
    const sinceScroll = await messageCount(page);
    await scrollToAndSettle(page, restingTop + Math.round(scroller.clientHeight * 0.9));
    await maybeWaitForPosition(page, sinceScroll, 3_000);
    const scrolled = (await getLatestPosition(page))!;
    const scrollAnchor = scrolled.anchor.blockId;
    const anchorChapter = scrollAnchor.split('_')[0]!;
    expect(anchorChapter).toBe(scrolled.chapterId);
    await expect.poll(async () => isBlockVisible(page, scrollAnchor), { timeout: 5_000 }).toBe(true);

    const since = await updateSettings(page, { readingMode: 'paginated' });
    const paginated = await waitForPositionSince(page, since);

    expect(paginated.chapterId).toBe(anchorChapter);
    expect(paginated.readingMode === undefined || paginated.readingMode === 'paginated').toBe(true);
    expect(
      paginated.anchor.blockId,
      `paginated mode restored ${paginated.anchor.blockId} instead of ${scrollAnchor}`,
    ).toBe(scrollAnchor);

    await expect
      .poll(async () => isBlockVisible(page, scrollAnchor), {
        timeout: 5_000,
        intervals: [100, 200, 400],
      })
      .toBe(true);

    // A page turn still works after the switch back.
    const pageBeforeTurn = (await getLatestPosition(page))!.page;
    await send(page, { type: 'next' });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(pageBeforeTurn + 1);
  });

  test('(g) goto chapter, goto anchor, centre tap and Arabic letter-spacing all behave in scroll mode', async ({
    page,
  }) => {
    await installHarness(page);
    const book = buildLongArabicBook(150, 4);
    await loadBook(page, book, { readingMode: 'scroll' });

    // 1. goto({ chapterId }) lands on that chapter and brings it into view.
    const targetChapter = book.chapters[2]!;
    await send(page, { type: 'goto', chapterId: targetChapter.id });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe(
      targetChapter.id,
    );
    const chapterOnScreen = await page.evaluate((chapterId) => {
      const stage = document.getElementById('reader-stage')!.getBoundingClientRect();
      const chapter = document.querySelector<HTMLElement>(
        `.chapter[data-chapter-id="${chapterId}"]`,
      );
      if (!chapter) return false;
      const r = chapter.getBoundingClientRect();
      return r.bottom > stage.top + 1 && r.top < stage.bottom - 1;
    }, targetChapter.id);
    expect(chapterOnScreen).toBe(true);

    // 2. goto({ anchor }) makes that block visible.
    const targetBlock = targetChapter.blocks[10]!;
    await send(page, {
      type: 'goto',
      chapterId: targetChapter.id,
      anchor: { blockId: targetBlock.id, charOffset: 0 },
    });
    await expect.poll(async () => (await getLatestPosition(page))?.chapterId).toBe(
      targetChapter.id,
    );
    await expect
      .poll(async () => isBlockVisible(page, targetBlock.id), {
        timeout: 5_000,
        intervals: [100, 200, 400],
      })
      .toBe(true);

    // 3. A centre tap reports `zone: 'center'` and must not jump the scroll position.
    const beforeTap = await call(page, 'scrollTop');
    const tapsBefore = (await getMessages(page)).filter((m) => m.type === 'tap').length;
    const stage = await call(page, 'stageRect');
    await page.mouse.click(stage.left + stage.width / 2, stage.top + stage.height / 2);
    await expect
      .poll(async () => (await getMessages(page)).filter((m) => m.type === 'tap').length)
      .toBe(tapsBefore + 1);
    expect((await getMessages(page)).filter((m) => m.type === 'tap').at(-1)).toEqual({
      type: 'tap',
      zone: 'center',
    });
    const afterTap = await call(page, 'scrollTop');
    expect(Math.abs(afterTap - beforeTap)).toBeLessThanOrEqual(2);

    // 4. Arabic paragraphs keep zero letter-spacing in scroll mode too.
    const paragraphStyle: ParagraphStyleInfo = await call(page, 'paragraphStyle');
    expect(paragraphStyle.count).toBeGreaterThan(0);
    expect(['0px', 'normal']).toContain(paragraphStyle.letterSpacing);
    expect(paragraphStyle.dir).toBe('rtl');
  });

  test('(h) footnote references still open the sheet while scrolling', async ({ page }) => {
    await installHarness(page);
    const book = buildFootnoteScrollBook();
    await loadBook(page, book, { readingMode: 'scroll' });

    const refs = page.locator('sup.fn-ref a');
    await expect(refs).toHaveCount(1);
    const link = refs.first();

    // Bring it on screen if the opening viewport does not already contain it.
    await link.scrollIntoViewIfNeeded();
    const box = await link.boundingBox();
    expect(box).not.toBeNull();

    const backdrop = page.locator('#footnote-backdrop');
    await expect(backdrop).toBeHidden();

    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    await expect(backdrop).toBeVisible();
    await expect(page.locator('#footnote-body')).toContainText('نَصُّ الْحَاشِيَةِ');

    // The same tap must not be swallowed by the backdrop it just opened.
    await page.waitForTimeout(400);
    await expect(backdrop).toBeVisible();

    // A deliberate tap on the dim area still dismisses.
    const viewport = await call(page, 'viewport');
    await page.mouse.click(viewport.width / 2, viewport.height * 0.12);
    await expect(backdrop).toBeHidden();
  });

  test('(i) paginated mode is untouched: CSS columns, horizontal page turns, no scroll chrome', async ({
    page,
  }) => {
    await installHarness(page);
    const book = buildLongArabicBook(90, 2);

    // No readingMode at all: the default must stay paginated.
    await loadBook(page, book, { fontSize: 20, lineHeight: 1.95 });
    const initial = (await getLatestPosition(page))!;
    expect(initial.page).toBe(1);
    expect(initial.pageCount).toBeGreaterThan(1);

    const styles: ChapterStyleInfo[] = await call(page, 'chapterStyles');
    expect(styles.length).toBeGreaterThan(0);
    const columnWidth = Number.parseFloat(styles[0]!.columnWidth);
    expect(columnWidth, 'paginated mode must still use a fixed column width').toBeGreaterThan(0);
    expect(styles[0]!.columnCount).toBe('auto');

    // Turning a page still translates the track horizontally.
    await send(page, { type: 'next' });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(2);
    expect(Math.abs(await call(page, 'trackTranslateX'))).toBeGreaterThan(50);

    // Neither scroll-mode chrome leaks into pagination.
    const viewport = await call(page, 'viewport');
    const overlays: OverlayInfo[] = await call(page, 'overlays');
    expect(
      overlays.filter(
        (o) =>
          o.pointerEvents === 'none' &&
          o.opacity > 0.05 &&
          o.width >= 80 &&
          Math.abs(o.height - 24) <= 1 &&
          o.bottom > 0 &&
          o.top < viewport.height,
      ).length,
    ).toBe(0);
    expect(visibleProgressBars(await call(page, 'thinBars')).length).toBe(0);

    // And an explicit `readingMode: 'paginated'` behaves the same way.
    const since = await updateSettings(page, { readingMode: 'paginated' });
    const echoed = await waitForPositionSince(page, since);
    expect(echoed.page).toBe(2);
    await send(page, { type: 'next' });
    await expect.poll(async () => (await getLatestPosition(page))?.page).toBe(3);
  });
});
