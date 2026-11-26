/**
 * F46 — Scene Placeholder: blind acceptance cover.
 *
 * These tests are written ONLY from the F46 specification and its RN ↔ Web wire
 * contract. They deliberately do not import anything from `src/scene*` — the contract
 * types live in this file so the suite type-checks (and states the contract) before the
 * feature is integrated. Against a branch without F46 every test here fails; against a
 * faithful implementation they must pass.
 *
 * The feature under test: a "sketchbook" figure pinned immediately after a paragraph,
 * with a poetic caption and a `✨ ارسم هذا المشهد` CTA, a structured prompt editor, a
 * collapsed state and a global hide/expand switch — all without moving pagination.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { parseBook, type Anchor, type Book } from '../../book-format/src/index.js';

// ---------------------------------------------------------------------------
// F46 wire contract (local, so this file is standalone and cannot drift with src)
// ---------------------------------------------------------------------------

type ScenePromptParts = {
  setting: string;
  mood: string;
  characters: string;
  style: string;
  note?: string;
};

type ScenePlaceholderStatus = 'idle' | 'queued' | 'generating' | 'ready' | 'error';

type ScenePlaceholder = {
  id: string;
  afterBlockId: string;
  caption: string;
  prompt: ScenePromptParts;
  status: ScenePlaceholderStatus;
  aspectRatio?: number;
  imageUrl?: string;
  errorMessage?: string;
  collapsed?: boolean;
};

type SceneDisplayMode = 'expanded' | 'collapsed' | 'hidden';

type SceneLoadMessage = {
  type: 'load';
  book: Book;
  anchor?: Anchor;
  settings?: Record<string, unknown>;
  fontBaseUrl?: string;
  scenePlaceholders?: ScenePlaceholder[];
  sceneDisplayMode?: SceneDisplayMode;
};

type SceneGotoMessage = { type: 'goto'; page?: number; anchor?: Anchor; chapterId?: string };

type ScenePlaceholdersMessage = {
  type: 'scene-placeholders';
  placeholders: ScenePlaceholder[];
  displayMode?: SceneDisplayMode;
};

type SceneUpdateMessage = { type: 'scene-update'; placeholder: ScenePlaceholder };

type SceneDisplayModeMessage = { type: 'scene-display-mode'; mode: SceneDisplayMode };

type SceneRNToWebMessage =
  | SceneLoadMessage
  | SceneGotoMessage
  | ScenePlaceholdersMessage
  | SceneUpdateMessage
  | SceneDisplayModeMessage
  | { type: 'settings'; partial: Record<string, unknown> }
  | { type: 'clear-selection' }
  | { type: 'next' }
  | { type: 'prev' };

type ScenePositionMessage = {
  type: 'position';
  anchor: Anchor;
  chapterId: string;
  page: number;
  pageCount: number;
  chapterPage: number;
  chapterPageCount: number;
  bookProgress: number;
  spread: boolean;
  estimated: boolean;
};

type SceneGenerateMessage = {
  type: 'scene-generate';
  sceneId: string;
  prompt: ScenePromptParts;
};

type ScenePromptEditMessage = {
  type: 'scene-prompt-edit';
  sceneId: string;
  prompt: ScenePromptParts;
};

type SceneToggleCollapseMessage = {
  type: 'scene-toggle-collapse';
  sceneId: string;
  collapsed: boolean;
};

type SceneWebToRNMessage =
  | { type: 'ready' }
  | ScenePositionMessage
  | { type: 'tap'; zone: string }
  | { type: 'error'; message: string }
  | SceneGenerateMessage
  | ScenePromptEditMessage
  | SceneToggleCollapseMessage;

type BoxRect = { top: number; left: number; width: number; height: number };

// ---------------------------------------------------------------------------
// Fixtures & harness (same shape as highlights.spec.ts / footnote-popover.spec.ts)
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readerHtmlUrl = pathToFileURL(path.resolve(__dirname, '../dist/reader.html')).href;
const sampleArText = fs.readFileSync(path.resolve(__dirname, 'fixtures/sample-ar.md'), 'utf8');
const fontsDirUrl = pathToFileURL(path.resolve(__dirname, '../../../apps/mobile/assets/fonts')).href + '/';

const SCENE_ID = 'scene-1';
const AFTER_BLOCK_ID = 'ch01_p0001';
const CAPTION =
  'وَقَفَ سَلِيمٌ عِنْدَ حَافَّةِ الرَّصِيفِ، وَالْبَحْرُ يَهْمِسُ لَهُ حِكَايَةً قَدِيمَةً لَمْ تَنْتَهِ بَعْدُ.';

const BASE_PROMPT: ScenePromptParts = {
  setting: 'مِينَاءٌ قَدِيمٌ عِنْدَ الْفَجْرِ',
  mood: 'حَنِينٌ هَادِئٌ وَرَائِحَةُ مِلْحٍ',
  characters: 'سَلِيمٌ وَحْدَهُ أَمَامَ الْمَاءِ',
  style: 'حِبْرٌ مَائِيٌّ دَافِئٌ',
};

const CALM_ERROR = 'تَعَذَّرَ رَسْمُ الْمَشْهَدِ الآنَ، وَلَكِنَّ الْحِكَايَةَ مَا زَالَتْ فِي مَكَانِهَا.';

// A tiny, valid image with exactly the 1.6 aspect ratio requested in test 4.
const SCENE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">' +
  '<rect width="320" height="200" fill="#4E342E"/>' +
  '<circle cx="160" cy="100" r="42" fill="#E5B842"/>' +
  '</svg>';
const SCENE_IMAGE_URL = `data:image/svg+xml;base64,${Buffer.from(SCENE_SVG, 'utf8').toString('base64')}`;

test.use({ hasTouch: true });

function makeScene(overrides: Partial<ScenePlaceholder> = {}): ScenePlaceholder {
  return {
    id: SCENE_ID,
    afterBlockId: AFTER_BLOCK_ID,
    caption: CAPTION,
    prompt: { ...BASE_PROMPT },
    status: 'idle',
    aspectRatio: 1.6,
    ...overrides,
  };
}

function sceneSelector(sceneId: string): string {
  return `figure.scene-placeholder[data-scene-id="${sceneId}"]`;
}

async function mountEngine(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as {
      __bridgeMessages: SceneWebToRNMessage[];
      ReactNativeWebView: { postMessage: (data: string) => void };
    };
    win.__bridgeMessages = [];
    win.ReactNativeWebView = {
      postMessage(data: string) {
        try {
          win.__bridgeMessages.push(JSON.parse(data) as SceneWebToRNMessage);
        } catch {
          // ignore malformed payloads
        }
      },
    };
  });
  await page.goto(readerHtmlUrl);
  await page.waitForSelector('#reader-stage');
}

async function sendBridge(page: Page, msg: SceneRNToWebMessage): Promise<void> {
  await page.evaluate((payload) => {
    window.postMessage(JSON.stringify(payload), '*');
  }, msg);
}

async function getMessages(page: Page): Promise<SceneWebToRNMessage[]> {
  return page.evaluate(
    () => (window as unknown as { __bridgeMessages: SceneWebToRNMessage[] }).__bridgeMessages,
  );
}

async function getLatestPosition(page: Page): Promise<ScenePositionMessage | null> {
  const msgs = await getMessages(page);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (msg?.type === 'position') return msg;
  }
  return null;
}

async function lastMessageOfType<T extends SceneWebToRNMessage['type']>(
  page: Page,
  type: T,
  since: number,
): Promise<Extract<SceneWebToRNMessage, { type: T }> | null> {
  const msgs = await getMessages(page);
  const matching = msgs.slice(since).filter((m) => m.type === type);
  const last = matching[matching.length - 1];
  return (last as Extract<SceneWebToRNMessage, { type: T }> | undefined) ?? null;
}

async function waitForMessage<T extends SceneWebToRNMessage['type']>(
  page: Page,
  type: T,
  since = 0,
): Promise<Extract<SceneWebToRNMessage, { type: T }>> {
  await expect
    .poll(async () => (await lastMessageOfType(page, type, since)) !== null, { timeout: 5_000 })
    .toBe(true);
  const msg = await lastMessageOfType(page, type, since);
  if (!msg) throw new Error(`expected a ${type} message from the reader`);
  return msg;
}

async function loadSceneBook(
  page: Page,
  placeholders: ScenePlaceholder[],
  displayMode: SceneDisplayMode = 'expanded',
): Promise<void> {
  const book = parseBook(sampleArText, 'sample-ar.md');
  await sendBridge(page, {
    type: 'load',
    book,
    fontBaseUrl: fontsDirUrl,
    settings: { disableAnimation: true, fontFamily: 'Amiri', fontSize: 20 },
    scenePlaceholders: placeholders,
    sceneDisplayMode: displayMode,
  });
  await expect.poll(async () => (await getLatestPosition(page))?.page, { timeout: 15_000 }).toBe(1);
}

/** Wait until the exact pagination pass has measured every chapter (no estimate left). */
async function waitForExactLayout(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect
    .poll(async () => (await getLatestPosition(page))?.estimated, { timeout: 15_000 })
    .toBe(false);
}

