import type {
  SceneDisplayMode,
  ScenePlaceholder,
  ScenePlaceholderStatus,
  ScenePromptParts,
} from './types.js';

/**
 * F46 — scene placeholders.
 *
 * Everything that makes a scene frame lives here: the model normaliser (so a message from
 * the host can never hand us an unsafe image URL), the DOM builder/updater, and the
 * structured prompt editor.
 *
 * The one invariant that shapes the whole file: **the frame's outer box never changes
 * with the status.** The sketchbook overlay, the poetic caption, the status line, the
 * shimmer and the action bar are all absolutely positioned *inside* a
 * `aspect-ratio`-sized `.scene-frame`, and the loaded image fills that same box. That is
 * what lets `idle → queued → generating → ready` happen while the reader is looking at
 * the page without a single paragraph moving underneath it.
 */

export const DEFAULT_SCENE_ASPECT_RATIO = 1.6;

/** `data:image/...` — only raster/svg image payloads are acceptable here. */
const SAFE_DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);/i;
const SAFE_HTTPS_RE = /^https:\/\//i;
const SAFE_FILE_RE = /^file:\/\//i;
/** Any other explicit scheme (`javascript:`, `data:text/html`, `blob:`, `vbscript:`…). */
const ANY_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

const SCENE_STATUSES: readonly ScenePlaceholderStatus[] = [
  'idle',
  'queued',
  'generating',
  'ready',
  'error',
];

const MAX_TEXT_LENGTH = 600;

function asText(value: unknown, max = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string') return '';
  // Strip C0/C1 control characters: they are meaningless here and are a classic way to
  // smuggle `java\nscript:` past a naive URL check.
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, max);
}

function asNonEmptyText(value: unknown, max = MAX_TEXT_LENGTH): string | undefined {
  const text = asText(value, max).trim();
  return text.length > 0 ? text : undefined;
}

/**
 * Is this image URL safe to put in an `<img src>`?
 *
 * Allowed: `data:image/(png|jpeg|jpg|webp|gif|svg+xml);…`, `https://…`, `file://…`, and
 * relative paths (`assets/scene.png`, `/covers/x.jpg`, `./x.webp`).
 * Rejected: `javascript:`, `data:text/html`, `vbscript:`, `blob:`, protocol-relative
 * `//host/…` (it inherits the page scheme and escapes the book), and any other scheme.
 */
export function isSafeSceneImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const url = value.trim();
  if (!url) return false;
  if (/[\u0000-\u001F\u007F]/.test(url)) return false;

  if (SAFE_DATA_IMAGE_RE.test(url)) return true;
  if (SAFE_HTTPS_RE.test(url)) return true;
  if (SAFE_FILE_RE.test(url)) return true;

  // Everything that carries a scheme is refused unless explicitly allowed above.
  if (ANY_SCHEME_RE.test(url)) return false;
  // `//evil.example/x.png` is protocol-relative, not a relative path.
  if (url.startsWith('//')) return false;

  return true;
}

export function normalizeScenePrompt(input: unknown): ScenePromptParts {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const prompt: ScenePromptParts = {
    setting: asText(raw.setting),
    mood: asText(raw.mood),
    characters: asText(raw.characters),
    style: asText(raw.style),
  };
  const note = asNonEmptyText(raw.note);
  if (note !== undefined) prompt.note = note;
  return prompt;
}

function normalizeAspectRatio(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SCENE_ASPECT_RATIO;
  }
  return Math.min(4, Math.max(0.4, value));
}

/**
 * Validate/sanitise one placeholder coming over the bridge.
 *
 * Returns `null` when the entry cannot be anchored (no id / no target block), so a broken
 * host payload can never produce an unattached frame floating at the top of a chapter.
 */
export function normalizeScenePlaceholder(input: unknown): ScenePlaceholder | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;

  const id = asNonEmptyText(raw.id, 120);
  const afterBlockId = asNonEmptyText(raw.afterBlockId, 160);
  if (!id || !afterBlockId) return null;

  const status = SCENE_STATUSES.includes(raw.status as ScenePlaceholderStatus)
    ? (raw.status as ScenePlaceholderStatus)
    : 'idle';

  const placeholder: ScenePlaceholder = {
    id,
    afterBlockId,
    caption: typeof raw.caption === 'string' ? raw.caption.slice(0, MAX_TEXT_LENGTH) : '',
    prompt: normalizeScenePrompt(raw.prompt),
    status,
    aspectRatio: normalizeAspectRatio(raw.aspectRatio),
    collapsed: raw.collapsed === true,
  };

  // An unsafe URL is dropped from the model entirely, not just from the DOM: nothing
  // downstream should be able to accidentally render it.
  if (isSafeSceneImageUrl(raw.imageUrl)) {
    placeholder.imageUrl = (raw.imageUrl as string).trim();
  }

  const errorMessage = asNonEmptyText(raw.errorMessage);
  if (errorMessage !== undefined) placeholder.errorMessage = errorMessage;

  return placeholder;
}

