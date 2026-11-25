/**
 * Convert (X)HTML into the Markdown subset `book-format` understands.
 *
 * EPUB chapters are XHTML: paragraphs, headings, emphasis, images, notes. We do not need a full
 * HTML engine, and a DOM parser is not guaranteed on Hermes, so this is a deliberately small
 * tree parser + renderer:
 *  - only an allowlist of tags produces Markdown; every other tag is dropped but its text kept,
 *  - `script`, `style`, `head`, `noscript`, `template` and `svg` are discarded entirely,
 *  - all emitted text is Markdown-escaped, so nothing from the source can turn into raw HTML.
 */

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const SKIPPED_TAGS = new Set(['head', 'script', 'style', 'noscript', 'template', 'svg', 'iframe']);

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'body',
  'div',
  'footer',
  'header',
  'main',
  'nav',
  'section',
]);

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  times: '×',
  bull: '•',
};

export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITY_MAP[body.toLowerCase()] ?? match;
  });
}

export type HtmlElement = {
  type: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
};

export type HtmlText = { type: 'text'; text: string };

export type HtmlNode = HtmlElement | HtmlText;

export type ParsedHtml = {
  root: HtmlElement;
  /** Every element carrying an `id`, for footnote/note targets. */
  byId: Map<string, HtmlElement>;
};

const ATTRIBUTE_RE = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTRIBUTE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_RE.exec(raw)) !== null) {
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[name] = decodeHtmlEntities(value);
  }
  return attrs;
}

