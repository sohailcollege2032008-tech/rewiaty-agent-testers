/**
 * Safe zip reading for book imports (`.zip` chapter folders and `.epub` containers).
 *
 * Why fflate: it is pure JavaScript (no native module, no `atob`/DOM dependency), so the same
 * package runs on Hermes in the app and in node/vitest here. Native unzip libraries would need a
 * new dev-client build for a feature that is a one-off import path.
 *
 * Every entry name is validated before decompression, and the declared uncompressed sizes are
 * checked *before* fflate inflates anything, so a zip bomb is refused instead of filling the heap.
 */
import { unzipSync, type Unzipped } from 'fflate';

export const UNREADABLE_ARCHIVE_MESSAGE =
  'مقدرناش نقرا الأرشيف. اتأكد إن الملف zip سليم وجرّب تاني.';
export const UNSAFE_ARCHIVE_PATH_MESSAGE =
  'الأرشيف فيه مسار غير آمن (زي «..» أو مسار مطلق)، ورفضناه.';
export const ARCHIVE_TOO_LARGE_MESSAGE =
  'الأرشيف كبير أوي بعد فك الضغط. أقصى حجم مسموح 200 ميجابايت.';
export const ARCHIVE_TOO_MANY_FILES_MESSAGE = 'الأرشيف فيه ملفات كتير أوي، وده مش كتاب.';
export const ARCHIVE_EMPTY_MESSAGE = 'الأرشيف مفيهوش فصول نصية (.md أو .txt).';

/** Compressed input ceiling (the file the reader picked). */
export const MAX_ARCHIVE_FILE_BYTES = 100 * 1024 * 1024;
/** Decompressed ceiling for the whole archive. */
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 2000;
export const MAX_ARCHIVE_ENTRY_BYTES = 64 * 1024 * 1024;
/** A single entry that shrinks more than this (and is not tiny) is treated as a bomb. */
export const MAX_ARCHIVE_COMPRESSION_RATIO = 200;
const TINY_ENTRY_BYTES = 1024 * 1024;

export type ArchiveLimits = {
  maxUncompressedBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxCompressionRatio: number;
};

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxUncompressedBytes: MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  maxEntries: MAX_ARCHIVE_ENTRIES,
  maxEntryBytes: MAX_ARCHIVE_ENTRY_BYTES,
  maxCompressionRatio: MAX_ARCHIVE_COMPRESSION_RATIO,
};

/** Arabic-message error, so callers never have to guess whether a failure is ours or the OS's. */
export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

const DRIVE_LETTER_RE = /^[a-zA-Z]:/;

/**
 * Reject any entry that could escape the book folder (zip-slip) or that is not a plain
 * relative path. This runs for *every* entry, including ones we never read.
 */
export function assertSafeArchiveEntryName(rawName: string): string {
  const name = typeof rawName === 'string' ? rawName : '';
  if (!name || name.trim() !== name) throw new ArchiveError(UNSAFE_ARCHIVE_PATH_MESSAGE);
  if (name.includes('\\')) throw new ArchiveError(UNSAFE_ARCHIVE_PATH_MESSAGE);
  if (name.startsWith('/') || name.startsWith('~')) {
    throw new ArchiveError(UNSAFE_ARCHIVE_PATH_MESSAGE);
  }
  if (DRIVE_LETTER_RE.test(name)) throw new ArchiveError(UNSAFE_ARCHIVE_PATH_MESSAGE);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(name)) throw new ArchiveError(UNSAFE_ARCHIVE_PATH_MESSAGE);
  for (const segment of name.split('/')) {
    if (segment === '..') throw new ArchiveError(UNSAFE_ARCHIVE_PATH_MESSAGE);
  }
  return name;
}

/** Is this archive entry a book chapter file we understand? */
export function isArchiveTextEntry(name: string): boolean {
  return /\.(?:md|markdown|txt)$/i.test(name);
}

/** Raster images only: SVG can carry script payloads and the reader never needed it. */
export function isArchiveImageEntry(name: string): boolean {
  return /\.(?:png|jpe?g|gif|webp|avif)$/i.test(name);
}

/** macOS writes `__MACOSX/...` resource forks and dot-files into zips; neither is a chapter. */
export function isArchiveJunkEntry(name: string): boolean {
  if (name.startsWith('__MACOSX/')) return true;
  return name
    .split('/')
    .some((segment) => segment.startsWith('.') && segment !== '.' && segment !== '');
}

export type ReadZipOptions = {
  limits?: Partial<ArchiveLimits>;
  /** Entries to actually inflate; everything else is validated then skipped. */
  accept?: (name: string) => boolean;
};

function resolveLimits(overrides?: Partial<ArchiveLimits>): ArchiveLimits {
  return { ...DEFAULT_ARCHIVE_LIMITS, ...(overrides ?? {}) };
}

/**
 * Read the entries matching `accept`, enforcing name safety and zip-bomb limits on every entry.
 * Directory entries are ignored. Throws `ArchiveError` with an Arabic message.
 */
export function readZipEntries(data: Uint8Array, options: ReadZipOptions = {}): Map<string, Uint8Array> {
  const limits = resolveLimits(options.limits);
  const accept = options.accept ?? (() => true);

  let entryCount = 0;
  let totalUncompressed = 0;

  let zipped: Unzipped;
  try {
    zipped = unzipSync(data, {
      filter: (file) => {
        const name = assertSafeArchiveEntryName(file.name);
        entryCount += 1;
        if (entryCount > limits.maxEntries) {
          throw new ArchiveError(ARCHIVE_TOO_MANY_FILES_MESSAGE);
        }
        const originalSize = Number.isFinite(file.originalSize) ? file.originalSize : 0;
        if (originalSize > limits.maxEntryBytes) {
          throw new ArchiveError(ARCHIVE_TOO_LARGE_MESSAGE);
        }
        totalUncompressed += originalSize;
        if (totalUncompressed > limits.maxUncompressedBytes) {
          throw new ArchiveError(ARCHIVE_TOO_LARGE_MESSAGE);
        }
        if (
          originalSize > TINY_ENTRY_BYTES &&
          file.size > 0 &&
          originalSize / file.size > limits.maxCompressionRatio
        ) {
          throw new ArchiveError(ARCHIVE_TOO_LARGE_MESSAGE);
        }
        if (name.endsWith('/')) return false;
        return accept(name);
      },
    });
  } catch (err) {
    if (err instanceof ArchiveError) throw err;
    throw new ArchiveError(UNREADABLE_ARCHIVE_MESSAGE);
  }

  const entries = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(zipped)) {
    if (bytes) entries.set(name, bytes);
  }
  return entries;
}

/**
 * Turn an archive path into a flat, safe file name under `assets/`.
 * Unicode (Arabic file names) is preserved; anything that could be a path separator,
 * traversal marker or control character becomes `-`.
 */
export function toSafeAssetPath(entryName: string, used: Set<string>): string {
  const base = entryName.split('/').filter(Boolean).pop() ?? 'image';
  const cleaned = base
    .replace(/[\u0000-\u001f]/g, '')
    // eslint-disable-next-line no-useless-escape
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 80);
  const fallback = cleaned || 'image';
  let candidate = fallback;
  let counter = 2;
  while (used.has(candidate)) {
    const dot = fallback.lastIndexOf('.');
    const stem = dot > 0 ? fallback.slice(0, dot) : fallback;
    const ext = dot > 0 ? fallback.slice(dot) : '';
    candidate = `${stem}-${counter}${ext}`;
    counter += 1;
  }
  used.add(candidate);
  return `assets/${candidate}`;
}
