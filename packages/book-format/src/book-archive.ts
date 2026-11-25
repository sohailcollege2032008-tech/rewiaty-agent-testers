/**
 * Import a whole book from an archive:
 *  - `.zip`  — chapter files (`*.md` / `*.txt`) sorted by name, plus an `images/` folder,
 *  - `.epub` — container.xml → OPF → spine order, each XHTML chapter converted to Markdown.
 *
 * The result is plain Markdown (the format `parseBook` already understands) plus the image bytes
 * under `assets/…`; the app writes those next to `book.md`. Every image path we emit is relative
 * and goes through `isSafeImageSrc`, so nothing in an archive can point outside the book folder.
 */
import { htmlToMarkdown, htmlToPlainText, parseHtml, type HtmlElement } from './html-to-markdown.js';
import { isSafeImageSrc } from './sanitize.js';
import { decodeTextBytes } from './text-decode.js';
import {
  ARCHIVE_EMPTY_MESSAGE,
  ArchiveError,
  isArchiveImageEntry,
  isArchiveJunkEntry,
  isArchiveTextEntry,
  readZipEntries,
  toSafeAssetPath,
  type ArchiveLimits,
} from './zip.js';

export const EPUB_DRM_MESSAGE =
  'الكتاب ده محمي بـ DRM، ومقدرناش نستورده. جرّب نسخة من غير حماية.';
export const EPUB_INVALID_MESSAGE =
  'ملف EPUB مش سليم: ملقيناش فيه محتوى الكتاب. جرّب ملف تاني أو حوّله لـ .md.';

export type ArchiveAsset = {
  /** Path relative to the book folder, always `assets/<name>`. */
  path: string;
  bytes: Uint8Array;
};

export type ImportedArchiveBook = {
  markdown: string;
  assets: ArchiveAsset[];
  source: 'zip' | 'epub';
  title?: string;
  author?: string;
};

export type ArchiveImportOptions = {
  limits?: Partial<ArchiveLimits>;
};

export function archiveExtension(fileName: string): 'zip' | 'epub' | null {
  const match = /\.([a-z0-9]+)\s*$/i.exec(fileName.trim());
  const ext = match?.[1]?.toLowerCase();
  if (ext === 'zip' || ext === 'epub') return ext;
  return null;
}

function baseName(fileName: string): string {
  return (fileName.split(/[\\/]/).pop() ?? fileName).trim();
}

function stripExtension(fileName: string): string {
  return baseName(fileName).replace(/\.[a-z0-9]+$/i, '').trim();
}

function naturalCompare(a: string, b: string): number {
  const chunks = (value: string) => value.toLowerCase().match(/\d+|\D+/g) ?? [value.toLowerCase()];
  const left = chunks(a);
  const right = chunks(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? '';
    const r = right[i] ?? '';
    if (l === r) continue;
    const ln = Number.parseInt(l, 10);
    const rn = Number.parseInt(r, 10);
    if (Number.isFinite(ln) && Number.isFinite(rn) && ln !== rn) return ln - rn;
    return l < r ? -1 : 1;
  }
  return 0;
}

function chapterTitleFromFileName(name: string): string {
  const stem = stripExtension(name);
  const cleaned = stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || 'فصل';
}

function escapeYamlValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/"/g, '”').trim();
}

