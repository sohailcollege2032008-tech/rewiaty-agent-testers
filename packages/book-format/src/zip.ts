/**
 * Safe zip reading for book imports (`.zip` chapter folders and `.epub` containers).
 *
 * Why fflate: it is pure JavaScript (no native module, no `atob`/DOM dependency), so the same
 * package runs on Hermes in the app and in node/vitest here. Native unzip libraries would need a
 * new dev-client build for a feature that is a one-off import path.
 *
 * Two layers guard against a zip bomb:
 *  1. The central directory is read by hand *before* anything is inflated, so entry count, declared
 *     sizes and declared compression ratios are checked without trusting the local headers.
 *  2. Extraction is streamed (`fflate.Unzip`), counting the bytes actually produced. A central
 *     directory whose `originalSize` is a lie cannot get past the real counter.
 *
 * Entry names are validated before decompression and compared in NFC form, so the same Arabic file
 * name written with combining marks in the archive and in an href still resolves to one asset.
 */
import { strFromU8, Unzip, UnzipInflate } from 'fflate';

export const UNREADABLE_ARCHIVE_MESSAGE =
  'مقدرناش نقرا الأرشيف. اتأكد إن الملف zip سليم وجرّب تاني.';
export const UNSAFE_ARCHIVE_PATH_MESSAGE =
  'الأرشيف فيه مسار غير آمن (زي «..» أو مسار مطلق)، ورفضناه.';
export const ARCHIVE_TOO_LARGE_MESSAGE =
  'الأرشيف كبير أوي بعد فك الضغط. أقصى حجم مسموح 150 ميجابايت.';
export const ARCHIVE_TOO_MANY_FILES_MESSAGE = 'الأرشيف فيه ملفات كتير أوي، وده مش كتاب.';
export const ARCHIVE_EMPTY_MESSAGE = 'الأرشيف مفيهوش فصول نصية (.md أو .txt).';

/** Compressed input ceiling (the file the reader picked). */
export const MAX_ARCHIVE_FILE_BYTES = 50 * 1024 * 1024;
/** Decompressed ceiling for the whole archive. */
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 150 * 1024 * 1024;
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
 *
 * The returned name is NFC-normalised: archive writers and EPUB hrefs frequently disagree about
 * decomposed Arabic letters, and comparing raw code units would silently lose an image.
 */
