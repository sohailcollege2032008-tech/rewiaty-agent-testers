import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook, type Book } from '../../book-format/src/index.js';
import type {
  RNToWebMessage,
  ScenePlaceholder,
  ScenePromptParts,
  WebToRNMessage,
} from '../src/types.js';

/**
 * F46 — scene placeholder.
 *
 * The placeholder is a sketchbook frame that sits immediately after the paragraph which
 * describes the event. Its whole reason to exist is that the AI image may take seconds
 * (or fail): the frame must therefore keep EXACTLY the same outer box in every state
 * (`idle` → `queued` → `generating` → `ready` → `error`) so nothing below it moves, no
 * page is re-paginated, and the reader never loses their place.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readerHtmlUrl = pathToFileURL(path.resolve(__dirname, '../dist/reader.html')).href;

test.use({ hasTouch: true });

/** 1×1 transparent PNG: a real, decodable image that cannot fail to load. */
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const ARABIC_PARA =
  'كَانَتِ الرِّيَاحُ تَهُبُّ بِهُدُوءٍ فَوْقَ الْمِينَاءِ الْقَدِيمِ، حَيْثُ تَرْتَطِمُ الْأَمْوَاجُ بِأَخْشَابِ الْمَرَاكِبِ وَيَتَأَمَّلُ سَلِيمٌ أَوْرَاقَ وَالِدِهِ الْمَكْتُوبَةَ بِعِنَايَةٍ.';

const ENGLISH_PARA =
  'The wind moved quietly over the old harbour, where the waves struck the hulls of the moored boats while Saleem studied his father’s carefully written papers.';

/** Short first paragraphs so the placeholder lands inside the very first page. */
function buildBook(dir: 'rtl' | 'ltr' = 'rtl'): Book {
  if (dir === 'ltr') {
    const lines = ['---', 'title: "A Scene in the Chapter"', 'lang: en', 'dir: ltr', '---', ''];
    for (let c = 1; c <= 2; c++) {
      lines.push(`# Chapter ${c}`, '');
      for (let p = 1; p <= 26; p++) {
        lines.push(p <= 2 ? `Short paragraph ${c}.${p} to pin the scene.` : `${ENGLISH_PARA} (${c}.${p})`, '');
      }
    }
    return parseBook(lines.join('\n'), 'scene-placeholder-ltr.md');
  }
  const lines = ['---', 'title: "مَشْهَدٌ فِي الْفَصْلِ"', 'lang: ar', 'dir: rtl', '---', ''];
  for (let c = 1; c <= 2; c++) {
    lines.push(`# الْفَصْلُ رَقْمُ ${c}`, '');
    for (let p = 1; p <= 26; p++) {
      lines.push(p <= 2 ? `فَقْرَةٌ قَصِيرَةٌ ${c}.${p} لِتَثْبِيتِ الْمَشْهَدِ.` : `${ARABIC_PARA} (${c}.${p})`, '');
    }
  }
  return parseBook(lines.join('\n'), 'scene-placeholder.md');
}

const PROMPT: ScenePromptParts = {
  setting: 'ميناء قديم عند الفجر',
  mood: 'حنين هادئ',
  characters: 'سليم وأبوه',
  style: 'حبر وورق حرفي',
};

function makePlaceholder(overrides: Partial<ScenePlaceholder> = {}): ScenePlaceholder {
  return {
    id: 'scene-1',
    afterBlockId: 'ch01_p0002',
    caption: 'حَيْثُ تَرْتَطِمُ الْأَمْوَاجُ بِأَخْشَابِ الْمَرَاكِبِ',
    prompt: PROMPT,
    status: 'idle',
    aspectRatio: 1.6,
    collapsed: false,
    ...overrides,
  };
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

async function messages(page: Page): Promise<WebToRNMessage[]> {
  return page.evaluate(
    () => (window as unknown as { __bridgeMessages: WebToRNMessage[] }).__bridgeMessages,
  );
}

async function messageCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __bridgeMessages: unknown[] }).__bridgeMessages.length,
  );
}

