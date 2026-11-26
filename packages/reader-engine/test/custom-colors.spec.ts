import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook } from '../../book-format/src/index.js';
import { HIGHLIGHT_COLORS, THEMES } from '../src/types.js';
import type { RNToWebMessage } from '../src/types.js';

/**
 * F32 — ألوان مخصّصة.
 *
 * The picker is only half the feature: the page itself is painted by the engine, which derives a
 * whole token set (heading, muted, quote, popover, spine, highlight fills) from the two colours the
 * reader chose. These tests drive the built `reader.html` through the same bridge the app uses and
 * read the *computed* page, so an engine that stores the pair but forgets to derive from it fails
 * here instead of looking right in the picker and wrong on the page.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readerHtmlUrl = pathToFileURL(path.resolve(__dirname, '../dist/reader.html')).href;
const sampleArText = fs.readFileSync(path.resolve(__dirname, 'fixtures/sample-ar.md'), 'utf8');
const fontsDirUrl = pathToFileURL(path.resolve(__dirname, '../../../apps/mobile/assets/fonts')).href + '/';

const NIGHT = { bg: '#101820', text: '#F2E8D5' };
const WARRAQ = { bg: '#FAF7F0', text: '#231F1A' };

async function mountEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as {
      __bridgeMessages: unknown[];
      ReactNativeWebView: { postMessage: (data: string) => void };
    };
    win.__bridgeMessages = [];
    win.ReactNativeWebView = {
      postMessage(data: string) {
        try {
          win.__bridgeMessages.push(JSON.parse(data));
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

async function loadBook(
  page: Page,
  settings: Record<string, unknown>,
): Promise<void> {
  const before = (await messages(page)).length;
  await sendBridge(page, {
    type: 'load',
    book: parseBook(sampleArText, 'sample-ar.md'),
    fontBaseUrl: fontsDirUrl,
    settings: { disableAnimation: true, fontFamily: 'Amiri', fontSize: 20, ...settings },
  });
  // The `load` is acknowledged by a `position` message once the first page is laid out and the
  // paint is applied — reading colours before that reads the previous (empty) state.
  await expect
    .poll(async () =>
      (await messages(page))
        .slice(before)
        .some((m) => (m as { type?: string; page?: number }).type === 'position'),
    )
    .toBe(true);
}

async function messages(page: Page): Promise<unknown[]> {
  return page.evaluate(
    () => (window as unknown as { __bridgeMessages: unknown[] }).__bridgeMessages,
  );
}

/**
 * Everything the page is actually painted with — CSS variables *and* the computed styles that
 * consume them, because a variable nobody applies is not a themed page.
 */
async function readPaint(page: Page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const grab = (name: string) => style.getPropertyValue(name).trim();
    const bodyStyle = getComputedStyle(document.body);
    const paragraph = document.querySelector<HTMLElement>(
      '.chapter[aria-hidden="false"] .block-p',
    );
    return {
      vars: {
        bg: grab('--bg-color'),
        text: grab('--text-color'),
        heading: grab('--heading-color'),
        muted: grab('--muted-color'),
        quoteBg: grab('--quote-bg'),
        quoteBorder: grab('--quote-border'),
        accent: grab('--accent-color'),
        popoverBg: grab('--popover-bg'),
        popoverBorder: grab('--popover-border'),
        spineCrease: grab('--spine-crease'),
        hlGold: grab('--hl-gold'),
        hlSage: grab('--hl-sage'),
      },
      dataTheme: document.documentElement.getAttribute('data-theme'),
      dataCustomColors: document.documentElement.getAttribute('data-custom-colors'),
      bodyBackground: bodyStyle.backgroundColor,
      bodyColor: bodyStyle.color,
      paragraphColor: paragraph ? getComputedStyle(paragraph).color : null,
      paragraphDirection: paragraph ? getComputedStyle(paragraph).direction : null,
    };
  });
}