export function assertSafeArchiveEntryName(rawName: string): string {
  const raw = typeof rawName === 'string' ? rawName : '';
  const name = raw.normalize('NFC');
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

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const CENTRAL_HEADER_BYTES = 46;

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

type DeclaredEntry = {
  name: string;
  compressedBytes: number;
  uncompressedBytes: number;
};

/**
 * Walk the central directory without inflating anything and reject an archive whose *declared*
 * shape already exceeds the budget. The local headers are ignored on purpose: a bomb author can
 * write whatever they like there, and the central directory is the copy every reader trusts.
 */
function readCentralDirectory(
  data: Uint8Array,
  limits: ArchiveLimits,
  accept: (name: string) => boolean,
): DeclaredEntry[] {
  if (data.length < 22) throw new ArchiveError(UNREADABLE_ARCHIVE_MESSAGE);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  let eocd = -1;
  const earliest = Math.max(0, data.length - 22 - 0xffff);
  for (let i = data.length - 22; i >= earliest; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ArchiveError(UNREADABLE_ARCHIVE_MESSAGE);

  const totalEntries = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);

  // ZIP64 markers mean a >4GB archive or >65535 entries; both are far outside the import budget.
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new ArchiveError(ARCHIVE_TOO_LARGE_MESSAGE);
  }
  if (totalEntries > limits.maxEntries) throw new ArchiveError(ARCHIVE_TOO_MANY_FILES_MESSAGE);
  if (centralOffset + centralSize > data.length) throw new ArchiveError(UNREADABLE_ARCHIVE_MESSAGE);

  const entries: DeclaredEntry[] = [];
  const end = centralOffset + centralSize;
  let cursor = centralOffset;
  let declaredTotal = 0;

  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + CENTRAL_HEADER_BYTES > end || view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new ArchiveError(UNREADABLE_ARCHIVE_MESSAGE);
    }
    const flags = view.getUint16(cursor + 8, true);
    const compressedBytes = view.getUint32(cursor + 20, true);
    const uncompressedBytes = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const nameStart = cursor + CENTRAL_HEADER_BYTES;
    if (nameStart + nameLength > end) throw new ArchiveError(UNREADABLE_ARCHIVE_MESSAGE);

    const nameBytes = data.subarray(nameStart, nameStart + nameLength);
    // Bit 11 is the "names are UTF-8" flag; without it the spec says CP437, and fflate reads the
    // same bytes as Latin-1. Anything that matters for safety (NUL, separators, drive letters) is
    // ASCII and decodes identically either way.
    const rawName =
      (flags & 0x800) !== 0
        ? strFromU8(nameBytes)
        : latin1(nameBytes);
    const name = assertSafeArchiveEntryName(rawName);

    if (!name.endsWith('/') && accept(name)) {
      if (uncompressedBytes > limits.maxEntryBytes) throw new ArchiveError(ARCHIVE_TOO_LARGE_MESSAGE);
      declaredTotal += uncompressedBytes;
      if (declaredTotal > limits.maxUncompressedBytes) {
        throw new ArchiveError(ARCHIVE_TOO_LARGE_MESSAGE);
      }
      if (
        uncompressedBytes > TINY_ENTRY_BYTES &&
        compressedBytes > 0 &&
        uncompressedBytes / compressedBytes > limits.maxCompressionRatio
      ) {
        throw new ArchiveError(ARCHIVE_TOO_LARGE_MESSAGE);
      }
    }
    entries.push({ name, compressedBytes, uncompressedBytes });
    cursor = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * Read the entries matching `accept`, enforcing name safety and zip-bomb limits on every entry.
 * Directory entries are ignored. Throws `ArchiveError` with an Arabic message.
 *
 * The declared sizes are checked first (central directory), then the real inflated bytes are
 * counted as they stream in, so a lying `originalSize` still cannot exhaust memory.
 */
export function readZipEntries(data: Uint8Array, options: ReadZipOptions = {}): Map<string, Uint8Array> {
  const limits = resolveLimits(options.limits);
  const accept = options.accept ?? (() => true);

  readCentralDirectory(data, limits, accept);

  const entries = new Map<string, Uint8Array>();
  let actualTotal = 0;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    const name = assertSafeArchiveEntryName(file.name);
    // Skipping means *not* calling `start()`: fflate then walks the compressed bytes without
    // inflating them, so an entry we would discard can never cost the heap anything.
    if (name.endsWith('/') || !accept(name)) return;

    const chunks: Uint8Array[] = [];
    let entryBytes = 0;
    file.ondata = (err, chunk, final) => {
      // fflate reports a throwing `ondata` back to us as an error argument (its inflate wrapper
      // catches and re-dispatches), so the error must be re-raised here or a bomb would be
      // "recovered" into a truncated entry.
      if (err) {
        throw err instanceof ArchiveError ? err : new ArchiveError(UNREADABLE_ARCHIVE_MESSAGE);
      }
      if (chunk && chunk.length > 0) {
        entryBytes += chunk.length;
        actualTotal += chunk.length;
        if (entryBytes > limits.maxEntryBytes || actualTotal > limits.maxUncompressedBytes) {
          throw new ArchiveError(ARCHIVE_TOO_LARGE_MESSAGE);
        }
        chunks.push(chunk);
      }
      if (final) {
        const bytes = new Uint8Array(entryBytes);
        let offset = 0;
        for (const part of chunks) {
          bytes.set(part, offset);
          offset += part.length;
        }
        entries.set(name, bytes);
        chunks.length = 0;
      }
    };
    file.start();
  };

  try {
    unzip.push(data, true);
  } catch (err) {
    if (err instanceof ArchiveError) throw err;
    throw new ArchiveError(UNREADABLE_ARCHIVE_MESSAGE);
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
