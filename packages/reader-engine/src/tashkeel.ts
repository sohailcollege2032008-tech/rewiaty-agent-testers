/**
 * F18 — التَّشكيل (Arabic diacritics) display modes.
 *
 * The modes are applied **at render time, on text nodes only**: the book's HTML and every
 * attribute stay exactly as parsed, and no `<span>` is ever wrapped around a word — doing
 * that breaks Arabic shaping (letters lose their joining forms at every split) and it also
 * invalidates the character offsets the search index and the bookmarks store.
 *
 * The reader's anchor however must stay in **original text coordinates** (the text the
 * book file contains, which is what FTS and the bookmarks address). So every display
 * offset is converted back to the original one before it is reported, and every incoming
 * anchor is converted to the displayed coordinates before it is measured. The two pure
 * functions below own that mapping and are unit-tested against the project samples.
 */

export type TashkeelMode = 'full' | 'none' | 'shadda-tanween';

/**
 * Arabic combining marks (harakat, tanween, shadda, sukun) plus the Quranic annotation
 * marks. Deliberately the same set the search normaliser folds, minus tatweel (U+0640),
 * which is a letter-stretching character and not a diacritic.
 *
 * - U+064B..U+064D tanween (fathatan, dammatan, kasratan)
 * - U+064E..U+0650 fatha, damma, kasra
 * - U+0651 shadda
 * - U+0652 sukun
 * - U+0653..U+0655 maddah, hamza above, hamza below
 * - U+0656..U+065F subscript alef … (extended harakat)
 * - U+0670 superscript alef
 * - U+06D6..U+06ED Quranic annotation signs
 */
const FULL_MARKS_RE = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
/** Same set as {@link FULL_MARKS_RE} but keeping tanween (U+064B..U+064D) and shadda (U+0651). */
const HARAKAT_ONLY_RE = /[\u064E-\u0650\u0652-\u065F\u0670\u06D6-\u06ED]/g;

/** true when `code` is one of the marks the reader may hide. */
export function isTashkeelMark(code: number): boolean {
  return (
    (code >= 0x064b && code <= 0x065f) || code === 0x0670 || (code >= 0x06d6 && code <= 0x06ed)
  );
}

/**
 * true when the mode hides this mark.
 *
 * `shadda-tanween` keeps the shadda (U+0651) and the three tanween marks (U+064B..U+064D)
 * and drops everything else (fatha, damma, kasra, sukun…), so the reader keeps the
 * consonant doubling and the case-ending vowels that carry meaning.
 */
export function isHiddenMark(code: number, mode: TashkeelMode): boolean {
  if (mode === 'full' || !isTashkeelMark(code)) return false;
  if (mode === 'none') return true;
  if (code === 0x0651) return false;
  if (code >= 0x064b && code <= 0x064d) return false;
  return true;
}

/** Pure: the text as it should be displayed for `mode`. `full` returns the input untouched. */
export function stripTashkeel(text: string, mode: TashkeelMode): string {
  if (mode === 'full' || text.length === 0) return text;
  return mode === 'none'
    ? text.replace(FULL_MARKS_RE, '')
    : text.replace(HARAKAT_ONLY_RE, '');
}

/**
 * Offset in the displayed string for a character offset in the original one.
 * `full` is the identity; otherwise the hidden marks before `originalOffset` drop out.
 */
export function displayOffsetForOriginalOffset(
  original: string,
  originalOffset: number,
  mode: TashkeelMode,
): number {
  if (mode === 'full') return originalOffset;
  const end = Math.max(0, Math.min(originalOffset, original.length));
  let display = 0;
  for (let i = 0; i < end; i++) {
    if (!isHiddenMark(original.charCodeAt(i), mode)) display++;
  }
  return display;
}

/**
 * Offset in the original string for a character offset in the displayed one.
 *
 * Round-tripping through {@link displayOffsetForOriginalOffset} is an equality on display
 * offsets; going the other way lands on the first original character (base letter) of the
 * displayed character, so an anchor never starts inside a cluster of marks.
 */