async function gotoPage(page: Page, target: number): Promise<void> {
  await sendBridge(page, { type: 'goto', page: target });
  await expect
    .poll(async () => (await getLatestPosition(page))?.page, { timeout: 5_000 })
    .toBe(target);
}

/** Whether the whole figure sits inside the visible page for the current page. */
async function sceneFullyOnStage(page: Page, sceneId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const fig = document.querySelector<HTMLElement>(`figure.scene-placeholder[data-scene-id="${id}"]`);
    const stage = document.getElementById('reader-stage');
    if (!fig || !stage) return false;
    const r = fig.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.top >= s.top - 1 &&
      r.bottom <= s.bottom + 1 &&
      r.left >= s.left - 1 &&
      r.right <= s.right + 1
    );
  }, sceneId);
}

/** Navigate to the page the placeholder is actually drawn on; returns that page number. */
async function gotoScene(page: Page, sceneId: string): Promise<number> {
  const position = await getLatestPosition(page);
  const total = position?.pageCount ?? 1;
  for (let p = 1; p <= total; p++) {
    await gotoPage(page, p);
    if (await sceneFullyOnStage(page, sceneId)) return p;
  }
  throw new Error(`scene ${sceneId} is never fully visible on any of the ${total} pages`);
}

async function sceneAttr(page: Page, sceneId: string, name: string): Promise<string | null> {
  return page.getAttribute(sceneSelector(sceneId), name);
}