type Position = Extract<WebToRNMessage, { type: 'position' }>;

async function latestPosition(page: Page): Promise<Position | null> {
  const all = await messages(page);
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i];
    if (m?.type === 'position') return m;
  }
  return null;
}

async function loadWithPlaceholder(
  page: Page,
  placeholders: ScenePlaceholder[] = [makePlaceholder()],
  dir: 'rtl' | 'ltr' = 'rtl',
): Promise<void> {
  const before = await messageCount(page);
  await sendBridge(page, {
    type: 'load',
    book: buildBook(dir),
    settings: { disableAnimation: true, fontSize: 20, lineHeight: 1.95 },
    scenePlaceholders: placeholders,
    sceneDisplayMode: 'expanded',
  });
  // Wait for the position belonging to THIS load.
  await expect
    .poll(
      async () =>
        page.evaluate(
          (from) =>
            (window as unknown as { __bridgeMessages: Array<{ type?: string }> })
              .__bridgeMessages.slice(from)
              .some((m) => m?.type === 'position'),
          before,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect(page.locator('figure.scene-placeholder')).toHaveCount(placeholders.length);
}

/** Outer box + the next block's top: the two things that must not move on a status change. */
type LayoutSample = {
  width: number;
  height: number;
  nextTop: number;
  chapterPageCount: number;
  pageCount: number;
};

async function sampleLayout(page: Page): Promise<LayoutSample> {
  const box = await page.evaluate(() => {
    const figure = document.querySelector<HTMLElement>('figure.scene-placeholder');
    if (!figure) return null;
    const rect = figure.getBoundingClientRect();
    const nextBlock = figure.nextElementSibling as HTMLElement | null;
    const nextRect = nextBlock?.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      nextTop: nextRect ? nextRect.top : Number.NaN,
    };
  });
  if (!box) throw new Error('scene placeholder vanished');
  const pos = await latestPosition(page);
  return {
    ...box,
    chapterPageCount: pos?.chapterPageCount ?? -1,
    pageCount: pos?.pageCount ?? -1,
  };
}

async function updateStatus(page: Page, status: ScenePlaceholder['status'], extra: Partial<ScenePlaceholder> = {}): Promise<void> {
  await sendBridge(page, { type: 'scene-update', placeholder: makePlaceholder({ status, ...extra }) });
  await expect
    .poll(async () =>
      page.evaluate(() => document.querySelector('figure.scene-placeholder')?.getAttribute('data-status')),
    )
    .toBe(status);
  // Let a reflow (if any) settle before measuring.
  await page.waitForTimeout(120);
}

test.describe('F46 scene placeholder', () => {
  test('renders immediately after its target block inside the chapter, in every state', async ({
    page,
  }) => {
    await mountEngine(page);
    await loadWithPlaceholder(page);

    const info = await page.evaluate(() => {
      const block = document.querySelector<HTMLElement>('[data-block-id="ch01_p0002"]');
      const figure = document.querySelector<HTMLElement>('figure.scene-placeholder');
      if (!block || !figure) return null;
      return {
        after: block.nextElementSibling === figure,
        sameChapter: block.parentElement === figure.parentElement,
        hasFrame: Boolean(figure.querySelector('.scene-frame')),
        hasCaption: figure.querySelector('[data-scene-caption]')?.textContent ?? null,
        hasStatus: Boolean(figure.querySelector('[data-scene-status]')),
        hasGenerate: Boolean(figure.querySelector('button[data-scene-action="generate"]')),
        hasEdit: Boolean(figure.querySelector('button[data-scene-action="edit-prompt"]')),
        hasToggle: Boolean(figure.querySelector('button[data-scene-action="toggle-collapse"]')),
        collapsed: figure.getAttribute('data-collapsed'),
        breakInside: getComputedStyle(figure).breakInside,
      };
    });

    expect(info).not.toBeNull();
    expect(info!.after).toBe(true);
    expect(info!.sameChapter).toBe(true);
    expect(info!.hasFrame).toBe(true);
    expect(info!.hasCaption).toBe(makePlaceholder().caption);
    expect(info!.hasStatus).toBe(true);
    expect(info!.hasGenerate).toBe(true);
    expect(info!.hasEdit).toBe(true);
    expect(info!.hasToggle).toBe(true);
    expect(info!.collapsed).toBe('false');
    expect(info!.breakInside).toBe('avoid');
  });

  test('idle → queued → generating → ready never changes the box, the next block or the page count', async ({
    page,
  }) => {
    await mountEngine(page);
    await loadWithPlaceholder(page);

    const idle = await sampleLayout(page);
    expect(idle.height).toBeGreaterThan(40);

    await updateStatus(page, 'queued');
    const queued = await sampleLayout(page);
    await expect(page.locator('[data-scene-status]')).toHaveText('في قائمة الانتظار');

    await updateStatus(page, 'generating');
    const generating = await sampleLayout(page);
    await expect(page.locator('[data-scene-status]')).toHaveText('جارٍ رسم المشهد…');
    await expect(page.locator('.scene-shimmer')).toBeVisible();

    await updateStatus(page, 'ready', { imageUrl: PNG_DATA_URL });
    const ready = await sampleLayout(page);
    await expect(page.locator('img.scene-image[data-scene-image]')).toHaveCount(1);

    await updateStatus(page, 'error', { errorMessage: 'تعذّر الرسم الآن' });
    const error = await sampleLayout(page);
    await expect(page.locator('[data-scene-status]')).toHaveText('تعذّر الرسم الآن');

    for (const [name, sample] of Object.entries({ queued, generating, ready, error })) {
      expect(sample.width, `${name} width`).toBeCloseTo(idle.width, 1);
      expect(sample.height, `${name} height`).toBeCloseTo(idle.height, 1);
      expect(sample.nextTop, `${name} next block top`).toBeCloseTo(idle.nextTop, 1);
      expect(sample.chapterPageCount, `${name} chapter page count`).toBe(idle.chapterPageCount);
      expect(sample.pageCount, `${name} book page count`).toBe(idle.pageCount);
    }
  });

  test('the CTA emits scene-generate with the structured prompt; busy states disable it', async ({
    page,
  }) => {
    await mountEngine(page);
    await loadWithPlaceholder(page);

    await page.locator('button[data-scene-action="generate"]').click();

    await expect
      .poll(async () => {
        const all = await messages(page);
        return all.some((m) => m.type === 'scene-generate');
      })
      .toBe(true);

    const generate = (await messages(page)).find((m) => m.type === 'scene-generate');
    expect(generate).toEqual({ type: 'scene-generate', sceneId: 'scene-1', prompt: PROMPT });

    await updateStatus(page, 'queued');
    await expect(page.locator('button[data-scene-action="generate"]')).toBeDisabled();

    await updateStatus(page, 'generating');
    await expect(page.locator('button[data-scene-action="generate"]')).toBeDisabled();
  });

  test('the pencil opens a structured editor without touching pagination and save emits scene-prompt-edit', async ({
    page,
  }) => {
    await mountEngine(page);
    await loadWithPlaceholder(page);

    const before = await sampleLayout(page);

    await page.locator('button[data-scene-action="edit-prompt"]').click();
    const editor = page.locator('[data-scene-prompt-editor]');
    await expect(editor).toBeVisible();

    // The editor is an overlay on #reader-root: opening it must not reflow the page.
    const whileOpen = await sampleLayout(page);
    expect(whileOpen.width).toBeCloseTo(before.width, 1);
    expect(whileOpen.height).toBeCloseTo(before.height, 1);
    expect(whileOpen.nextTop).toBeCloseTo(before.nextTop, 1);
    expect(whileOpen.pageCount).toBe(before.pageCount);

    await expect(page.locator('[data-scene-prompt-editor] input[name="setting"]')).toHaveValue(
      PROMPT.setting,
    );
    await expect(page.locator('[data-scene-prompt-editor] input[name="mood"]')).toHaveValue(
      PROMPT.mood,
    );
    await expect(page.locator('[data-scene-prompt-editor] input[name="characters"]')).toHaveValue(
      PROMPT.characters,
    );
    await expect(page.locator('[data-scene-prompt-editor] input[name="style"]')).toHaveValue(
      PROMPT.style,
    );

    await page.locator('[data-scene-prompt-editor] input[name="setting"]').fill('غرفة المكتبة');
    await page.locator('[data-scene-prompt-editor] textarea[name="note"]').fill('ضوء شمعة');
    await page.locator('[data-scene-prompt-editor] button[data-scene-action="save-prompt"]').click();

    await expect(editor).toHaveCount(0);

    await expect
      .poll(async () => {
        const all = await messages(page);
        return all.some((m) => m.type === 'scene-prompt-edit');
      })
      .toBe(true);

    const edit = (await messages(page)).find((m) => m.type === 'scene-prompt-edit');
    expect(edit).toEqual({
      type: 'scene-prompt-edit',
      sceneId: 'scene-1',
      prompt: { ...PROMPT, setting: 'غرفة المكتبة', note: 'ضوء شمعة' },
    });

    // A later generate uses the edited prompt (the local prompt really was updated).
    await page.locator('button[data-scene-action="generate"]').click();
    await expect
      .poll(async () => {
        const all = await messages(page);
        const generate = all.filter((m) => m.type === 'scene-generate').pop();
        return generate?.type === 'scene-generate' ? generate.prompt.setting : '';
      })
      .toBe('غرفة المكتبة');
  });

  test('collapse turns the frame into a pill bar, reflows, and emits scene-toggle-collapse', async ({
    page,
  }) => {
    await mountEngine(page);
    await loadWithPlaceholder(page);

    const expanded = await sampleLayout(page);
    await page.locator('button[data-scene-action="toggle-collapse"]').click();

    await expect(page.locator('figure.scene-placeholder')).toHaveAttribute(
      'data-collapsed',
      'true',
    );
    await expect
      .poll(async () => {
        const all = await messages(page);
        return all.some(
          (m) => m.type === 'scene-toggle-collapse' && m.collapsed === true,
        );
      })
      .toBe(true);

    await page.waitForTimeout(200);
    const collapsed = await sampleLayout(page);
    expect(collapsed.height).toBeLessThan(expanded.height / 2);
    expect(collapsed.width).toBeCloseTo(expanded.width, 1);

    // Expanding again is possible from the collapsed bar and restores the frame.
    await page.locator('button[data-scene-action="toggle-collapse"]').click();
    await expect(page.locator('figure.scene-placeholder')).toHaveAttribute(
      'data-collapsed',
      'false',
    );
    await page.waitForTimeout(200);
    const expandedAgain = await sampleLayout(page);
    expect(expandedAgain.height).toBeCloseTo(expanded.height, 1);
    expect(expandedAgain.nextTop).toBeCloseTo(expanded.nextTop, 1);
  });

  test('scene-display-mode hidden hides every frame and reflows; collapsed collapses all', async ({
    page,
  }) => {
    await mountEngine(page);
    await loadWithPlaceholder(page);

    const expanded = await sampleLayout(page);

    await sendBridge(page, { type: 'scene-display-mode', mode: 'hidden' });
    await expect(page.locator('figure.scene-placeholder')).toBeHidden();
    await page.waitForTimeout(200);
    const hidden = await page.evaluate(() => {
      const block = document.querySelector<HTMLElement>('[data-block-id="ch01_p0003"]');
      return block ? block.getBoundingClientRect().top : Number.NaN;
    });
    expect(hidden).toBeLessThan(expanded.nextTop);

    await sendBridge(page, { type: 'scene-display-mode', mode: 'expanded' });
    await expect(page.locator('figure.scene-placeholder')).toBeVisible();
    await page.waitForTimeout(200);
    const restored = await sampleLayout(page);
    expect(restored.height).toBeCloseTo(expanded.height, 1);

    await sendBridge(page, { type: 'scene-display-mode', mode: 'collapsed' });
    await expect(page.locator('figure.scene-placeholder')).toHaveAttribute(
      'data-collapsed',
      'true',
    );
  });

  test('scenes arriving later through scene-placeholders mount without a reload', async ({ page }) => {
    await mountEngine(page);
    await loadWithPlaceholder(page, []);

    await expect(page.locator('figure.scene-placeholder')).toHaveCount(0);

    await sendBridge(page, {
      type: 'scene-placeholders',
      placeholders: [makePlaceholder({ id: 'scene-b', afterBlockId: 'ch01_p0004' })],
      displayMode: 'expanded',
    });

    await expect(page.locator('figure.scene-placeholder')).toHaveCount(1);
    const placed = await page.evaluate(() => {
      const block = document.querySelector<HTMLElement>('[data-block-id="ch01_p0004"]');
      const figure = document.querySelector<HTMLElement>('figure.scene-placeholder');
      return Boolean(block && figure && block.nextElementSibling === figure);
    });
    expect(placed).toBe(true);
  });

  test('captions are inert text and unsafe image URLs never become an <img>', async ({ page }) => {
    await mountEngine(page);
    const xssCaption = '<img src=x onerror="window.__pwned=1">حبر';
    await loadWithPlaceholder(page, [
      makePlaceholder({ caption: xssCaption }),
    ]);

    const captionText = await page.locator('[data-scene-caption]').textContent();
    expect(captionText).toBe(xssCaption);
    await expect(page.locator('[data-scene-caption] img')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();

    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>window.__pwned=2</script>',
      'vbscript:msgbox(1)',
    ]) {
      await updateStatus(page, 'ready', { imageUrl: bad });
      await expect(page.locator('img.scene-image')).toHaveCount(0);
    }

    // A data:image is allowed and does render.
    await updateStatus(page, 'ready', { imageUrl: PNG_DATA_URL });
    await expect(page.locator('img.scene-image[data-scene-image]')).toHaveCount(1);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test('tapping the frame or the prompt editor never turns a page or toggles the HUD', async ({
    page,
  }) => {
    await mountEngine(page);
    await loadWithPlaceholder(page);

    const before = await messageCount(page);
    const box = await page.locator('figure.scene-placeholder').boundingBox();
    expect(box).not.toBeNull();
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForTimeout(250);

    const after = await page.evaluate((from) =>
      (window as unknown as { __bridgeMessages: Array<{ type?: string }> })
        .__bridgeMessages.slice(from)
        .map((m) => m?.type),
      before,
    );
    expect(after).not.toContain('tap');
    expect(after).not.toContain('selection');
    expect(after).not.toContain('highlight-tap');

    // Same for the prompt editor overlay.
    await page.locator('button[data-scene-action="edit-prompt"]').click();
    const editorBefore = await messageCount(page);
    await page.locator('[data-scene-prompt-editor]').click({ position: { x: 8, y: 8 } });
    await page.waitForTimeout(200);
    const editorAfter = await page.evaluate((from) =>
      (window as unknown as { __bridgeMessages: Array<{ type?: string }> })
        .__bridgeMessages.slice(from)
        .map((m) => m?.type),
      editorBefore,
    );
    expect(editorAfter).not.toContain('tap');
  });

  // -------------------------------------------------------------------------
  // Codex review findings (P2/P2/P3)
  // -------------------------------------------------------------------------

  /**
   * F1 [P2] — one scene's status change must not touch another scene's collapse.
   *
   * `updateScenePlaceholder` used to broadcast `collapsed` across the whole scene list, so a
   * `generating` → `ready` update for scene-a silently expanded the collapsed scene-b with
   * no repagination (the frame grew over the text below it).
   */
  test('updating one scene never uncollapses another collapsed scene, and never repaginates', async ({
    page,
  }) => {
    await mountEngine(page);

    const sceneA = makePlaceholder({ id: 'scene-a', afterBlockId: 'ch01_p0002' });
    const sceneB = makePlaceholder({
      id: 'scene-b',
      afterBlockId: 'ch01_p0004',
      caption: 'مَشْهَدُ الْمَرْكَبِ الْعَائِدِ عِنْدَ الْغُرُوبِ',
    });
    await loadWithPlaceholder(page, [sceneA, sceneB]);

    const figureA = page.locator('figure.scene-placeholder[data-scene-id="scene-a"]');
    const figureB = page.locator('figure.scene-placeholder[data-scene-id="scene-b"]');
    const barB = figureB.locator('.scene-collapsed-bar');

    // Collapse scene-b only.
    await figureB.locator('button[data-scene-action="toggle-collapse"]').click();
    await expect(figureB).toHaveAttribute('data-collapsed', 'true');
    await expect(figureA).toHaveAttribute('data-collapsed', 'false');

    await expect
      .poll(async () => (await latestPosition(page))?.estimated, { timeout: 15_000 })
      .toBe(false);
    await page.waitForTimeout(150);

    const before = await latestPosition(page);
    const barBefore = await barB.boundingBox();
    expect(before).not.toBeNull();
    expect(barBefore).not.toBeNull();

    const pushA = async (
      status: ScenePlaceholder['status'],
      extra: Partial<ScenePlaceholder> = {},
    ): Promise<void> => {
      await sendBridge(page, {
        type: 'scene-update',
        placeholder: { ...sceneA, status, ...extra },
      });
      await expect(figureA).toHaveAttribute('data-status', status);
      await page.waitForTimeout(120);
    };

    await pushA('generating');
    await expect(figureB).toHaveAttribute('data-collapsed', 'true');

    await pushA('ready', { imageUrl: PNG_DATA_URL });
    await expect(page.locator('img.scene-image[data-scene-image]')).toHaveCount(1);

    // The untouched scene keeps its collapsed pill bar, its state and its geometry.
    await expect(figureB).toHaveAttribute('data-collapsed', 'true');
    await expect(barB).toBeVisible();
    const barAfter = await barB.boundingBox();
    expect(barAfter!.height).toBeCloseTo(barBefore!.height, 1);
    expect(barAfter!.width).toBeCloseTo(barBefore!.width, 1);

    // scene-a really did update, and it is still expanded.
    await expect(figureA).toHaveAttribute('data-collapsed', 'false');
    await expect(figureA.locator('[data-scene-status]')).toHaveText('');

    // No reflow happened: the page map and the reader's page are unchanged.
    const after = await latestPosition(page);
    expect(after!.pageCount).toBe(before!.pageCount);
    expect(after!.page).toBe(before!.page);
    expect(after!.chapterPage).toBe(before!.chapterPage);
  });

  /**
   * F2 [P2] — reader keyboard shortcuts must never run while the prompt editor is open.
   *
   * The editor is a form: ArrowLeft/ArrowRight/PageDown/PageUp belong to the caret and the
   * panel's own scroll. Falling through to `goNext`/`goPrev` turned a page behind the overlay.
   */
  for (const dir of ['rtl', 'ltr'] as const) {
    test(`reader paging shortcuts never fire while the prompt editor is open (${dir})`, async ({
      page,
    }) => {
      await mountEngine(page);
      await loadWithPlaceholder(page, [makePlaceholder()], dir);

      const before = await latestPosition(page);
      expect(before!.pageCount).toBeGreaterThan(1);

      await page.locator('button[data-scene-action="edit-prompt"]').click();
      const editor = page.locator('[data-scene-prompt-editor]');
      await expect(editor).toBeVisible();

      const field = page.locator('[data-scene-prompt-editor] input[name="setting"]');
      await field.click();
      await expect(field).toBeFocused();

      const countBefore = await messageCount(page);

      for (const key of ['ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp']) {
        await page.keyboard.press(key);
        await page.waitForTimeout(80);
        await expect(editor, `${key} must not close the editor`).toBeVisible();
        const pos = await latestPosition(page);
        expect(pos!.page, `${key} must not turn the page`).toBe(before!.page);
        expect(pos!.chapterId, `${key} must not leave the chapter`).toBe(before!.chapterId);
      }

      const countAfter = await messageCount(page);
      const newMessages = await page.evaluate(
        (from) =>
          (window as unknown as { __bridgeMessages: Array<{ type?: string }> })
            .__bridgeMessages.slice(from)
            .map((m) => m?.type),
        countBefore,
      );
      expect(countAfter).toBeGreaterThanOrEqual(countBefore);
      expect(newMessages).not.toContain('position');

      // Escape is the editor's own gesture: it closes it, and it must not page either.
      await page.keyboard.press('Escape');
      await expect(editor).toHaveCount(0);
      const settled = await latestPosition(page);
      expect(settled!.page).toBe(before!.page);
    });
  }

  /**
   * F3 [P3] — the collapsed pill bar reserves clearance on the LOGICAL end.
   *
   * The expand toggle is pinned with `inset-inline-end`, so in RTL it sits on the LEFT. A
   * physical `padding-right` put the 40px clearance on the wrong side and a long Arabic
   * caption ran under the button.
   */
  test('a long RTL caption clears the collapse toggle by logical, not physical, padding', async ({
    page,
  }) => {
    await mountEngine(page);

    const longCaption =
      'كَانَتِ الرِّيَاحُ تَهُبُّ بِهُدُوءٍ فَوْقَ الْمِينَاءِ الْقَدِيمِ حَيْثُ تَرْتَطِمُ الْأَمْوَاجُ بِأَخْشَابِ الْمَرَاكِبِ وَيَتَأَمَّلُ سَلِيمٌ أَوْرَاقَ وَالِدِهِ الْمَكْتُوبَةَ بِعِنَايَةٍ كَبِيرَةٍ جِدًّا';
    await loadWithPlaceholder(page, [makePlaceholder({ caption: longCaption })]);

    await page.locator('button[data-scene-action="toggle-collapse"]').click();
    await expect(page.locator('figure.scene-placeholder')).toHaveAttribute(
      'data-collapsed',
      'true',
    );
    await page.waitForTimeout(250);

    const box = await page.evaluate(() => {
      const figure = document.querySelector<HTMLElement>('figure.scene-placeholder');
      const bar = figure?.querySelector<HTMLElement>('.scene-collapsed-bar');
      const caption = figure?.querySelector<HTMLElement>('.scene-collapsed-caption');
      const toggle = figure?.querySelector<HTMLElement>('button[data-scene-action="toggle-collapse"]');
      if (!figure || !bar || !caption || !toggle) return null;
      const style = getComputedStyle(bar);
      const captionRect = caption.getBoundingClientRect();
      const toggleRect = toggle.getBoundingClientRect();
      return {
        direction: getComputedStyle(figure).direction,
        paddingInlineStart: style.paddingInlineStart,
        paddingInlineEnd: style.paddingInlineEnd,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        caption: {
          left: captionRect.left,
          right: captionRect.right,
          width: captionRect.width,
          clipped: caption.scrollWidth > caption.clientWidth + 1,
        },
        toggle: { left: toggleRect.left, right: toggleRect.right, width: toggleRect.width },
      };
    });

    expect(box).not.toBeNull();
    expect(box!.direction).toBe('rtl');

    // Logical padding: 14px on the reading start, 40px reserved on the end (the toggle side).
    expect(box!.paddingInlineEnd).toBe('40px');
    expect(box!.paddingInlineStart).toBe('14px');
    // In an RTL box the logical end is the physical left.
    expect(box!.paddingLeft).toBe('40px');
    expect(box!.paddingRight).toBe('14px');

    // The caption really is too long for the bar (so the clearance is load-bearing).
    expect(box!.caption.clipped).toBe(true);
    expect(box!.toggle.width).toBeGreaterThan(0);

    // …and it never overlaps the expand button.
    const overlapX =
      Math.min(box!.caption.right, box!.toggle.right) -
      Math.max(box!.caption.left, box!.toggle.left);
    expect(
      overlapX,
      `caption ${JSON.stringify(box!.caption)} vs toggle ${JSON.stringify(box!.toggle)}`,
    ).toBeLessThanOrEqual(0);
  });
});