function buildFrontmatter(fields: Record<string, string | undefined>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value && value.trim()) lines.push(`${key}: "${escapeYamlValue(value)}"`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

const TXT_MARKDOWN_ESCAPE_RE = /([\\`*_[\]])/g;

function escapeTxtLine(line: string): string {
  return line.replace(TXT_MARKDOWN_ESCAPE_RE, '\\$1');
}

function txtToMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(escapeTxtLine)
    .join('\n\n');
}

function hasFrontmatter(text: string): boolean {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/.test(withoutBom);
}

function frontmatterTitle(text: string): string | null {
  const match = /^---[ \t]*\n([\s\S]*?)\n---/.exec(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  if (!match) return null;
  const titleLine = /^title\s*:\s*(.+)$/m.exec(match[1] ?? '');
  if (!titleLine?.[1]) return null;
  return titleLine[1].trim().replace(/^["']|["']$/g, '').trim() || null;
}

/** Rewrite `![](images/x.png)` and `![[x.png]]` to the copied `assets/…` paths. */
function rewriteImageSources(markdown: string, resolve: (src: string) => string | null): string {
  const withMarkdownImages = markdown.replace(
    /(!\[[^\]]*\]\()\s*(?:<([^>]+)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g,
    (match, prefix: string, angleSrc: string | undefined, plainSrc: string | undefined) => {
      const src = (angleSrc ?? plainSrc ?? '').trim();
      if (!src) return match;
      const resolved = resolve(src);
      return resolved ? `${prefix}${resolved})` : match;
    },
  );

  return withMarkdownImages.replace(
    /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g,
    (match, target: string, alias: string | undefined) => {
      const resolved = resolve(`${target}`.trim());
      if (!resolved) return match;
      const alt = (alias ?? `${target}`.trim()).trim();
      return `![${alt.replace(/[\]]/g, '')}](${resolved})`;
    },
  );
}

type AssetCollector = {
  assets: ArchiveAsset[];
  byEntry: Map<string, string>;
  resolve: (src: string) => string | null;
};

function collectImageAssets(entries: Map<string, Uint8Array>): AssetCollector {
  const assets: ArchiveAsset[] = [];
  const byEntry = new Map<string, string>();
  const byBase = new Map<string, string>();
  const used = new Set<string>();

  for (const name of [...entries.keys()].sort(naturalCompare)) {
    if (!isArchiveImageEntry(name) || isArchiveJunkEntry(name)) continue;
    const bytes = entries.get(name);
    if (!bytes || bytes.byteLength === 0) continue;
    const assetPath = toSafeAssetPath(name, used);
    if (!isSafeImageSrc(assetPath)) continue;
    assets.push({ path: assetPath, bytes });
    byEntry.set(name, assetPath);
    byEntry.set(name.toLowerCase(), assetPath);
    const base = name.split('/').pop() ?? name;
    if (!byBase.has(base)) byBase.set(base, assetPath);
    if (!byBase.has(base.toLowerCase())) byBase.set(base.toLowerCase(), assetPath);
  }

  const resolve = (rawSrc: string): string | null => {
    let src = rawSrc.trim();
    if (!src) return null;
    // Drop query/hash fragments and decode the percent-encoding zip/EPUB writers use for spaces.
    src = src.split(/[?#]/)[0] ?? src;
    try {
      src = decodeURIComponent(src);
    } catch {
      /* keep the raw value */
    }
    src = src.replace(/^\.\//, '').replace(/^\/+/, '').normalize('NFC');
    if (byEntry.has(src)) return byEntry.get(src) ?? null;
    if (byEntry.has(src.toLowerCase())) return byEntry.get(src.toLowerCase()) ?? null;
    const base = src.split('/').pop() ?? src;
    if (byBase.has(base)) return byBase.get(base) ?? null;
    if (byBase.has(base.toLowerCase())) return byBase.get(base.toLowerCase()) ?? null;
    return null;
  };

  return { assets, byEntry, resolve };
}

function readZipBook(entries: Map<string, Uint8Array>, fileName: string): ImportedArchiveBook {
  const textEntries = [...entries.keys()]
    .filter((name) => isArchiveTextEntry(name) && !isArchiveJunkEntry(name))
    .sort(naturalCompare);

  const images = collectImageAssets(entries);
  const title = stripExtension(fileName) || 'كتاب';

  if (textEntries.length === 0) {
    throw new ArchiveError(ARCHIVE_EMPTY_MESSAGE);
  }

  const single = textEntries.length === 1 ? textEntries[0] : undefined;
  if (single && /\.md(?:own)?$/i.test(single) && hasFrontmatter(decodeTextBytes(entries.get(single)!))) {
    const raw = decodeTextBytes(entries.get(single)!);
    const markdown = rewriteImageSources(raw.replace(/\r\n?/g, '\n'), images.resolve);
    return {
      markdown,
      assets: images.assets,
      source: 'zip',
      title: frontmatterTitle(raw) ?? title,
      author: undefined,
    };
  }

  const blocks: string[] = [buildFrontmatter({ title })];
  for (const name of textEntries) {
    const bytes = entries.get(name);
    if (!bytes) continue;
    const raw = decodeTextBytes(bytes).replace(/\r\n?/g, '\n');
    const chapterTitle = chapterTitleFromFileName(name);
    let body: string;
    if (/\.txt$/i.test(name)) {
      body = txtToMarkdown(raw);
    } else {
      const withoutFrontmatter = raw.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*\n/, '');
      body = rewriteImageSources(withoutFrontmatter, images.resolve).trim();
    }
    if (!body) continue;
    const startsWithHeading = /^#\s+\S/m.test(body.split('\n').find((line) => line.trim()) ?? '');
    blocks.push(startsWithHeading ? body : `# ${chapterTitle}\n\n${body}`);
  }

  if (blocks.length === 1) {
    throw new ArchiveError(ARCHIVE_EMPTY_MESSAGE);
  }

  return {
    markdown: `${blocks.join('\n\n')}\n`,
    assets: images.assets,
    source: 'zip',
    title,
  };
}