export function sceneStatusLabel(placeholder: ScenePlaceholder): string {
  switch (placeholder.status) {
    case 'queued':
      return 'في قائمة الانتظار';
    case 'generating':
      return 'جارٍ رسم المشهد…';
    case 'error':
      return placeholder.errorMessage || 'في قائمة الانتظار — يمكنك المحاولة لاحقاً';
    case 'ready':
    case 'idle':
    default:
      return '';
  }
}

export type SceneRenderOptions = {
  displayMode?: SceneDisplayMode;
  disableAnimation?: boolean;
};

function queryFigureParts(figure: HTMLElement) {
  return {
    frame: figure.querySelector<HTMLElement>('.scene-frame'),
    caption: figure.querySelector<HTMLElement>('[data-scene-caption]'),
    barCaption: figure.querySelector<HTMLElement>('.scene-collapsed-caption'),
    status: figure.querySelector<HTMLElement>('[data-scene-status]'),
    shimmer: figure.querySelector<HTMLElement>('.scene-shimmer'),
    actions: figure.querySelector<HTMLElement>('.scene-actions'),
    collapsedBar: figure.querySelector<HTMLElement>('.scene-collapsed-bar'),
    toggle: figure.querySelector<HTMLElement>('button[data-scene-action="toggle-collapse"]'),
    generate: figure.querySelector<HTMLButtonElement>('button[data-scene-action="generate"]'),
  };
}

/**
 * Apply a placeholder's state to an existing figure.
 *
 * Deliberately idempotent and cheap: a paginator batch append re-runs it on frames that
 * are already correct, and it must not restart the image fade-in or clone the node.
 */
export function applyScenePlaceholderState(
  figure: HTMLElement,
  placeholder: ScenePlaceholder,
  options: SceneRenderOptions = {},
): void {
  figure.setAttribute('data-scene-id', placeholder.id);
  figure.setAttribute('data-after-block-id', placeholder.afterBlockId);
  figure.setAttribute('data-status', placeholder.status);
  figure.setAttribute('data-collapsed', placeholder.collapsed ? 'true' : 'false');
  figure.hidden = options.displayMode === 'hidden';
  figure.classList.toggle('scene-no-anim', Boolean(options.disableAnimation));
  figure.style.setProperty(
    '--scene-aspect-ratio',
    String(normalizeAspectRatio(placeholder.aspectRatio)),
  );

  const parts = queryFigureParts(figure);

  // Caption: textContent only. A caption is book prose, never markup.
  if (parts.caption) parts.caption.textContent = placeholder.caption;
  if (parts.barCaption) parts.barCaption.textContent = placeholder.caption || 'مشهد';

  // Status line (absolute inside the frame → zero layout effect).
  const statusText = sceneStatusLabel(placeholder);
  if (parts.status) {
    parts.status.textContent = statusText;
    parts.status.setAttribute('data-visible', statusText ? 'true' : 'false');
  }

  // Shimmer only while generating; its animation is CSS, and `scene-no-anim` freezes it.
  if (parts.shimmer) {
    parts.shimmer.setAttribute(
      'aria-hidden',
      placeholder.status === 'generating' ? 'false' : 'true',
    );
  }

  // The collapse toggle lives in the action bar while expanded and moves into the pill
  // bar while collapsed — one button in the DOM at all times, in the right place.
  if (parts.toggle) {
    const target = placeholder.collapsed ? parts.collapsedBar : parts.actions;
    if (target && parts.toggle.parentElement !== target) target.appendChild(parts.toggle);
    parts.toggle.setAttribute(
      'aria-label',
      placeholder.collapsed ? 'تكبير المشهد' : 'طوي المشهد',
    );
    parts.toggle.textContent = placeholder.collapsed ? '⌄' : '⌃';
    parts.toggle.setAttribute(
      'title',
      placeholder.collapsed ? 'تكبير المشهد' : 'طوي المشهد',
    );
  }

  if (parts.collapsedBar) {
    parts.collapsedBar.setAttribute(
      'aria-hidden',
      placeholder.collapsed ? 'false' : 'true',
    );
  }

  // Image: only a status of `ready` with an allowlisted URL gets an <img>.
  const existingImg = figure.querySelector<HTMLImageElement>('img[data-scene-image]');
  const wantedSrc =
    placeholder.status === 'ready' && isSafeSceneImageUrl(placeholder.imageUrl)
      ? placeholder.imageUrl.trim()
      : null;

  if (wantedSrc === null) {
    existingImg?.remove();
  } else if (!existingImg) {
    const img = document.createElement('img');
    img.className = 'scene-image';
    img.setAttribute('data-scene-image', '');
    img.alt = placeholder.caption;
    img.decoding = 'async';
    img.loading = 'eager';
    img.draggable = false;
    img.style.opacity = '0';
    img.src = wantedSrc;
    parts.frame?.appendChild(img);

    const reveal = () => {
      img.style.opacity = '1';
    };
    if (options.disableAnimation) {
      reveal();
    } else {
      img.addEventListener('load', reveal, { once: true });
      img.addEventListener('error', reveal, { once: true });
      window.requestAnimationFrame(reveal);
    }
  } else if (existingImg.getAttribute('src') !== wantedSrc) {
    existingImg.alt = placeholder.caption;
    existingImg.style.opacity = '0';
    existingImg.src = wantedSrc;
    if (options.disableAnimation) {
      existingImg.style.opacity = '1';
    } else {
      const reveal = () => {
        existingImg.style.opacity = '1';
      };
      existingImg.addEventListener('load', reveal, { once: true });
      existingImg.addEventListener('error', reveal, { once: true });
      window.requestAnimationFrame(reveal);
    }
  }

  // Busy states disable the CTA; a ready frame hides it (a regenerate action would live
  // in the host's UI, and hiding cannot change the frame size).
  if (parts.generate) {
    const busy = placeholder.status === 'queued' || placeholder.status === 'generating';
    parts.generate.disabled = busy;
    parts.generate.setAttribute('aria-disabled', busy ? 'true' : 'false');
    parts.generate.hidden = placeholder.status === 'ready';
  }
}

