import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { importBookContent } from './bundle';
import type { DatabaseAdapter } from './database';
import type { BookLibraryRecord } from '@/types/reader';

const SUPPORTED_EXT_RE = /\.(?:md|markdown|txt)$/i;

export function isSupportedBookFileName(fileName: string): boolean {
  return SUPPORTED_EXT_RE.test(fileName.trim());
}

export async function pickAndImportBook(
  db?: DatabaseAdapter,
): Promise<BookLibraryRecord | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/markdown', 'text/plain', 'text/x-markdown', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0]!;
  if (!isSupportedBookFileName(asset.name)) {
    throw new Error('صيغة الملف غير مدعومة. اختر ملف .md أو .txt.');
  }

  const content = asset.file
    ? await asset.file.text()
    : await new File(asset.uri).text();

  return importBookContent(content, asset.name, db);
}
