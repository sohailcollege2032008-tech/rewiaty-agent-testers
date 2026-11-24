/**
 * HTML escaping and sanitized inline Markdown rendering.
 * Preserves Arabic Tashkeel character-for-character and never emits raw HTML from input.
 */

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

/**
 * Validate image source paths to prevent scriptable URIs.
 * Allows relative paths, http(s), and safe raster data:image/* URIs (excluding SVG).
 */
export function isSafeImageSrc(rawSrc: string): boolean {
  const trimmed = rawSrc.trim();
  if (!trimmed) return false;
  const normalized = trimmed.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  if (
    normalized.startsWith('javascript:') ||
    normalized.startsWith('vbscript:') ||
    normalized.startsWith('data:text/')
  ) {
    return false;
  }
  if (normalized.startsWith('data:')) {
    return /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(trimmed);
  }
  return true;
}

const ESCAPE_SENTINEL_PREFIX = '\uE000';
const ESCAPE_SENTINEL_SUFFIX = '\uE001';

/**
 * Render sanitized inline HTML allowing only <em>, <strong>, <br>, and footnote refs.
 * All raw HTML tags/entities from source text are escaped first.
 */
export function renderInlineHtml(
  rawText: string,
  knownFootnotes?: ReadonlySet<string>,
): string {
  const escapedLiterals: string[] = [];

  // Protect backslash-escaped markdown punctuation before escaping HTML and parsing emphasis.
  const withPlaceholders = rawText.replace(/\\([\\*_\[\]<>`~])/g, (_m, ch: string) => {
    const idx = escapedLiterals.length;
    escapedLiterals.push(escapeHtml(ch));
    return `${ESCAPE_SENTINEL_PREFIX}${idx}${ESCAPE_SENTINEL_SUFFIX}`;
  });

  let html = escapeHtml(withPlaceholders);

  // Convert footnote references [^id] when defined (or if no set filter is provided).
  html = html.replace(/\[\^([a-zA-Z0-9_-]+)\]/g, (match, id: string) => {
    if (knownFootnotes && !knownFootnotes.has(id)) {
      return match;
    }
    const safeId = escapeHtml(id);
    return `<sup class="fn-ref"><a href="#fn-${safeId}" data-fn="${safeId}" role="button">${safeId}</a></sup>`;
  });

  // ***bold italic***
  html = html.replace(
    /(?<!\*)\*\*\*([^\s*](?:[^*\n]*?[^\s*])?)\*\*\*(?!\*)/g,
    '<strong><em>$1</em></strong>',
  );

  // **bold**
  html = html.replace(
    /(?<!\*)\*\*([^\s*](?:[^*\n]*?[^\s*])?)\*\*(?!\*)/g,
    '<strong>$1</strong>',
  );

  // __bold__
  html = html.replace(
    /(?<![\p{L}\p{N}_])__([^\s_](?:[^_\n]*?[^\s_])?)__(?![\p{L}\p{N}_])/gu,
    '<strong>$1</strong>',
  );

  // *italic*
  html = html.replace(
    /(?<!\*)\*([^\s*](?:[^*\n]*?[^\s*])?)\*(?!\*)/g,
    '<em>$1</em>',
  );

  // _italic_
  html = html.replace(
    /(?<![\p{L}\p{N}_])_([^\s_](?:[^_\n]*?[^\s_])?)_(?![\p{L}\p{N}_])/gu,
    '<em>$1</em>',
  );

  // Restore backslash-escaped literal characters.
  if (escapedLiterals.length > 0) {
    html = html.replace(/\uE000(\d+)\uE001/g, (_m, idxStr: string) => {
      const idx = Number(idxStr);
      return escapedLiterals[idx] ?? '';
    });
  }

  return html;
}

/**
 * Strip inline markdown syntax for plain text titles while preserving all characters/diacritics.
 */
export function stripInlineMarkdown(rawText: string): string {
  return rawText
    .replace(/\\([\\*_\[\]])/g, '$1')
    .replace(/\[\^([a-zA-Z0-9_-]+)\]/g, '')
    .replace(/(?<!\*)\*\*\*([^\s*](?:[^*\n]*?[^\s*])?)\*\*\*(?!\*)/g, '$1')
    .replace(/(?<!\*)\*\*([^\s*](?:[^*\n]*?[^\s*])?)\*\*(?!\*)/g, '$1')
    .replace(/(?<![\p{L}\p{N}_])__([^\s_](?:[^_\n]*?[^\s_])?)__(?![\p{L}\p{N}_])/gu, '$1')
    .replace(/(?<!\*)\*([^\s*](?:[^*\n]*?[^\s*])?)\*(?!\*)/g, '$1')
    .replace(/(?<![\p{L}\p{N}_])_([^\s_](?:[^_\n]*?[^\s_])?)_(?![\p{L}\p{N}_])/gu, '$1')
    .trim();
}

/**
 * Count words in rendered HTML by stripping tags and footnote markers.
 */
export function countWordsInHtml(html: string): number {
  const withoutFootnotes = html.replace(/<sup class="fn-ref">[\s\S]*?<\/sup>/g, '');
  const plain = withoutFootnotes
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, ' ')
    .trim();
  if (!plain) return 0;
  return plain.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}
