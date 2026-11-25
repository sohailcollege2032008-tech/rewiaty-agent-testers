import type { Anchor } from '@rewiaty/book-format';
import { HIGHLIGHT_COLORS, type EngineHighlight, type HighlightColor, type SelectionInfo, type SelectionRect } from './types.js';

export type HighlightChapterTarget = {
  el: HTMLElement;
  blockById: Map<string, HTMLElement>;
};

export type SelectionWordAnchor = {
  blockEl: HTMLElement;
  chapterId: string;
  startOffset: number;
  endOffset: number;
};

const CONTEXT_CHARS = 20;
const WORD_SEP_RE = /[\s.,;:!?،؛؟«»"'()[\]{}…—–\-]/;
const SELECTABLE_SELECTOR = '.block-p, .block-quote, .block-h2';
const HIGHLIGHT_PREFIX = 'rewiaty-hl-';

export function supportsCssHighlights(): boolean {
  if (typeof CSS === 'undefined') return false;
  const cssAny = CSS as unknown as { highlights?: { set?: unknown; delete?: unknown } };
  if (!cssAny.highlights || typeof cssAny.highlights.set !== 'function') return false;
  return typeof (globalThis as { Highlight?: unknown }).Highlight === 'function';
}

function findTextBoundary(
  root: HTMLElement,
  charOffset: number,
  isEnd: boolean,
): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, charOffset);
  let lastText: Text | null = null;
  let current = walker.nextNode() as Text | null;

  while (current) {
    lastText = current;
    const len = current.data.length;
    if (remaining < len || (isEnd && remaining === len)) {
      return { node: current, offset: remaining };
    }
    remaining -= len;
    current = walker.nextNode() as Text | null;
  }

  if (lastText) {
    return { node: lastText, offset: isEnd ? lastText.data.length : Math.max(0, lastText.data.length - 1) };
  }
  return null;
}

export function buildBlockRange(blockEl: HTMLElement, charOffset: number, length: number): Range | null {
  const totalLen = blockEl.textContent?.length ?? 0;
  if (totalLen === 0 || length <= 0) return null;

  const start = Math.max(0, Math.min(totalLen, Math.floor(charOffset)));
  const end = Math.max(start, Math.min(totalLen, start + Math.floor(length)));
  if (end <= start) return null;

  const startPos = findTextBoundary(blockEl, start, false);
  const endPos = findTextBoundary(blockEl, end, true);
  if (!startPos || !endPos) return null;

  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  return range;
}

function getOffsetInBlock(blockEl: HTMLElement, targetNode: Node, targetOffset: number): number {
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  let total = 0;

  if (targetNode.nodeType === Node.TEXT_NODE) {
    let current = walker.nextNode() as Text | null;
    while (current) {
      if (current === targetNode) {
        return total + Math.max(0, Math.min(current.data.length, targetOffset));
      }
      total += current.data.length;
      current = walker.nextNode() as Text | null;
    }
    return total;
  }

  // Element container: sum text up to childNodes[targetOffset].
  const refRange = document.createRange();
  refRange.setStart(blockEl, 0);
  try {
    refRange.setEnd(targetNode, targetOffset);
    return refRange.toString().length;
  } catch {
    return 0;
  }
}

function rawCaretAtPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof doc.caretRangeFromPoint === 'function') {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) return { node: r.startContainer, offset: r.startOffset };
  }
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) return { node: pos.offsetNode, offset: pos.offset };
  }
  return null;
}