function findEntry(entries: Map<string, Uint8Array>, path: string): Uint8Array | null {
  const normalized = path.normalize('NFC');
  if (entries.has(normalized)) return entries.get(normalized) ?? null;
  const lower = normalized.toLowerCase();
  for (const [name, bytes] of entries) {
    if (name.normalize('NFC').toLowerCase() === lower) return bytes;
  }
  return null;
}

function findEntryBySuffix(entries: Map<string, Uint8Array>, suffix: string): Uint8Array | null {
  const lower = suffix.normalize('NFC').toLowerCase();
  for (const [name, bytes] of entries) {
    const normalized = name.normalize('NFC').toLowerCase();
    if (normalized === lower || normalized.endsWith(`/${lower}`)) return bytes;
  }
  return null;
}

function resolveArchiveHref(baseDir: string, href: string): string {
  let decoded = href.split('#')[0] ?? href;
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* keep the raw value */
  }
  const parts = [...(baseDir ? baseDir.split('/') : []), ...decoded.split('/')];
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/').normalize('NFC');
}

function dirName(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function collectElements(root: HtmlElement, tag: string): HtmlElement[] {
  const wanted = tag.toLowerCase();
  const found: HtmlElement[] = [];
  const visit = (node: HtmlElement) => {
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      const childTag = child.tag.includes(':') ? child.tag.split(':').pop()! : child.tag;
      if (childTag === wanted) found.push(child);
      visit(child);
    }
  };
  visit(root);
  return found;
}

function elementText(element: HtmlElement): string {
  return htmlToPlainText(serializeElement(element));
}

function serializeElement(element: HtmlElement): string {
  if (element.tag === '#root') return element.children.map(serializeNode).join('');
  const attrs = Object.entries(element.attrs)
    .map(([key, value]) => ` ${key}="${value.replace(/"/g, '&quot;')}"`)
    .join('');
  return `<${element.tag}${attrs}>${element.children.map(serializeNode).join('')}</${element.tag}>`;
}

function serializeNode(node: HtmlElement | { type: 'text'; text: string }): string {
  if (node.type === 'text') return node.text;
  return serializeElement(node);
}