export function originalOffsetForDisplayOffset(
  original: string,
  displayOffset: number,
  mode: TashkeelMode,
): number {
  if (mode === 'full') return displayOffset;
  if (displayOffset <= 0) return 0;
  let display = 0;
  for (let i = 0; i < original.length; i++) {
    if (isHiddenMark(original.charCodeAt(i), mode)) continue;
    if (display === displayOffset) return i;
    display++;
  }
  return original.length;
}

/**
 * Original text of every text node this module has rewritten.
 *
 * The DOM is the only place the display text lives, so the original has to be kept next to
 * it: switching `none` → `full` must give back exactly the file's text, and the anchor
 * mapping needs the original characters to count what was hidden. A `WeakMap` keeps the
 * memory tied to the node itself, so an evicted chapter takes its copies with it.
 */
const originalTextByNode = new WeakMap<Text, string>();

function forEachTextNode(root: Node, visit: (node: Text, original: string) => void): void {
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    visit(node, originalTextByNode.get(node) ?? node.data);
    node = walker.nextNode() as Text | null;
  }
}

/**
 * Rewrite the text nodes under `root` for `mode`. Nothing else in the DOM is touched:
 * no elements are added, removed or re-attributed, so shaping, `data-block-id` and the
 * sanitised inline markup (`<em>`, `<sup class="fn-ref">`…) all survive.
 */
export function applyTashkeelToElement(root: Element, mode: TashkeelMode): void {
  if (mode === 'full' && !hasStoredOriginals(root)) return;
  forEachTextNode(root, (node, original) => {
    if (!originalTextByNode.has(node)) originalTextByNode.set(node, original);
    const next = stripTashkeel(original, mode);
    if (node.data !== next) node.data = next;
  });
}

/** Cheap "was anything rewritten under here" probe, so a `full` re-apply can be a no-op. */
function hasStoredOriginals(root: Element): boolean {
  let found = false;
  forEachTextNode(root, (node) => {
    if (originalTextByNode.has(node)) found = true;
  });
  return found;
}

/**
 * The element's text **as the book file has it**, whatever mode is currently displayed.
 * Concatenating the stored originals is the same string `root.textContent` would give in
 * `full` mode, so callers that persist or quote text (selection, bookmarks, highlights)
 * always address the book, never the shortened on-screen copy.
 */
export function originalTextOf(root: Element): string {
  let text = '';
  forEachTextNode(root, (_node, original) => {
    text += original;
  });
  return text;
}

/**
 * Convert a displayed-text offset (relative to `root.textContent`, exactly how the
 * engine's `findTextPosition` walks it) into an original-text offset.
 */
export function toOriginalOffset(
  root: Element,
  displayOffset: number,
  mode: TashkeelMode,
): number {
  if (mode === 'full' || displayOffset <= 0) return Math.max(0, displayOffset);
  let remaining = displayOffset;
  let originalBase = 0;
  let result: number | null = null;
  forEachTextNode(root, (node, original) => {
    if (result !== null) return;
    const displayLen = node.data.length;
    if (remaining < displayLen) {
      result = originalBase + originalOffsetForDisplayOffset(original, remaining, mode);
      return;
    }
    remaining -= displayLen;
    originalBase += original.length;
  });
  return result ?? originalBase;
}

/**
 * Convert an original-text offset (relative to `root.textContent` in the file's text) into
 * the displayed-text offset the layout was measured with.
 */
export function toDisplayOffset(
  root: Element,
  originalOffset: number,
  mode: TashkeelMode,
): number {
  if (mode === 'full' || originalOffset <= 0) return Math.max(0, originalOffset);
  let remaining = originalOffset;
  let displayBase = 0;
  let result: number | null = null;
  forEachTextNode(root, (node, original) => {
    if (result !== null) return;
    if (remaining < original.length) {
      result = displayBase + displayOffsetForOriginalOffset(original, remaining, mode);
      return;
    }
    remaining -= original.length;
    displayBase += node.data.length;
  });
  return result ?? displayBase;
}
