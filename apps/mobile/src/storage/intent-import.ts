import { File } from 'expo-file-system';

import { importBookContent } from './bundle';
import type { DatabaseAdapter } from './database';
import { isSupportedBookFileName } from './importer';
import type { BookLibraryRecord } from '@/types/reader';

const EXPLICIT_EXT_RE = /\.([a-z0-9]{1,10})$/i;

export function isBookImportUri(uri: string | null | undefined): uri is string {
  if (!uri || typeof uri !== 'string') return false;
  const trimmed = uri.trim().toLowerCase();
  return trimmed.startsWith('content://') || trimmed.startsWith('file://');
}

export function resolveBookFileNameFromUri(uri: string, explicitName?: string | null): string {
  const cleanedExplicit = explicitName?.trim();
  if (cleanedExplicit) {
    if (EXPLICIT_EXT_RE.test(cleanedExplicit)) {
      if (!isSupportedBookFileName(cleanedExplicit)) {
        throw new Error('صيغة الملف غير مدعومة. اختر ملف .md أو .txt.');
      }
      return cleanedExplicit;
    }
    return `${cleanedExplicit}.md`;
  }

  const withoutQuery = uri.split(/[?#]/)[0] ?? uri;
  const lastSegmentRaw = withoutQuery.split('/').filter(Boolean).pop() ?? 'imported-book.md';
  let decoded = lastSegmentRaw;
  try {
    decoded = decodeURIComponent(lastSegmentRaw);
  } catch {
    decoded = lastSegmentRaw;
  }

  // Handle Android SAF document segments like "primary:Download/novel.md"
  const afterColon = decoded.includes(':') ? (decoded.split(':').pop() ?? decoded) : decoded;
  const baseName = afterColon.split(/[\\/]/).filter(Boolean).pop() ?? 'imported-book.md';

  if (EXPLICIT_EXT_RE.test(baseName)) {
    if (!isSupportedBookFileName(baseName)) {
      throw new Error('صيغة الملف غير مدعومة. اختر ملف .md أو .txt.');
    }
    return baseName;
  }

  // Some Android content:// URIs omit the extension (e.g. content://media/external/file/42)
  return `${baseName || 'imported-book'}.md`;
}

export type ImportFromUriDeps = {
  readFile?: (uri: string) => Promise<{ text: string; name?: string | null }>;
  importContent?: (
    rawText: string,
    fileName: string,
    db?: DatabaseAdapter,
  ) => Promise<BookLibraryRecord>;
  db?: DatabaseAdapter;
};

async function defaultReadFile(uri: string): Promise<{ text: string; name?: string | null }> {
  const file = new File(uri);
  const text = await file.text();
  return { text, name: file.name };
}

export async function importBookFromUri(
  uri: string,
  deps: ImportFromUriDeps = {},
): Promise<BookLibraryRecord> {
  if (!isBookImportUri(uri)) {
    throw new Error('رابط الملف غير مدعوم.');
  }

  const readFile = deps.readFile ?? defaultReadFile;
  const importContent = deps.importContent ?? importBookContent;

  // Validate URI path extension early if an explicit unsupported extension is present
  const preliminaryName = resolveBookFileNameFromUri(uri);
  const { text, name } = await readFile(uri);
  const fileName = name ? resolveBookFileNameFromUri(uri, name) : preliminaryName;

  if (!text || !text.trim()) {
    throw new Error('الملف فارغ ولا يحتوي على نص.');
  }

  return importContent(text, fileName, deps.db);
}
