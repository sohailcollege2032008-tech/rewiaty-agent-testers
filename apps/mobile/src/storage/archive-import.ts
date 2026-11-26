import { Directory, File } from 'expo-file-system';

import {
  MAX_ARCHIVE_FILE_BYTES,
  readBookArchive,
  type ImportedArchiveBook,
} from '@rewiaty/book-format';

import { computeArchiveBookId } from './book-id';
import { getBookDir, importBookContent, type ImportBookContentOptions } from './bundle';
import type { DatabaseAdapter } from './database';
import type { BookLibraryRecord } from '@/types/reader';

const MAX_ARCHIVE_FILE_MEGABYTES = Math.round(MAX_ARCHIVE_FILE_BYTES / (1024 * 1024));

export const ARCHIVE_TOO_LARGE_FILE_MESSAGE = `الملف المضغوط كبير أوي. أقصى حجم ${MAX_ARCHIVE_FILE_MEGABYTES} ميجابايت.`;
export const ARCHIVE_READ_FAILED_MESSAGE = 'مقدرناش نقرا ملف الكتاب المضغوط. جرّب تنزّله تاني.';

const ARCHIVE_EXT_RE = /\.(?:zip|epub)$/i;
const STAGING_SUFFIX_RE = /^(.*)\.staging-(?:[a-z0-9]+)$/i;

/** Monotonic token so two imports of the same book never share a staging folder. */
let stagingCounter = 0;
function nextStagingToken(): string {
  stagingCounter += 1;
  return `${Date.now().toString(36)}${stagingCounter.toString(36)}`;
}

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
    options?: ImportBookContentOptions,
  ) => Promise<BookLibraryRecord>;
  bookDirFor?: (bookId: string) => Directory;
};

export type ReadableArchiveFile = {
  size?: number | null;
  name?: string | null;
  bytes: () => Promise<Uint8Array>;
};

/** Best-effort removal of staging folders a previous crash left behind for this book id. */
function pruneStaleStaging(bookDir: Directory, bookId: string): void {
  const parent = bookDir.parentDirectory;
  if (!parent.exists) return;
  let children: (Directory | File)[];
  try {
    children = parent.list();
  } catch {
    return;
  }
  for (const child of children) {
    if (!(child instanceof Directory)) continue;
    if (STAGING_SUFFIX_RE.exec(child.name)?.[1] !== bookId) continue;
    try {
      child.delete();
    } catch {
      /* best effort */
    }
  }
}

/**
 * Import `.zip` / `.epub` bytes: the archive is converted to Markdown in `book-format`, the images
 * and the Markdown are written into a *staging* folder, and only a fully successful import is moved
 * onto `books/<id>`. A failure (including one while writing an image) leaves the previous book
 * untouched instead of half-overwriting its assets.
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

  // Identity covers the images too: same Markdown + different pictures is a different book, so the
  // second import can no longer land on the first book's id and overwrite its assets.
  const id = computeArchiveBookId(imported.markdown, imported.assets);
  const finalDir = bookDirFor(id);
  const parent = finalDir.parentDirectory;
  const bookDirName = finalDir.name;

  pruneStaleStaging(finalDir, id);

  const token = nextStagingToken();
  const stagingDir = new Directory(parent, `${bookDirName}.staging-${token}`);
  const backupDir = new Directory(parent, `${bookDirName}.old-${token}`);
  let committed = false;

  try {
    stagingDir.create({ intermediates: true, idempotent: true });

    // Re-importing the same book must keep reading progress: carry the state file into staging
    // before the old folder is replaced.
    const liveDir = new Directory(parent, bookDirName);
    if (liveDir.exists) {
      const previousState = new File(liveDir, '.reader-state.json');
      if (previousState.exists) {
        await new File(stagingDir, '.reader-state.json').write(await previousState.bytes());
      }
    }

    const assetsDir = new Directory(stagingDir, 'assets');
    assetsDir.create({ intermediates: true, idempotent: true });
    for (const asset of imported.assets) {
      const target = new File(stagingDir, asset.path);
      await target.write(asset.bytes);
    }

    const record = await importContent(imported.markdown, markdownFileNameForArchive(fileName), db, {
      bookId: id,
      bookDir: stagingDir,
    });

    // Swap in the finished bundle. The old folder is only renamed aside, so a failed move restores it.
    let backedUp = false;
    if (liveDir.exists) {
      liveDir.rename(backupDir.name);
      backedUp = true;
    }
    try {
      stagingDir.rename(bookDirName);
      committed = true;
    } catch (err) {
      if (backedUp && backupDir.exists) {
        try {
          backupDir.rename(bookDirName);
        } catch {
          /* best effort restore */
        }
      }
      throw err;
    }
    if (backupDir.exists) {
      try {
        backupDir.delete();
      } catch {
        /* best effort */
      }
    }
    return record;
  } finally {
    if (!committed && stagingDir.exists) {
      try {
        stagingDir.delete();
      } catch {
        /* best effort */
      }
    }
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
