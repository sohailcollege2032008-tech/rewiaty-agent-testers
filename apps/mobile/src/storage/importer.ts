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
  if (!isSupportedBookFileName(asset.name)) {
    throw new Error(UNSUPPORTED_BOOK_FORMAT_MESSAGE);
  }

  const file = asset.file ?? new File(asset.uri);

  if (isArchiveBookFileName(asset.name)) {
    return importBookArchiveFile(
      { size: asset.size, name: asset.name, bytes: () => file.bytes() },
      asset.name,
      db,
    );
  }

  const read = await readBookTextFile(file);
  return importBookContent(read.text, read.name ?? asset.name, db);
}
