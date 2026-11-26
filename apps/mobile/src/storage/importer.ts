import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { importBookArchiveFile, isArchiveBookFileName } from './archive-import';
import { readBookTextFile } from './book-file';
import { importBookContent } from './bundle';
import type { DatabaseAdapter } from './database';
import type { BookLibraryRecord } from '@/types/reader';

const SUPPORTED_EXT_RE = /\.(?:md|markdown|txt|zip|epub)$/i;

export const UNSUPPORTED_BOOK_FORMAT_MESSAGE =
  'صيغة الملف غير مدعومة. اختر ملف .md أو .txt أو .zip أو .epub.';

export function isSupportedBookFileName(fileName: string): boolean {
  return SUPPORTED_EXT_RE.test(fileName.trim());
}

export async function pickAndImportBook(
  db?: DatabaseAdapter,
): Promise<BookLibraryRecord | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      'text/markdown',
      'text/plain',
      'text/x-markdown',
      'application/zip',
      'application/epub+zip',
      '*/*',
    ],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0]!;
  const file = asset.file ?? new File(asset.uri);

  // Why (bug #45): with `copyToCacheDirectory`, `asset.uri` points at a cache copy whose file name
  // is a UUID, so the file's own name is useless for the reader. `asset.name` is the name that was
  // actually picked ("قصتي.txt"), and it is the one the title is derived from. Only fall back to
  // the file's own name when the picker offers nothing usable.
  const pickedName = typeof asset.name === 'string' ? asset.name.trim() : '';
  const fileSystemName = typeof file.name === 'string' ? file.name.trim() : '';
  const fileName = pickedName || fileSystemName;

  if (!isSupportedBookFileName(fileName)) {
    throw new Error(UNSUPPORTED_BOOK_FORMAT_MESSAGE);
  }

  if (isArchiveBookFileName(fileName)) {
    return importBookArchiveFile(
      { size: asset.size, name: fileName, bytes: () => file.bytes() },
      fileName,
      db,
    );
  }

  const read = await readBookTextFile(file);
  return importBookContent(read.text, fileName, db);
}