const TOKEN_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\?[\s\S]*?\?>|<\/\s*([A-Za-z][\w:.-]*)\s*>|<([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

/** Parse an HTML/XHTML document (or fragment) into a small node tree. */
export function parseHtml(input: string): ParsedHtml {
  const root: HtmlElement = { type: 'element', tag: '#root', attrs: {}, children: [] };
  const byId = new Map<string, HtmlElement>();
  const stack: HtmlElement[] = [root];

  const appendText = (text: string) => {
    if (!text) return;
    const parent = stack[stack.length - 1] ?? root;
    parent.children.push({ type: 'text', text });
  };

  const current = () => stack[stack.length - 1] ?? root;

  let cursor = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(input)) !== null) {
    appendText(input.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    if (match[1] !== undefined) {
      appendText(match[1]);
      continue;
    }
    if (match[2] !== undefined) {
      const tag = match[2].toLowerCase();
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i]?.tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (match[3] === undefined) {
      // comment / doctype / processing instruction
      continue;
    }

    const tag = match[3].toLowerCase();
    const rawAttrs = match[4] ?? '';
    const selfClosing = /\/\s*$/.test(rawAttrs);
    const element: HtmlElement = {
      type: 'element',
      tag,
      attrs: parseAttributes(rawAttrs),
      children: [],
    };
    const id = element.attrs.id;
    if (id) byId.set(id, element);

    if (SKIPPED_TAGS.has(tag)) {
      // Drop the element and its content: find the matching close tag without parsing inside.
      if (!selfClosing) {
        const closeRe = new RegExp(`</\\s*${tag}\\s*>`, 'gi');
        closeRe.lastIndex = cursor;
        const close = closeRe.exec(input);
        if (close) cursor = close.index + close[0].length;
        else cursor = input.length;
        TOKEN_RE.lastIndex = cursor;
      }
      continue;
    }

    current().children.push(element);
    if (!selfClosing && !VOID_TAGS.has(tag)) {
      stack.push(element);
    }
  }

  appendText(input.slice(cursor));
  return { root, byId };
}

export type XhtmlToMarkdownOptions = {
  /** Added to HTML heading levels; 0 keeps `h1` as a book chapter. */
  headingOffset?: number;
  /** Map a `src` from the document to an archive asset path, or null to drop the image. */
  resolveImage?: (src: string, alt: string) => string | null;
  /** Prefix for footnote ids so every chapter stays unique. */
  footnotePrefix?: string;
};

export type XhtmlToMarkdownResult = {
  markdown: string;
  title: string | null;
};

const MARKDOWN_ESCAPE_RE = /([\\`*_[\]]+)/g;

function escapeMarkdownText(input: string): string {
  return input.replace(MARKDOWN_ESCAPE_RE, '\\$1');
}

function collapseWhitespace(input: string): string {
  return input.replace(/[\s\u00a0]+/g, ' ');
}

function sanitizeFootnoteId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || `note${(raw.length + 1).toString(36)}`;
}

function plainText(node: HtmlNode): string {
  if (node.type === 'text') return collapseWhitespace(decodeHtmlEntities(node.text));
  if (SKIPPED_TAGS.has(node.tag)) return '';
  return node.children.map(plainText).join('');
}

function wrapEmphasis(marker: string, inner: string): string {
  const trimmed = inner.trim();
  if (!trimmed) return '';
  const leading = inner.startsWith(' ') || inner.startsWith('\n') ? ' ' : '';
  const trailing = inner.endsWith(' ') || inner.endsWith('\n') ? ' ' : '';
  return `${leading}${marker}${trimmed}${marker}${trailing}`;
}

function headingTitleLevel(tag: string): number {
  const level = Number.parseInt(tag.slice(1), 10);
  return Number.isFinite(level) ? level : 2;
}

/** Indent every non-empty line with `prefix` (blockquote / list continuation). */
function prefixLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim() ? `${prefix}${line}` : line))
    .join('\n');
}

/**
 * Render a parsed document as Markdown. Footnote bodies (`epub:type="footnote"` elements with an
 * id, plus `noteref` link targets) are appended as `[^id]: …` definitions, which is exactly the
 * footnote syntax the reader's parser already supports.
 */
export function htmlToMarkdown(
  input: string | ParsedHtml,
  options: XhtmlToMarkdownOptions = {},
): XhtmlToMarkdownResult {
  const parsed = typeof input === 'string' ? parseHtml(input) : input;
  const headingOffset = options.headingOffset ?? 0;
  const footnotePrefix = options.footnotePrefix ?? '';
  const footnoteBodies = new Map<string, string>();
  const referencedNotes = new Set<string>();
  const explicitFootnotes = new Set<string>();
  let documentTitle: string | null = null;

  const noteIdFor = (raw: string): string => `${footnotePrefix}${sanitizeFootnoteId(raw)}`;

  const collectFootnote = (element: HtmlElement): string | null => {
    const epubType = element.attrs['epub:type']?.toLowerCase() ?? '';
    const role = element.attrs.role?.toLowerCase() ?? '';
    if (epubType.includes('footnote') || epubType.includes('endnote') || role === 'doc-footnote') {
      const id = element.attrs.id;
      if (id) {
        const noteId = noteIdFor(id);
        if (!footnoteBodies.has(noteId)) {
          footnoteBodies.set(noteId, inlineChildren(element));
        }
        explicitFootnotes.add(noteId);
        return noteId;
      }
    }
    return null;
  };

  const renderChildren = (element: HtmlElement): string =>
    element.children.map((child) => render(child)).join('');

  const inlineChildren = (element: HtmlElement): string =>
    collapseWhitespace(
      element.children
        .map((child) => render(child))
        .join('')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ''),
    ).trim();

  const render = (node: HtmlNode): string => {
    if (node.type === 'text') {
      return escapeMarkdownText(decodeHtmlEntities(node.text));
    }
    const tag = node.tag;
    if (SKIPPED_TAGS.has(tag)) return '';

    if (tag === 'title') {
      if (!documentTitle) documentTitle = collapseWhitespace(plainText(node)).trim() || null;
      return '';
    }
    if (tag === 'img') {
      const src = node.attrs.src?.trim() ?? '';
      const alt = collapseWhitespace(node.attrs.alt ?? '').trim();
      if (!src) return '';
      const resolved = options.resolveImage ? options.resolveImage(src, alt) : src;
      if (!resolved) return '';
      return `![${escapeMarkdownText(alt)}](${resolved})`;
    }
    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n***\n\n';
    if (tag === 'a') {
      const epubType = node.attrs['epub:type']?.toLowerCase() ?? '';
      const role = node.attrs.role?.toLowerCase() ?? '';
      const href = node.attrs.href ?? '';
      const isNoteRef = epubType.includes('noteref') || role === 'doc-noteref';
      if (isNoteRef && href.startsWith('#') && href.length > 1) {
        const targetId = decodeURIComponent(href.slice(1));
        const noteId = noteIdFor(targetId);
        referencedNotes.add(noteId);
        const target = parsed.byId.get(targetId);
        if (target && !footnoteBodies.has(noteId)) {
          footnoteBodies.set(noteId, inlineChildren(target));
        }
        return `[^${noteId}]`;
      }
      return renderChildren(node);
    }
    if (tag === 'sup') return renderChildren(node);
    if (tag === 'em' || tag === 'i') return wrapEmphasis('*', renderChildren(node));
    if (tag === 'strong' || tag === 'b') return wrapEmphasis('**', renderChildren(node));
    if (tag === 'code' || tag === 'tt') return wrapEmphasis('`', renderChildren(node));

    if (/^h[1-6]$/.test(tag)) {
      const level = Math.min(6, Math.max(1, headingTitleLevel(tag) + headingOffset));
      const title = collapseWhitespace(renderChildren(node).replace(/[*_`]/g, '')).trim();
      if (!title) return '';
      if (!documentTitle) documentTitle = title;
      return `\n\n${'#'.repeat(level)} ${title}\n\n`;
    }

    const noteId = collectFootnote(node);
    if (noteId) return '';

    if (tag === 'p') {
      const inner = renderChildren(node).trim();
      return inner ? `\n\n${inner}\n\n` : '';
    }
    if (tag === 'blockquote') {
      const inner = renderChildren(node).trim();
      return inner ? `\n\n${prefixLines(inner, '> ')}\n\n` : '';
    }
    if (tag === 'li') {
      const inner = renderChildren(node).trim();
      return inner ? `\n- ${inner}` : '';
    }
    if (tag === 'ul' || tag === 'ol') {
      return `\n${renderChildren(node)}\n`;
    }
    if (tag === 'tr') {
      const cells = node.children
        .filter((child): child is HtmlElement => child.type === 'element')
        .map((cell) => collapseWhitespace(renderChildren(cell)).trim())
        .filter(Boolean);
      return cells.length > 0 ? `\n${cells.join(' | ')}` : '';
    }
    if (tag === 'table') return `\n${renderChildren(node)}\n`;
    if (tag === 'pre') {
      const inner = collapseWhitespace(plainText(node)).trim();
      return inner ? `\n\n${inner}\n\n` : '';
    }
    if (BLOCK_TAGS.has(tag) || tag === 'html' || tag === '#root') {
      const inner = renderChildren(node);
      return inner.trim() ? `\n\n${inner}\n\n` : '';
    }
    return renderChildren(node);
  };

  const rendered = render(parsed.root);

  let markdown = rendered
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const definitions: string[] = [];
  for (const [id, body] of footnoteBodies.entries()) {
    const clean = body.trim();
    if (!clean) continue;
    // A definition with no reference (and no explicit note element) is dead weight.
    if (!referencedNotes.has(id) && !explicitFootnotes.has(id)) continue;
    definitions.push(`[^${id}]: ${clean}`);
  }
  if (definitions.length > 0) {
    markdown = `${markdown}\n\n${definitions.join('\n\n')}`;
  }

  return { markdown, title: documentTitle };
}

/** Plain text of a document, used for chapter titles and diagnostics. */
export function htmlToPlainText(input: string): string {
  const parsed = parseHtml(input);
  return collapseWhitespace(plainText(parsed.root)).trim();
}