/** Build a fully-rendered figure for one placeholder (used on mount and by the probe). */
export function createScenePlaceholderElement(
  placeholder: ScenePlaceholder,
  options: SceneRenderOptions = {},
): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'scene-placeholder';
  // Static structure only — no host data is ever interpolated into this markup. Caption,
  // status, prompt and image are applied afterwards through textContent / properties.
  figure.innerHTML = `
    <div class="scene-frame">
      <div class="scene-sketch" aria-hidden="true"><span class="scene-sketch-mark">✧</span></div>
      <div class="scene-shimmer" aria-hidden="true"></div>
      <div class="scene-caption-overlay"><span class="scene-caption" data-scene-caption></span></div>
      <div class="scene-status-layer"><span class="scene-status" data-scene-status></span></div>
      <div class="scene-actions">
        <button class="scene-action scene-generate" type="button" data-scene-action="generate">✨ ارسم هذا المشهد</button>
        <button class="scene-action scene-edit" type="button" data-scene-action="edit-prompt" aria-label="تعديل وصف المشهد" title="تعديل وصف المشهد">✎</button>
        <button class="scene-action scene-collapse-toggle" type="button" data-scene-action="toggle-collapse" aria-label="طوي المشهد" title="طوي المشهد">⌃</button>
      </div>
    </div>
    <div class="scene-collapsed-bar" aria-hidden="true"><span class="scene-collapsed-caption"></span></div>
  `;
  applyScenePlaceholderState(figure, placeholder, options);
  return figure;
}

/**
 * Make the figures inside one chapter root exactly match `placeholders`.
 *
 * Used by the live chapter (after every mount/batch append) and by the offscreen
 * measurement probe — which is why it only looks at direct children: a probe chapter is a
 * throwaway copy and the paginator must measure the same HTML the reader will see.
 *
 * Existing figures with a matching id are reused (moved if needed) instead of rebuilt, so
 * an in-flight image fade survives a batch append.
 */
export function syncScenePlaceholdersInRoot(
  root: HTMLElement,
  placeholders: readonly ScenePlaceholder[],
  options: SceneRenderOptions = {},
): void {
  const blocks = new Map<string, HTMLElement>();
  const existing = new Map<string, HTMLElement>();

  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.classList.contains('scene-placeholder')) {
      const id = child.getAttribute('data-scene-id');
      if (id && !existing.has(id)) existing.set(id, child);
      continue;
    }
    const blockId = child.getAttribute('data-block-id');
    if (blockId) blocks.set(blockId, child);
  }

  // Desired frames grouped by their anchor, preserving the host's order.
  // Even in `hidden` mode we keep the figures in the DOM with `hidden` (`display: none`),
  // so toggling hidden ↔ expanded preserves decoded images and reflows cleanly.
  const desiredByBlock = new Map<string, ScenePlaceholder[]>();
  for (const placeholder of placeholders) {
    if (!placeholder || typeof placeholder.id !== 'string') continue;
    if (!blocks.has(placeholder.afterBlockId)) continue;
    const list = desiredByBlock.get(placeholder.afterBlockId);
    if (list) list.push(placeholder);
    else desiredByBlock.set(placeholder.afterBlockId, [placeholder]);
  }

  const placed = new Set<string>();
  for (const [blockId, list] of desiredByBlock) {
    const blockEl = blocks.get(blockId);
    if (!blockEl) continue;
    let prev: HTMLElement = blockEl;
    for (const placeholder of list) {
      let figure = existing.get(placeholder.id) ?? null;
      if (!figure) {
        figure = createScenePlaceholderElement(placeholder, options);
      } else {
        applyScenePlaceholderState(figure, placeholder, options);
      }
      // `insertAdjacentElement` moves an existing node, so this both orders and reuses.
      if (prev.nextElementSibling !== figure) prev.insertAdjacentElement('afterend', figure);
      placed.add(placeholder.id);
      prev = figure;
    }
  }

  // Anything left over is stale: hidden mode, an unmounted anchor, or a removed scene.
  for (const [id, figure] of existing) {
    if (!placed.has(id)) figure.remove();
  }
}

function escapeAttributeSelectorValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Find the live figure for one scene id under an arbitrary root. */
export function findScenePlaceholderElement(
  root: ParentNode,
  sceneId: string,
): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `figure.scene-placeholder[data-scene-id="${escapeAttributeSelectorValue(sceneId)}"]`,
  );
}

// ---------------------------------------------------------------------------
// Structured prompt editor
// ---------------------------------------------------------------------------

/**
 * The prompt editor overlay.
 *
 * Mounted directly on `#reader-root` and `position: fixed`, exactly like the footnote
 * sheet: opening it never touches the paginated DOM, so pagination cannot shift.
 */
export class ScenePromptEditor {
  private readonly rootEl: HTMLElement;
  private el: HTMLElement | null = null;
  private sceneId: string | null = null;

  constructor(rootEl: HTMLElement) {
    this.rootEl = rootEl;
  }

  isOpen(): boolean {
    return this.el !== null && this.el.isConnected;
  }

  getSceneId(): string | null {
    return this.sceneId;
  }

  get element(): HTMLElement | null {
    return this.el;
  }

  open(placeholder: ScenePlaceholder, dir: 'rtl' | 'ltr' = 'rtl'): void {
    this.close();
    const overlay = document.createElement('div');
    overlay.className = 'scene-prompt-editor';
    overlay.setAttribute('data-scene-prompt-editor', '');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'وصف المشهد');
    overlay.setAttribute('dir', dir);
    overlay.innerHTML = `
      <div class="scene-prompt-panel" role="document">
        <div class="scene-prompt-header"><span class="scene-prompt-title">تعديل وصف المشهد</span></div>
        <label class="scene-field"><span>الزمان والمكان</span><input type="text" name="setting" autocomplete="off" /></label>
        <label class="scene-field"><span>المزاج</span><input type="text" name="mood" autocomplete="off" /></label>
        <label class="scene-field"><span>الشخصيات</span><input type="text" name="characters" autocomplete="off" /></label>
        <label class="scene-field"><span>الأسلوب</span><input type="text" name="style" autocomplete="off" /></label>
        <label class="scene-field"><span>ملاحظة</span><textarea name="note" rows="2"></textarea></label>
        <div class="scene-prompt-actions">
          <button class="scene-action scene-save" type="button" data-scene-action="save-prompt">حفظ</button>
          <button class="scene-action scene-cancel" type="button" data-scene-action="cancel-prompt">إلغاء</button>
        </div>
      </div>
    `;

    const setValue = (name: string, value: string | undefined) => {
      const field = overlay.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `[name="${name}"]`,
      );
      if (field) field.value = value ?? '';
    };
    setValue('setting', placeholder.prompt.setting);
    setValue('mood', placeholder.prompt.mood);
    setValue('characters', placeholder.prompt.characters);
    setValue('style', placeholder.prompt.style);
    setValue('note', placeholder.prompt.note);

    this.sceneId = placeholder.id;
    this.el = overlay;
    this.rootEl.appendChild(overlay);

    const first = overlay.querySelector<HTMLInputElement>('input[name="setting"]');
    // Focus after the frame that mounted it, so the keyboard does not fight the paint.
    window.requestAnimationFrame(() => first?.focus());
  }

  readPrompt(): ScenePromptParts {
    if (!this.el) return { setting: '', mood: '', characters: '', style: '' };
    const read = (name: string): string => {
      const field = this.el?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `[name="${name}"]`,
      );
      return field?.value ?? '';
    };
    return normalizeScenePrompt({
      setting: read('setting'),
      mood: read('mood'),
      characters: read('characters'),
      style: read('style'),
      note: read('note'),
    });
  }

  close(): void {
    this.el?.remove();
    this.el = null;
    this.sceneId = null;
  }
}