async function waitForStatus(
  page: Page,
  sceneId: string,
  status: ScenePlaceholderStatus,
): Promise<void> {
  await expect
    .poll(async () => sceneAttr(page, sceneId, 'data-status'), { timeout: 5_000 })
    .toBe(status);
}

/** A real touch tap at the centre of an element (touch → pointer → click, like a finger). */
async function tapElement(page: Page, selector: string): Promise<void> {
  const point = await page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  expect(point, `element is not hittable: ${selector}`).not.toBeNull();
  await page.touchscreen.tap(point!.x, point!.y);
}

async function assertInsideStage(page: Page, selector: string): Promise<void> {
  const audit = await page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    const stage = document.getElementById('reader-stage');
    if (!el || !stage) return null;
    const r = el.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return {
      inside:
        r.top >= s.top - 1 &&
        r.bottom <= s.bottom + 1 &&
        r.left >= s.left - 1 &&
        r.right <= s.right + 1,
      rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      stage: { top: s.top, left: s.left, width: s.width, height: s.height },
    };
  }, selector);
  expect(audit, `missing ${selector}`).not.toBeNull();
  expect(audit!.inside, `${selector} is clipped by the stage: ${JSON.stringify(audit)}`).toBe(true);
}

type SceneSnapshot = {
  scene: BoxRect;
  next: BoxRect | null;
  page: number;
  pageCount: number;
  anchor: string;
};

async function snapshotScene(page: Page, sceneId: string): Promise<SceneSnapshot> {
  const geometry = await page.evaluate((id) => {
    const box = (el: Element | null): BoxRect | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    };
    const fig = document.querySelector<HTMLElement>(`figure.scene-placeholder[data-scene-id="${id}"]`);
    const sibling = fig?.nextElementSibling ?? null;
    const next = sibling instanceof HTMLElement && sibling.classList.contains('block-p') ? sibling : null;
    return { scene: box(fig), next: box(next) };
  }, sceneId);

  expect(geometry.scene, `scene ${sceneId} is not in the DOM`).not.toBeNull();
  const position = await getLatestPosition(page);
  expect(position, 'the reader never reported a position').not.toBeNull();

  return {
    scene: geometry.scene!,
    next: geometry.next,
    page: position!.page,
    pageCount: position!.pageCount,
    anchor: `${position!.anchor.blockId}@${position!.anchor.charOffset}`,
  };
}

function expectRectStable(label: string, before: BoxRect, after: BoxRect, tolerance = 1): void {
  expect(Math.abs(after.width - before.width), `${label}: width shifted`).toBeLessThanOrEqual(
    tolerance,
  );
  expect(Math.abs(after.height - before.height), `${label}: height shifted`).toBeLessThanOrEqual(
    tolerance,
  );
  expect(Math.abs(after.top - before.top), `${label}: top shifted`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(after.left - before.left), `${label}: left shifted`).toBeLessThanOrEqual(
    tolerance,
  );
}