/** Adobe/Apple EPUB DRM lives in META-INF; font obfuscation is not DRM and must still import. */
function assertNotDrm(entries: Map<string, Uint8Array>): void {
  if (findEntryBySuffix(entries, 'META-INF/rights.xml')) {
    throw new ArchiveError(EPUB_DRM_MESSAGE);
  }
  const encryption = findEntryBySuffix(entries, 'META-INF/encryption.xml');
  if (!encryption) return;
  const xml = decodeTextBytes(encryption);
  const references = [...xml.matchAll(/<CipherReference[^>]*URI\s*=\s*["']([^"']+)["']/gi)].map(
    (match) => match[1] ?? '',
  );
  if (references.length === 0) throw new ArchiveError(EPUB_DRM_MESSAGE);
  const onlyFonts = references.every((reference) =>
    /\.(?:otf|ttf|woff2?|ttc)(?:[?#].*)?$/i.test(reference.trim()),
  );
  if (!onlyFonts) throw new ArchiveError(EPUB_DRM_MESSAGE);
}

function readEpubBook(entries: Map<string, Uint8Array>, fileName: string): ImportedArchiveBook {
  assertNotDrm(entries);

  const containerBytes = findEntryBySuffix(entries, 'META-INF/container.xml');
  if (!containerBytes) throw new ArchiveError(EPUB_INVALID_MESSAGE);
  const container = parseHtml(decodeTextBytes(containerBytes));
  const rootfile = collectElements(container.root, 'rootfile')[0];
  const opfPath = rootfile?.attrs['full-path']?.trim();
  if (!opfPath) throw new ArchiveError(EPUB_INVALID_MESSAGE);
  const opfBytes = findEntry(entries, opfPath) ?? findEntry(entries, opfPath.replace(/^\.\//, ''));
  if (!opfBytes) throw new ArchiveError(EPUB_INVALID_MESSAGE);

  const opf = parseHtml(decodeTextBytes(opfBytes));
  const metadata = collectElements(opf.root, 'metadata')[0];
  const opfDir = dirName(opfPath);

  const metadataValue = (tag: string): string | null => {
    const element = metadata ? collectElements(metadata, tag)[0] : collectElements(opf.root, tag)[0];
    if (!element) return null;
    const text = elementText(element);
    return text || null;
  };

  const title = metadataValue('title') ?? (stripExtension(fileName) || 'كتاب');
  const author = metadataValue('creator');
  const language = metadataValue('language');

  const manifestItems = collectElements(opf.root, 'item').map((item) => ({
    id: item.attrs.id ?? '',
    href: item.attrs.href ?? '',
    mediaType: (item.attrs['media-type'] ?? '').toLowerCase(),
    properties: item.attrs.properties ?? '',
  }));

  const spineIds = collectElements(opf.root, 'itemref')
    .filter((item) => (item.attrs.linear ?? 'yes').toLowerCase() !== 'no')
    .map((item) => item.attrs.idref ?? '')
    .filter(Boolean);

  const images = collectImageAssets(entries);
  const assets = images.assets;

  const chapters: string[] = [];
  for (const [index, idref] of spineIds.entries()) {
    const item = manifestItems.find((candidate) => candidate.id === idref);
    if (!item || !item.href) continue;
    const isHtml =
      item.mediaType === '' ||
      item.mediaType === 'application/xhtml+xml' ||
      item.mediaType === 'text/html';
    if (!isHtml) continue;
    const entryPath = resolveArchiveHref(opfDir, item.href);
    const bytes = findEntry(entries, entryPath);
    if (!bytes) continue;

    const chapterDir = dirName(entryPath);
    const rawXhtml = decodeTextBytes(bytes);
    const rawTitle = /<\s*title[^>]*>([\s\S]*?)<\s*\/\s*title\s*>/i.exec(rawXhtml)?.[1];
    const converted = htmlToMarkdown(rawXhtml, {
      headingOffset: 0,
      footnotePrefix: `c${index + 1}-`,
      resolveImage: (src) => {
        const fromDocument = resolveArchiveHref(chapterDir, src);
        const resolved = images.resolve(fromDocument) ?? images.resolve(src);
        return resolved;
      },
    });

    const markdown = converted.markdown.trim();
    if (!markdown) continue;
    const firstLine = markdown.split('\n').find((line) => line.trim()) ?? '';
    const hasChapterHeading = /^#\s+\S/.test(firstLine);
    if (hasChapterHeading) {
      chapters.push(markdown);
    } else {
      const chapterTitle =
        converted.title ?? (rawTitle ? htmlToPlainText(rawTitle) : null) ?? `الفصل ${index + 1}`;
      chapters.push(`# ${chapterTitle}\n\n${markdown}`);
    }
  }

  if (chapters.length === 0) throw new ArchiveError(EPUB_INVALID_MESSAGE);

  const markdown = `${buildFrontmatter({
    title,
    author: author ?? undefined,
    lang: language ?? undefined,
  })}${chapters.join('\n\n')}\n`;

  return { markdown, assets, source: 'epub', title, author: author ?? undefined };
}

/** Entries an archive import can actually use: chapters, images, and EPUB XML metadata. */
function acceptBookEntry(name: string): boolean {
  if (isArchiveJunkEntry(name)) return false;
  return (
    isArchiveTextEntry(name) ||
    isArchiveImageEntry(name) ||
    /\.(?:xhtml?|xml|opf|ncx)$/i.test(name)
  );
}

/**
 * Read `.zip` / `.epub` bytes into Markdown + assets. Throws `ArchiveError` with an Arabic message
 * for anything the reader can act on (DRM, unsafe paths, bomb-sized archives, empty books).
 */
export function readBookArchive(
  data: Uint8Array,
  fileName: string,
  options: ArchiveImportOptions = {},
): ImportedArchiveBook {
  const ext = archiveExtension(fileName);

  if (ext === 'epub') {
    const entries = readZipEntries(data, { limits: options.limits, accept: acceptBookEntry });
    return readEpubBook(entries, fileName);
  }
  if (ext === 'zip') {
    const entries = readZipEntries(data, { limits: options.limits, accept: acceptBookEntry });
    return readZipBook(entries, fileName);
  }

  // No usable extension (Android providers sometimes hand over a generic name): sniff the container.
  const entries = readZipEntries(data, { limits: options.limits, accept: acceptBookEntry });
  if (findEntryBySuffix(entries, 'META-INF/container.xml')) {
    return readEpubBook(entries, fileName);
  }
  return readZipBook(entries, fileName);
}