function resolveSelectableCaret(
  x: number,
  y: number,
  maxVerticalDistancePx = 28,
): { blockEl: HTMLElement; chapterEl: HTMLElement; charOffset: number } | null {
  const yOffsets = [0, -4, 4, -8, 8, -12, 12];
  for (const dy of yOffsets) {
    const caret = rawCaretAtPoint(x, y + dy);
    if (!caret || caret.node.nodeType !== Node.TEXT_NODE) continue;

    const textNode = caret.node as Text;
    const parentEl = textNode.parentElement;
    if (!parentEl || parentEl.closest('.fn-ref')) continue;

    const blockEl = parentEl.closest<HTMLElement>(SELECTABLE_SELECTOR);
    const chapterEl = blockEl?.closest<HTMLElement>('.chapter[aria-hidden="false"]');
    if (!blockEl || !chapterEl) continue;

    // Ensure the caret is actually close to the probed point (avoid snapping from far margins).
    const probeRange = document.createRange();
    const clamped = Math.max(0, Math.min(textNode.data.length, caret.offset));
    probeRange.setStart(textNode, Math.min(clamped, Math.max(0, textNode.data.length - 1)));
    probeRange.setEnd(textNode, Math.min(textNode.data.length, probeRange.startOffset + 1));
    const rect = probeRange.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      if (Math.abs(y - (rect.top + rect.height / 2)) > maxVerticalDistancePx + rect.height / 2) {
        continue;
      }
      if (x < rect.left - 36 || x > rect.right + 36) {
        continue;
      }
    }

    const charOffset = getOffsetInBlock(blockEl, textNode, caret.offset);
    return { blockEl, chapterEl, charOffset };
  }
  return null;
}

function findWordBounds(text: string, rawOffset: number): { start: number; end: number } | null {
  if (!text) return null;
  let idx = Math.max(0, Math.min(text.length - 1, rawOffset));
  if (WORD_SEP_RE.test(text[idx] ?? '')) {
    if (idx > 0 && !WORD_SEP_RE.test(text[idx - 1] ?? '')) {
      idx -= 1;
    } else if (idx + 1 < text.length && !WORD_SEP_RE.test(text[idx + 1] ?? '')) {
      idx += 1;
    } else {
      // Fallback: find nearest non-whitespace char inside a small window
      let found = -1;
      for (let d = 1; d <= 6; d++) {
        if (idx - d >= 0 && !/\s/.test(text[idx - d] ?? '')) {
          found = idx - d;
          break;
        }
        if (idx + d < text.length && !/\s/.test(text[idx + d] ?? '')) {
          found = idx + d;
          break;
        }
      }
      if (found < 0) return null;
      idx = found;
    }
  }

  let start = idx;
  let end = idx + 1;
  while (start > 0 && !WORD_SEP_RE.test(text[start - 1] ?? '')) {
    start -= 1;
  }
  while (end < text.length && !WORD_SEP_RE.test(text[end] ?? '')) {
    end += 1;
  }
  return end > start ? { start, end } : null;
}

function applyDomSelectionRange(range: Range): void {
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

export function clearDomSelection(): void {
  window.getSelection()?.removeAllRanges();
}

export function hasNonCollapsedSelection(): boolean {
  const sel = window.getSelection();
  return Boolean(sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.toString().trim().length > 0);
}

export function selectWordAtPoint(x: number, y: number): SelectionWordAnchor | null {
  const hit = resolveSelectableCaret(x, y);
  if (!hit) return null;

  const text = hit.blockEl.textContent ?? '';
  const bounds = findWordBounds(text, hit.charOffset);
  if (!bounds) return null;

  const range = buildBlockRange(hit.blockEl, bounds.start, bounds.end - bounds.start);
  if (!range) return null;

  applyDomSelectionRange(range);
  const chapterId = hit.chapterEl.getAttribute('data-chapter-id') ?? '';
  return {
    blockEl: hit.blockEl,
    chapterId,
    startOffset: bounds.start,
    endOffset: bounds.end,
  };
}

export function extendSelectionToPoint(anchor: SelectionWordAnchor, x: number, y: number): boolean {
  const hit = resolveSelectableCaret(x, y, 48);
  if (!hit) return false;

  const totalLen = anchor.blockEl.textContent?.length ?? 0;
  if (totalLen === 0) return false;

  let start = anchor.startOffset;
  let end = anchor.endOffset;

  if (hit.blockEl === anchor.blockEl) {
    if (hit.charOffset >= anchor.startOffset) {
      start = anchor.startOffset;
      end = Math.max(anchor.endOffset, hit.charOffset);
    } else {
      start = hit.charOffset;
      end = anchor.endOffset;
    }
  } else {
    const pos = anchor.blockEl.compareDocumentPosition(hit.blockEl);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
      start = anchor.startOffset;
      end = totalLen;
    } else if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
      start = 0;
      end = anchor.endOffset;
    }
  }

  const range = buildBlockRange(anchor.blockEl, start, end - start);
  if (!range) return false;
  applyDomSelectionRange(range);
  return true;
}