// ---------------------------------------------------------------------------
// 1. Placement & sketchbook UI
// ---------------------------------------------------------------------------

test.describe('F46 scene placeholder — blind acceptance', () => {
  test('1. renders immediately after afterBlockId with the poetic caption and generate CTA', async ({
    page,
  }) => {
    await mountEngine(page);
    const scene = makeScene();
    await loadSceneBook(page, [scene]);

    const figure = page.locator(sceneSelector(scene.id));
    await expect(figure).toHaveCount(1);
    await expect(figure).toBeVisible();

    // DOM placement is part of the contract: the figure is the very next sibling of the
    // block it belongs to, inside the same (visible) chapter.
    const relation = await page.evaluate(
      ({ sceneId, afterBlockId }) => {
        const block = document.querySelector<HTMLElement>(
          `.chapter [data-block-id="${afterBlockId}"]`,
        );
        const fig = document.querySelector<HTMLElement>(
          `figure.scene-placeholder[data-scene-id="${sceneId}"]`,
        );
        if (!block || !fig) return null;
        const chapter = fig.closest('.chapter');
        return {
          nextSibling: block.nextElementSibling === fig,
          previousSibling: fig.previousElementSibling === block,
          sameParent: block.parentElement === fig.parentElement,
          chapterId: chapter?.getAttribute('data-chapter-id') ?? null,
          chapterVisible: chapter?.getAttribute('aria-hidden') === 'false',
        };
      },
      { sceneId: scene.id, afterBlockId: scene.afterBlockId },
    );

    expect(relation).toEqual({
      nextSibling: true,
      previousSibling: true,
      sameParent: true,
      chapterId: 'ch01',
      chapterVisible: true,
    });

    await expect(figure).toHaveAttribute('data-after-block-id', scene.afterBlockId);
    await expect(figure).toHaveAttribute('data-status', 'idle');
    await expect(figure).toHaveAttribute('data-collapsed', 'false');

    // The sketchbook face: a poetic Arabic caption and the generate CTA.
    await expect(page.locator(`${sceneSelector(scene.id)} [data-scene-caption]`)).toContainText(
      CAPTION,
    );
    const cta = page.locator(`${sceneSelector(scene.id)} button[data-scene-action="generate"]`);
    await expect(cta).toBeVisible();
    await expect(cta).toContainText('✨ ارسم هذا المشهد');
  });

  // -------------------------------------------------------------------------
  // 2. Generate action & gesture isolation
  // -------------------------------------------------------------------------

  test('2. generate emits scene-generate with the wire prompt and never turns the page', async ({
    page,
  }) => {
    await mountEngine(page);
    const scene = makeScene();
    await loadSceneBook(page, [scene]);
    const scenePage = await gotoScene(page, scene.id);

    const ctaSelector = `${sceneSelector(scene.id)} button[data-scene-action="generate"]`;
    await assertInsideStage(page, ctaSelector);

    const since = (await getMessages(page)).length;
    await tapElement(page, ctaSelector);

    const generate = await waitForMessage(page, 'scene-generate', since);
    expect(generate).toEqual({ type: 'scene-generate', sceneId: scene.id, prompt: scene.prompt });

    // A tap on the CTA is the CTA's gesture, not the reader's tap zone: the same finger
    // must not turn the page, and the engine must not report a page tap.
    const after = (await getMessages(page)).slice(since);
    expect(after.some((m) => m.type === 'tap'), 'generate must not emit a page tap').toBe(false);
    expect((await getLatestPosition(page))?.page, 'generate must not turn the page').toBe(scenePage);
  });

  // -------------------------------------------------------------------------
  // 3. Structured prompt editor
  // -------------------------------------------------------------------------

  test('3. the prompt editor is prefilled, saves structured parts, and generate uses the edit', async ({
    page,
  }) => {
    await mountEngine(page);
    const scene = makeScene();
    await loadSceneBook(page, [scene]);
    await gotoScene(page, scene.id);

    const baseline = await snapshotScene(page, scene.id);
    const anchorBefore = (await getLatestPosition(page))!.anchor;

    await tapElement(page, `${sceneSelector(scene.id)} button[data-scene-action="edit-prompt"]`);

    const editor = page.locator('[data-scene-prompt-editor]');
    await expect(editor).toBeVisible();
    await expect(editor.locator('input[name="setting"]')).toHaveValue(scene.prompt.setting);
    await expect(editor.locator('input[name="mood"]')).toHaveValue(scene.prompt.mood);
    await expect(editor.locator('input[name="characters"]')).toHaveValue(
      scene.prompt.characters,
    );
    await expect(editor.locator('input[name="style"]')).toHaveValue(scene.prompt.style);
    await expect(editor.locator('textarea[name="note"]')).toHaveValue('');

    // Opening the editor is not a reflow: the page count, the placeholder box and the
    // paragraph after it stay exactly where they were.
    const opened = await snapshotScene(page, scene.id);
    expect(opened.pageCount, 'opening the editor changed the page count').toBe(baseline.pageCount);
    expect(opened.page, 'opening the editor moved the reader').toBe(baseline.page);
    expectRectStable('placeholder while the editor is open', baseline.scene, opened.scene);
    if (baseline.next) {
      expect(opened.next, 'the paragraph after the placeholder vanished').not.toBeNull();
      expectRectStable(
        'next paragraph while the editor is open',
        baseline.next,
        opened.next!,
      );
    }
    const anchorWhileOpen = (await getLatestPosition(page))!.anchor;
    expect(anchorWhileOpen.blockId).toBe(anchorBefore.blockId);
    expect(anchorWhileOpen.charOffset).toBe(anchorBefore.charOffset);

    const updated: ScenePromptParts = {
      setting: 'غُرْفَةٌ صَغِيرَةٌ فَوْقَ الْمِينَاءِ',
      mood: 'تَرَقُّبٌ لَطِيفٌ قَبْلَ الْإِبْحَارِ',
      characters: 'سَلِيمٌ وَالشَّيْخُ مَحْمُودٌ',
      style: 'أَلْوَانُ مَائِيَّةٍ بَاهِتَةٌ',
      note: 'أَضِفْ ضَوْءَ فَانُوسٍ وَاحِدٍ عَلَى الطَّاوِلَةِ.',
    };

    await editor.locator('input[name="setting"]').fill(updated.setting);
    await editor.locator('input[name="mood"]').fill(updated.mood);
    await editor.locator('input[name="characters"]').fill(updated.characters);
    await editor.locator('input[name="style"]').fill(updated.style);
    await editor.locator('textarea[name="note"]').fill(updated.note ?? '');

    const sinceSave = (await getMessages(page)).length;
    await tapElement(page, '[data-scene-prompt-editor] button[data-scene-action="save-prompt"]');

    const edit = await waitForMessage(page, 'scene-prompt-edit', sinceSave);
    expect(edit).toEqual({ type: 'scene-prompt-edit', sceneId: scene.id, prompt: updated });
    await expect(editor).toBeHidden();

    // The next generate click carries the saved structured prompt, not the original one.
    const sinceGenerate = (await getMessages(page)).length;
    await tapElement(page, `${sceneSelector(scene.id)} button[data-scene-action="generate"]`);
    const generated = await waitForMessage(page, 'scene-generate', sinceGenerate);
    expect(generated).toEqual({
      type: 'scene-generate',
      sceneId: scene.id,
      prompt: updated,
    });

    // Cancelling an edit throws the draft away and keeps the saved prompt intact.
    await tapElement(page, `${sceneSelector(scene.id)} button[data-scene-action="edit-prompt"]`);
    await expect(editor).toBeVisible();
    await editor.locator('input[name="setting"]').fill('نَصٌّ مُلْغًى لَا يَجِبُ أَنْ يُحْفَظَ');
    const sinceCancel = (await getMessages(page)).length;
    await tapElement(page, '[data-scene-prompt-editor] button[data-scene-action="cancel-prompt"]');
    await expect(editor).toBeHidden();
    expect(
      (await getMessages(page)).slice(sinceCancel).some((m) => m.type === 'scene-prompt-edit'),
      'cancel must not save the draft',
    ).toBe(false);

    await tapElement(page, `${sceneSelector(scene.id)} button[data-scene-action="generate"]`);
    const afterCancel = await waitForMessage(page, 'scene-generate', sinceCancel);
    expect(afterCancel).toEqual({
      type: 'scene-generate',
      sceneId: scene.id,
      prompt: updated,
    });
  });

  // -------------------------------------------------------------------------
  // 4. Zero layout shift proof with pagination
  // -------------------------------------------------------------------------

  test('4. queued → generating → ready → error shifts nothing: geometry, pageCount and anchor hold', async ({
    page,
  }) => {
    await mountEngine(page);
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    await loadSceneBook(page, [makeScene({ aspectRatio: 1.6 })]);
    await waitForExactLayout(page);
    await gotoScene(page, SCENE_ID);

    const baseline = await snapshotScene(page, SCENE_ID);
    expect(baseline.scene.height, 'the placeholder must reserve real height').toBeGreaterThan(40);
    expect(baseline.scene.width, 'the placeholder must have width').toBeGreaterThan(40);
    expect(baseline.next, 'the placeholder must be followed by a paragraph').not.toBeNull();

    let current = makeScene({ aspectRatio: 1.6 });
    const steps: Array<{ status: ScenePlaceholderStatus; patch: Partial<ScenePlaceholder> }> = [
      { status: 'queued', patch: {} },
      { status: 'generating', patch: {} },
      { status: 'ready', patch: { imageUrl: SCENE_IMAGE_URL } },
      { status: 'error', patch: { errorMessage: CALM_ERROR } },
    ];

    for (const step of steps) {
      current = { ...current, status: step.status, ...step.patch };
      await sendBridge(page, { type: 'scene-update', placeholder: current });
      await waitForStatus(page, SCENE_ID, step.status);

      const selector = sceneSelector(SCENE_ID);

      if (step.status === 'queued') {
        await expect(page.locator(`${selector} [data-scene-status]`)).toContainText(
          'في قائمة الانتظار',
        );
      }

      if (step.status === 'generating') {
        await expect
          .poll(
            async () =>
              page.evaluate((sel) => {
                const shimmer = document.querySelector<HTMLElement>(`${sel} .scene-shimmer`);
                if (!shimmer) return false;
                const style = getComputedStyle(shimmer);
                const r = shimmer.getBoundingClientRect();
                return (
                  style.display !== 'none' &&
                  style.visibility !== 'hidden' &&
                  r.width > 0 &&
                  r.height > 0
                );
              }, selector),
            { timeout: 5_000 },
          )
          .toBe(true);
      }

      if (step.status === 'ready') {
        await expect
          .poll(
            async () =>
              page.evaluate((sel) => {
                const img = document.querySelector<HTMLImageElement>(
                  `${sel} img[data-scene-image]`,
                );
                return Boolean(img && img.complete && img.naturalWidth > 0);
              }, selector),
            { timeout: 5_000 },
          )
          .toBe(true);

        const image = await page.evaluate((sel) => {
          const img = document.querySelector<HTMLImageElement>(`${sel} img[data-scene-image]`);
          if (!img) return null;
          const r = img.getBoundingClientRect();
          return {
            width: r.width,
            height: r.height,
            ratio: r.height > 0 ? r.width / r.height : 0,
          };
        }, selector);
        expect(image, 'ready status must render img[data-scene-image]').not.toBeNull();
        expect(
          Math.abs(image!.ratio - 1.6),
          `requested aspectRatio 1.6, rendered ${image!.width}x${image!.height}`,
        ).toBeLessThan(0.08);
      }

      if (step.status === 'error') {
        const calm = await page.locator(`${selector} [data-scene-status]`).innerText();
        expect(calm.trim().length, 'an error needs a calm, human status line').toBeGreaterThan(4);
        expect(dialogs, 'a scene error must never raise an alert dialog').toEqual([]);
        await expect(page.locator(`${selector} img[data-scene-image]`)).toHaveCount(0);
      }

      const snap = await snapshotScene(page, SCENE_ID);
      expect(snap.pageCount, `pageCount changed on ${step.status}`).toBe(baseline.pageCount);
      expect(snap.page, `current page changed on ${step.status}`).toBe(baseline.page);
      expect(snap.anchor, `anchor changed on ${step.status}`).toBe(baseline.anchor);
      expectRectStable(`placeholder in ${step.status}`, baseline.scene, snap.scene);
      expect(snap.next, `the paragraph after the placeholder vanished in ${step.status}`).not.toBeNull();
      expectRectStable(
        `following paragraph in ${step.status}`,
        baseline.next!,
        snap.next!,
      );
    }
  });

  // -------------------------------------------------------------------------
  // 5. Collapse & global hide/expand
  // -------------------------------------------------------------------------

  test('5. collapse shrinks the sketch without clipping lines, and hidden hides every placeholder', async ({
    page,
  }) => {
    await mountEngine(page);
    const scene = makeScene();
    await loadSceneBook(page, [scene]);
    await gotoScene(page, scene.id);

    const expanded = await snapshotScene(page, scene.id);
    const figure = page.locator(sceneSelector(scene.id));
    const collapseCta = `${sceneSelector(scene.id)} button[data-scene-action="toggle-collapse"]`;
    await assertInsideStage(page, collapseCta);

    const sinceCollapse = (await getMessages(page)).length;
    await tapElement(page, collapseCta);
    await expect(figure).toHaveAttribute('data-collapsed', 'true');

    const collapseMsg = await waitForMessage(page, 'scene-toggle-collapse', sinceCollapse);
    expect(collapseMsg).toEqual({
      type: 'scene-toggle-collapse',
      sceneId: scene.id,
      collapsed: true,
    });

    const collapsed = await snapshotScene(page, scene.id);
    expect(collapsed.pageCount, 'collapsing must not change the page count').toBe(
      expanded.pageCount,
    );
    expect(collapsed.anchor, 'collapsing must not move the reader').toBe(expanded.anchor);
    expect(
      collapsed.scene.height,
      'a collapsed placeholder must be significantly shorter',
    ).toBeLessThan(expanded.scene.height - 16);
    expect(collapsed.scene.height).toBeLessThan(expanded.scene.height * 0.8);
    await assertInsideStage(page, sceneSelector(scene.id));

    // Pagination stays clean: the paragraph below is still fully inside the page height
    // (no line sliced by the column edge).
    const clipping = await page.evaluate((sel) => {
      const fig = document.querySelector<HTMLElement>(sel);
      const stage = document.getElementById('reader-stage');
      const next = fig?.nextElementSibling instanceof HTMLElement ? fig.nextElementSibling : null;
      if (!next || !stage) return null;
      const r = next.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      return {
        verticallyInside: r.top >= s.top - 1 && r.bottom <= s.bottom + 1,
        rect: { top: r.top, bottom: r.bottom },
        stage: { top: s.top, bottom: s.bottom },
      };
    }, sceneSelector(scene.id));
    expect(clipping).not.toBeNull();
    expect(
      clipping!.verticallyInside,
      `a collapsed sketch clipped the following paragraph: ${JSON.stringify(clipping)}`,
    ).toBe(true);

    // Expanding again restores the exact original box.
    const sinceExpand = (await getMessages(page)).length;
    await tapElement(page, collapseCta);
    await expect(figure).toHaveAttribute('data-collapsed', 'false');
    const expandMsg = await waitForMessage(page, 'scene-toggle-collapse', sinceExpand);
    expect(expandMsg).toEqual({
      type: 'scene-toggle-collapse',
      sceneId: scene.id,
      collapsed: false,
    });
    const restored = await snapshotScene(page, scene.id);
    expect(Math.abs(restored.scene.height - expanded.scene.height)).toBeLessThanOrEqual(1);
    expect(restored.pageCount).toBe(expanded.pageCount);

    // Global hide: every scene disappears; expand brings it back.
    await sendBridge(page, { type: 'scene-display-mode', mode: 'hidden' });
    await expect(figure).toHaveCount(1);
    await expect(figure).toBeHidden();
    const hiddenAudit = await page.evaluate((sel) => {
      const fig = document.querySelector<HTMLElement>(sel);
      if (!fig) return null;
      const r = fig.getBoundingClientRect();
      return { display: getComputedStyle(fig).display, width: r.width, height: r.height };
    }, sceneSelector(scene.id));
    expect(hiddenAudit).not.toBeNull();
    expect(
      hiddenAudit!.display === 'none' || hiddenAudit!.width === 0 || hiddenAudit!.height === 0,
      `hidden mode left the sketch painted: ${JSON.stringify(hiddenAudit)}`,
    ).toBe(true);

    await sendBridge(page, { type: 'scene-display-mode', mode: 'expanded' });
    await expect(figure).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 6. Graceful degradation & XSS safety
  // -------------------------------------------------------------------------

  test('6. queued/error speak calmly and hostile caption, prompt and imageUrl never execute', async ({
    page,
  }) => {
    await mountEngine(page);
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    const XSS_CAPTION = '<img src=x onerror="window.__xss=1">';
    const XSS_TEXT = '<img src=x onerror="window.__xssPrompt=1">';
    const XSS_IMAGE_URL = 'javascript:alert(1)';

    const scenarios: ScenePlaceholder[] = [
      makeScene({ id: 'scene-queued', status: 'queued' }),
      makeScene({
        id: 'scene-error',
        afterBlockId: 'ch01_p0002',
        status: 'error',
        errorMessage: CALM_ERROR,
      }),
      makeScene({ id: 'scene-xss-caption', afterBlockId: 'ch01_p0003', caption: XSS_CAPTION }),
      makeScene({
        id: 'scene-xss-prompt',
        afterBlockId: 'ch01_p0004',
        prompt: {
          setting: XSS_TEXT,
          mood: XSS_TEXT,
          characters: XSS_TEXT,
          style: XSS_TEXT,
          note: XSS_TEXT,
        },
      }),
      makeScene({
        id: 'scene-xss-image',
        afterBlockId: 'ch01_p0005',
        status: 'ready',
        imageUrl: XSS_IMAGE_URL,
      }),
    ];

    await loadSceneBook(page, scenarios);

    // (a) queued has a human queue line.
    await waitForStatus(page, 'scene-queued', 'queued');
    await expect(
      page.locator(`${sceneSelector('scene-queued')} [data-scene-status]`),
    ).toContainText('في قائمة الانتظار');

    // (b) error is calm: a real sentence, no alert dialog.
    await waitForStatus(page, 'scene-error', 'error');
    const errorLine = await page
      .locator(`${sceneSelector('scene-error')} [data-scene-status]`)
      .innerText();
    expect(errorLine.trim().length).toBeGreaterThan(4);
    expect(errorLine).not.toContain('[object');
    expect(dialogs).toEqual([]);

    // (c) a hostile caption is text, not markup.
    const captionAudit = await page.evaluate((sel) => {
      const caption = document.querySelector<HTMLElement>(`${sel} [data-scene-caption]`);
      if (!caption) return null;
      return {
        text: caption.textContent,
        childImages: caption.querySelectorAll('img').length,
        decodedImages: document.querySelectorAll('img[src="x"]').length,
      };
    }, sceneSelector('scene-xss-caption'));
    expect(captionAudit).not.toBeNull();
    expect(captionAudit!.text, 'the caption must keep the raw string as text').toBe(XSS_CAPTION);
    expect(captionAudit!.childImages, 'caption markup must be escaped').toBe(0);
    expect(captionAudit!.decodedImages, 'the caption must not create an <img src=x>').toBe(0);

    // (d) a hostile imageUrl must never reach an <img> as a javascript: URL.
    const imageAudit = await page.evaluate((sel) => {
      const fig = document.querySelector<HTMLElement>(sel);
      if (!fig) return null;
      return Array.from(fig.querySelectorAll('img')).map((img) => img.getAttribute('src') ?? '');
    }, sceneSelector('scene-xss-image'));
    expect(imageAudit).not.toBeNull();
    expect(
      imageAudit!.filter((src) => src.trim().toLowerCase().startsWith('javascript:')),
      'javascript: imageUrl must never render as an image source',
    ).toEqual([]);

    // (e) hostile prompt parts are values in the editor, and saving them does not execute.
    await gotoScene(page, 'scene-xss-prompt');
    await tapElement(
      page,
      `${sceneSelector('scene-xss-prompt')} button[data-scene-action="edit-prompt"]`,
    );
    const editor = page.locator('[data-scene-prompt-editor]');
    await expect(editor).toBeVisible();
    await expect(editor.locator('input[name="setting"]')).toHaveValue(XSS_TEXT);
    await expect(editor.locator('input[name="mood"]')).toHaveValue(XSS_TEXT);
    await expect(editor.locator('input[name="characters"]')).toHaveValue(XSS_TEXT);
    await expect(editor.locator('input[name="style"]')).toHaveValue(XSS_TEXT);
    await expect(editor.locator('textarea[name="note"]')).toHaveValue(XSS_TEXT);

    const sinceSave = (await getMessages(page)).length;
    await tapElement(page, '[data-scene-prompt-editor] button[data-scene-action="save-prompt"]');
    const saved = await waitForMessage(page, 'scene-prompt-edit', sinceSave);
    expect(saved).toEqual({
      type: 'scene-prompt-edit',
      sceneId: 'scene-xss-prompt',
      prompt: {
        setting: XSS_TEXT,
        mood: XSS_TEXT,
        characters: XSS_TEXT,
        style: XSS_TEXT,
        note: XSS_TEXT,
      },
    });

    // Nothing executed anywhere along the way.
    const executed = await page.evaluate(() => {
      const w = window as unknown as { __xss?: number; __xssPrompt?: number };
      return {
        caption: w.__xss ?? null,
        prompt: w.__xssPrompt ?? null,
        strayHandlerImages: document.querySelectorAll('img[onerror]').length,
        javascriptImages: document.querySelectorAll('img[src^="javascript:"]').length,
      };
    });
    expect(executed.caption, 'the caption payload executed').toBeNull();
    expect(executed.prompt, 'the prompt payload executed').toBeNull();
    expect(executed.strayHandlerImages).toBe(0);
    expect(executed.javascriptImages).toBe(0);
    expect(dialogs).toEqual([]);
  });
});
