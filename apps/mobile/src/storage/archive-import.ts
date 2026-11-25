import { Directory, File } from 'expo-file-system';

import {
  MAX_ARCHIVE_FILE_BYTES,
  readBookArchive,
  type ImportedArchiveBook,
} from '@rewiaty/book-format';

import { computeBookId } from './book-id';
import { getBookDir, importBookContent } from './bundle';
import type { DatabaseAdapter } from './database';
import type { BookLibraryRecord } from '@/types/reader';

export const ARCHIVE_TOO_LARGE_FILE_MESSAGE = 'الملف المضغوط كبير أوي. أقصى حجم 100 ميجابايت.';
export const ARCHIVE_READ_FAILED_MESSAGE = 'مقدرناش نقرا ملف الكتاب المضغوط. جرّب تنزّله تاني.';

const ARCHIVE_EXT_RE = /\.(?:zip|epub)$/i;

export function isArchiveBookFileName(fileName: string | null | undefined): boolean {
  return typeof fileName === 'string' && ARCHIVE_EXT_RE.test(fileName.trim());
}

const ARCHIVE_MIME: Record<string, true> = {
  'application/zip': true,
  'application/epub+zip': true,
  'application/x-zip-compressed': true,
};

/** A provider can hand over an archive with no usable extension but the right MIME type. */
export function isArchiveBookMimeType(mimeType: string | null | undefined): boolean {
  const base = mimeType?.split(';')[0]?.trim().toLowerCase();
  return Boolean(base && Object.hasOwn(ARCHIVE_MIME, base));
}

function markdownFileNameForArchive(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? fileName).replace(ARCHIVE_EXT_RE, '').trim();
  return `${base || 'كتاب'}.md`;
}

export type ArchiveImportDeps = {
  importContent?: (
    rawText: string,
    fileName: string,
    db?: DatabaseAdapter,
  ) => Promise<BookLibraryRecord>;
  bookDirFor?: (bookId: string) => Directory;
};

export type ReadableArchiveFile = {
  size?: number | null;
  name?: string | null;
  bytes: () => Promise<Uint8Array>;
};

/**
 * Import `.zip` / `.epub` bytes: the archive is converted to Markdown in `book-format`, the images
 * are written into the book's `assets/` folder, and the Markdown then follows the exact same
 * bundle path as a picked `.md` file (same hash id, manifest, search index).
 */
export async function importBookArchiveBytes(
  bytes: Uint8Array,
  fileName: string,
  db?: DatabaseAdapter,
  deps: ArchiveImportDeps = {},
): Promise<BookLibraryRecord> {
  if (bytes.byteLength > MAX_ARCHIVE_FILE_BYTES) {
    throw new Error(ARCHIVE_TOO_LARGE_FILE_MESSAGE);
  }

  const imported: ImportedArchiveBook = readBookArchive(bytes, fileName);
  const importContent = deps.importContent ?? importBookContent;
  const bookDirFor = deps.bookDirFor ?? getBookDir;

  const id = computeBookId(imported.markdown);
  const bookDir = bookDirFor(id);
  const existedBefore = bookDir.exists;
  bookDir.create({ intermediates: true, idempotent: true });

  const assetsDir = new Directory(bookDir, 'assets');
  assetsDir.create({ intermediates: true, idempotent: true });
  for (const asset of imported.assets) {
    const target = new File(bookDir, asset.path);
    await target.write(asset.bytes);
  }

  try {
    return await importContent(imported.markdown, markdownFileNameForArchive(fileName), db);
  } catch (err) {
    // A failed import must not leave half-written images behind for a book that never existed.
    if (!existedBefore) {
      try {
        bookDir.delete();
      } catch {
        /* best effort */
      }
    }
    throw err;
  }
}

/** Read an archive file with the compressed-size ceiling applied before the bytes reach memory. */
export async function importBookArchiveFile(
  file: ReadableArchiveFile,
  fileName: string,
  db?: DatabaseAdapter,
  deps: ArchiveImportDeps = {},
): Promise<BookLibraryRecord> {
  const declaredSize = typeof file.size === 'number' ? file.size : 0;
  if (declaredSize > MAX_ARCHIVE_FILE_BYTES) {
    throw new Error(ARCHIVE_TOO_LARGE_FILE_MESSAGE);
  }
  const bytes = await file.bytes();
  return importBookArchiveBytes(bytes, fileName, db, deps);
}