function rgbOf(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** WCAG relative luminance, recomputed here so the test does not trust the engine's own maths. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const GOLD_LIGHT = HIGHLIGHT_COLORS.find((c) => c.id === 'gold')!.fillLight;
const GOLD_DARK = HIGHLIGHT_COLORS.find((c) => c.id === 'gold')!.fillDark;
const SAGE_LIGHT = HIGHLIGHT_COLORS.find((c) => c.id === 'sage')!.fillLight;
const SAGE_DARK = HIGHLIGHT_COLORS.find((c) => c.id === 'sage')!.fillDark;

test.describe('Reader Engine Custom Colours (F32)', () => {
  test('paints the page with the picked pair and derives every dependent token from it', async ({
    page,
  }) => {
    await mountEngine(page);
    await loadBook(page, {
      theme: 'warraq',
      customColors: { enabled: true, ...NIGHT },
    });

    const paint = await readPaint(page);

    // The paper and the ink are real computed styles, not just stored variables.
    expect(paint.bodyBackground).toBe(rgbOf(NIGHT.bg));
    expect(paint.bodyColor).toBe(rgbOf(NIGHT.text));
    expect(paint.paragraphColor).toBe(rgbOf(NIGHT.text));
    expect(paint.vars.bg).toBe(NIGHT.bg);
    expect(paint.vars.text).toBe(NIGHT.text);

    // Dark paper lifts the heading a touch and derives a muted ink that still clears AA — the
    // values are pinned, so a formula change cannot quietly ship an unreadable footnote.
    expect(paint.vars.heading).toBe('#F4EBDA');
    expect(paint.vars.muted).toBe('#98958D');
    expect(contrast(paint.vars.muted, NIGHT.bg)).toBeGreaterThanOrEqual(4.5);
    // Quote / popover / accent are all derived from the same two colours.
    expect(paint.vars.quoteBg).toBe('rgba(242, 232, 213, 0.06)');
    expect(paint.vars.quoteBorder).toBe('#E3C58C');
    expect(paint.vars.accent).toBe('#E3C58C');
    expect(paint.vars.popoverBg).toBe('#212830');
    expect(paint.vars.popoverBorder).toBe('#464A4B');
    // The open-book fold is a shade of the custom paper, not of the preset theme.
    expect(paint.vars.spineCrease).toBe('rgba(112, 116, 121, 0.22)');

    // Image dimming follows the *picked* luminance, so a dark custom page is treated as dark.
    expect(paint.dataTheme).toBe('burnt-paper');
    expect(paint.dataCustomColors).toBe('true');
  });

  test('highlight fills follow the picked background luminance, not the preset theme', async ({
    page,
  }) => {
    await mountEngine(page);

    // Preset is dark (Burnt Paper) but the page is painted light: the light fills must win.
    await loadBook(page, {
      theme: 'burnt-paper',
      customColors: { enabled: true, ...WARRAQ },
    });
    let paint = await readPaint(page);
    expect(paint.vars.bg).toBe(WARRAQ.bg);
    expect(paint.dataTheme).toBe('warraq');
    expect(paint.vars.hlGold).toBe(GOLD_LIGHT);
    expect(paint.vars.hlSage).toBe(SAGE_LIGHT);

    // Preset is light (Warraq) but the page is painted dark: the dark fills must win.
    await sendBridge(page, {
      type: 'settings',
      partial: { customColors: { enabled: true, ...NIGHT } },
    });
    await expect.poll(async () => (await readPaint(page)).vars.bg).toBe(NIGHT.bg);
    paint = await readPaint(page);
    expect(paint.dataTheme).toBe('burnt-paper');
    expect(paint.vars.hlGold).toBe(GOLD_DARK);
    expect(paint.vars.hlSage).toBe(SAGE_DARK);
  });

  test('a light custom pair on a dark preset derives a readable accent and a light popover', async ({
    page,
  }) => {
    await mountEngine(page);
    await loadBook(page, {
      theme: 'oled-crimson',
      customColors: { enabled: true, ...WARRAQ },
    });

    const paint = await readPaint(page);

    expect(paint.vars.heading).toBe(WARRAQ.text);
    expect(paint.vars.accent).toBe('#77634B');
    // Muted ink on light paper must clear AA too, and be visibly lighter than the body ink.
    expect(paint.vars.muted).toBe('#68645E');
    expect(contrast(paint.vars.muted, WARRAQ.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(paint.vars.muted, WARRAQ.bg)).toBeLessThan(
      contrast(WARRAQ.text, WARRAQ.bg),
    );
    // A light page's popover lifts toward white, not toward the dark preset's surface.
    expect(luminance(paint.vars.popoverBg)).toBeGreaterThan(luminance(WARRAQ.bg));
    expect(paint.vars.quoteBorder).toBe('#77634B');
  });

  test('disabling custom colours returns the page to the chosen preset exactly', async ({
    page,
  }) => {
    await mountEngine(page);
    await loadBook(page, {
      theme: 'sepia',
      customColors: { enabled: true, ...NIGHT },
    });
    expect((await readPaint(page)).bodyBackground).toBe(rgbOf(NIGHT.bg));

    // «إلغاء التخصيص» keeps the stored pair but takes it out of the paint.
    await sendBridge(page, {
      type: 'settings',
      partial: { customColors: { enabled: false, ...NIGHT } },
    });
    await expect
      .poll(async () => (await readPaint(page)).bodyBackground)
      .toBe(rgbOf(THEMES.sepia.bg));

    const paint = await readPaint(page);
    expect(paint.vars.bg).toBe(THEMES.sepia.bg);
    expect(paint.vars.text).toBe(THEMES.sepia.text);
    expect(paint.vars.muted).toBe(THEMES.sepia.muted);
    expect(paint.vars.accent).toBe(THEMES.sepia.accent);
    expect(paint.dataTheme).toBe('sepia');
    expect(paint.dataCustomColors).toBe('false');
  });

  test('a corrupt stored hex degrades to the preset instead of painting an unreadable page', async ({
    page,
  }) => {
    await mountEngine(page);
    // The engine is the last line of defence: even if a mangled value reaches it, the page keeps
    // the reader's preset rather than going blank or transparent.
    await loadBook(page, {
      theme: 'warraq',
      customColors: { enabled: true, bg: '#12', text: '#F2E8D5' },
    });

    const paint = await readPaint(page);
    expect(paint.vars.bg).toBe(THEMES.warraq.bg);
    expect(paint.vars.text).toBe(THEMES.warraq.text);
    expect(paint.bodyBackground).toBe(rgbOf(THEMES.warraq.bg));
    expect(paint.dataCustomColors).toBe('false');

    // Same for an enabled flag that is not a boolean — no half-applied pair.
    await sendBridge(page, {
      type: 'settings',
      partial: { customColors: { enabled: 'yes', ...NIGHT } as never },
    });
    await expect.poll(async () => (await readPaint(page)).dataCustomColors).toBe('false');
    expect((await readPaint(page)).vars.bg).toBe(THEMES.warraq.bg);
  });

  test('the pair can be changed live and the text keeps its Arabic shaping and RTL direction', async ({
    page,
  }) => {
    await mountEngine(page);
    await loadBook(page, {
      theme: 'warraq',
      customColors: { enabled: true, ...WARRAQ },
    });

    await sendBridge(page, {
      type: 'settings',
      partial: { customColors: { enabled: true, ...NIGHT } },
    });
    await expect.poll(async () => (await readPaint(page)).bodyBackground).toBe(rgbOf(NIGHT.bg));

    const audit = await page.evaluate(() => {
      const paragraph = document.querySelector<HTMLElement>(
        '.chapter[aria-hidden="false"] .block-p',
      )!;
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      return {
        direction: getComputedStyle(paragraph).direction,
        text: (paragraph.textContent ?? '').replace(/\s+/g, ' ').trim(),
        rects: range.getClientRects().length,
        width: paragraph.getBoundingClientRect().width,
      };
    });

    // A colour change must not touch layout: still RTL, still one readable column of real Arabic.
    expect(audit.direction).toBe('rtl');
    expect(audit.text.length).toBeGreaterThan(40);
    expect(audit.rects).toBeGreaterThan(0);
    expect(audit.width).toBeGreaterThan(80);
  });
});