function unionRects(rects: DOMRectList | DOMRect[], fallback: DOMRect): SelectionRect {
  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    if (r.width <= 0 && r.height <= 0) continue;
    if (r.left < minLeft) minLeft = r.left;
    if (r.top < minTop) minTop = r.top;
    if (r.right > maxRight) maxRight = r.right;
    if (r.bottom > maxBottom) maxBottom = r.bottom;
  }

  if (!Number.isFinite(minLeft)) {
    return {
      left: fallback.left,
      top: fallback.top,
      right: fallback.right,
      bottom: fallback.bottom,
      width: fallback.width,
      height: fallback.height,
    };
  }

  return {
    left: minLeft,
    top: minTop,
    right: maxRight,
    bottom: maxBottom,
    width: Math.max(0, maxRight - minLeft),
    height: Math.max(0, maxBottom - minTop),
  };
}

export function extractSelectionInfo(): SelectionInfo | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  const startNode = range.startContainer;
  const startEl =
    startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : (startNode as Element | null);
  if (!startEl) return null;

  const blockEl = startEl.closest<HTMLElement>(SELECTABLE_SELECTOR);
  const chapterEl = blockEl?.closest<HTMLElement>('.chapter[aria-hidden="false"]');
  if (!blockEl || !chapterEl) return null;

  const blockId = blockEl.getAttribute('data-block-id') ?? '';
  const chapterId = chapterEl.getAttribute('data-chapter-id') ?? '';
  if (!blockId) return null;

  const fullText = blockEl.textContent ?? '';
  if (!fullText) return null;

  let start = getOffsetInBlock(blockEl, range.startContainer, range.startOffset);
  let end = blockEl.contains(range.endContainer)
    ? getOffsetInBlock(blockEl, range.endContainer, range.endOffset)
    : fullText.length;

  if (end < start) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  while (start < end && /\s/.test(fullText[start] ?? '')) {
    start += 1;
  }
  while (end > start && /\s/.test(fullText[end - 1] ?? '')) {
    end -= 1;
  }

  if (end <= start) return null;

  const trimmedRange = buildBlockRange(blockEl, start, end - start);
  if (!trimmedRange) return null;

  const rect = unionRects(trimmedRange.getClientRects(), trimmedRange.getBoundingClientRect());
  const anchor: Anchor = { blockId, charOffset: start };

  return {
    anchor,
    length: end - start,
    quote: fullText.slice(start, end),
    contextBefore: fullText.slice(Math.max(0, start - CONTEXT_CHARS), start),
    contextAfter: fullText.slice(end, end + CONTEXT_CHARS),
    chapterId,
    rect,
  };
}

export function renderEngineHighlights(
  renderedChapters: Iterable<HighlightChapterTarget>,
  highlights: readonly EngineHighlight[],
  options?: { forceOverlay?: boolean },
): { mode: 'css-highlight' | 'overlay'; renderedCount: number } {
  const useCss = supportsCssHighlights() && !options?.forceOverlay;
  const chapters = Array.from(renderedChapters);

  if (useCss) {
    // Clean up any leftover overlay layers
    for (const entry of chapters) {
      entry.el.querySelector('.hl-overlay-layer')?.remove();
    }

    const byColor = new Map<HighlightColor, Range[]>();
    for (const meta of HIGHLIGHT_COLORS) {
      byColor.set(meta.id, []);
    }

    let renderedCount = 0;
    for (const entry of chapters) {
      for (const hl of highlights) {
        const blockEl = entry.blockById.get(hl.blockId);
        if (!blockEl) continue;
        const range = buildBlockRange(blockEl, hl.charOffset, hl.length);
        if (!range) continue;
        byColor.get(hl.color)?.push(range);
        renderedCount += 1;
      }
    }

    const cssHighlights = (CSS as unknown as {
      highlights: Map<string, unknown>;
    }).highlights;
    const HighlightCtor = (globalThis as unknown as {
      Highlight: new (...ranges: Range[]) => unknown;
    }).Highlight;

    for (const meta of HIGHLIGHT_COLORS) {
      const key = `${HIGHLIGHT_PREFIX}${meta.id}`;
      const ranges = byColor.get(meta.id) ?? [];
      if (ranges.length > 0) {
        cssHighlights.set(key, new HighlightCtor(...ranges));
      } else {
        cssHighlights.delete(key);
      }
    }

    return { mode: 'css-highlight', renderedCount };
  }

  // Fallback overlay rects path
  if (supportsCssHighlights()) {
    const cssHighlights = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
    for (const meta of HIGHLIGHT_COLORS) {
      cssHighlights.delete(`${HIGHLIGHT_PREFIX}${meta.id}`);
    }
  }

  let renderedCount = 0;
  for (const entry of chapters) {
    let layer = entry.el.querySelector<HTMLElement>('.hl-overlay-layer');
    if (highlights.length === 0) {
      layer?.remove();
      continue;
    }

    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'hl-overlay-layer';
      layer.setAttribute('aria-hidden', 'true');
      entry.el.insertBefore(layer, entry.el.firstChild);
    } else {
      layer.textContent = '';
    }

    const chRect = entry.el.getBoundingClientRect();
    const frag = document.createDocumentFragment();

    for (const hl of highlights) {
      const blockEl = entry.blockById.get(hl.blockId);
      if (!blockEl) continue;
      const range = buildBlockRange(blockEl, hl.charOffset, hl.length);
      if (!range) continue;

      const rects = range.getClientRects();
      let hasRect = false;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i]!;
        if (r.width <= 0 || r.height <= 0) continue;
        hasRect = true;
        const div = document.createElement('div');
        div.className = 'hl-rect';
        div.setAttribute('data-hl-id', hl.id);
        div.setAttribute('data-hl-color', hl.color);
        div.style.left = `${r.left - chRect.left}px`;
        div.style.top = `${r.top - chRect.top}px`;
        div.style.width = `${r.width}px`;
        div.style.height = `${r.height}px`;
        frag.appendChild(div);
      }
      if (hasRect) renderedCount += 1;
    }

    layer.appendChild(frag);
  }

  return { mode: 'overlay', renderedCount };
}

export function hitTestHighlightAtPoint(
  renderedChapters: Iterable<HighlightChapterTarget>,
  highlights: readonly EngineHighlight[],
  clientX: number,
  clientY: number,
): { highlight: EngineHighlight; rect: SelectionRect } | null {
  if (highlights.length === 0) return null;
  const hit = resolveSelectableCaret(clientX, clientY, 16);
  if (!hit) return null;

  const blockId = hit.blockEl.getAttribute('data-block-id');
  if (!blockId) return null;

  // Verify the point lies inside one of the candidate highlight's visual rects.
  for (let i = highlights.length - 1; i >= 0; i--) {
    const hl = highlights[i]!;
    if (hl.blockId !== blockId) continue;
    const range = buildBlockRange(hit.blockEl, hl.charOffset, hl.length);
    if (!range) continue;

    const rects = range.getClientRects();
    for (let j = 0; j < rects.length; j++) {
      const r = rects[j]!;
      if (r.width <= 0 || r.height <= 0) continue;
      if (
        clientX >= r.left - 3 &&
        clientX <= r.right + 3 &&
        clientY >= r.top - 3 &&
        clientY <= r.bottom + 3
      ) {
        return {
          highlight: hl,
          rect: unionRects(rects, range.getBoundingClientRect()),
        };
      }
    }
  }

  // Fallback check if renderedChapters has matching block even if hit slightly outside rect
  void renderedChapters;
  return null;
}
