import { File } from 'expo-file-system';

import { readBookTextFile } from './book-file';
import { importBookContent } from './bundle';
import type { DatabaseAdapter } from './database';
import { isSupportedBookFileName } from './importer';
import type { BookLibraryRecord } from '@/types/reader';

const EXTENSION_RE = /\.([a-z0-9]{1,10})$/i;
export const UNSUPPORTED_FORMAT_MESSAGE = 'صيغة الملف غير مدعومة. اختر ملف .md أو .txt.';

export function isBookImportUri(uri: string | null | undefined): uri is string {
  if (!uri || typeof uri !== 'string') return false;
  const trimmed = uri.trim().toLowerCase();
  return trimmed.startsWith('content://') || trimmed.startsWith('file://');
}

function decodeUriPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * A file name is only usable if it is a plain base name with a supported
 * extension. Anything else (path separators, traversal, unknown or missing
 * extension) is rejected instead of guessing `.md`.
 */
function assertUsableBookFileName(name: string): string {
  const trimmed = name.trim();
  if (
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('..')
  ) {
    throw new Error(UNSUPPORTED_FORMAT_MESSAGE);
  }
  if (!isSupportedBookFileName(trimmed)) {
    throw new Error(UNSUPPORTED_FORMAT_MESSAGE);
  }
  return trimmed;
}

/** Name offered by the content provider, when it actually carries a usable extension. */
function resolveProviderName(rawName: string): string | null {
  const decoded = decodeUriPart(rawName.trim());
  if (!decoded) return null;
  if (decoded.includes('..')) {
    throw new Error(UNSUPPORTED_FORMAT_MESSAGE);
  }
  // Providers often return a display label without an extension; then the URI decides.
  if (!EXTENSION_RE.test(decoded)) return null;
  return assertUsableBookFileName(decoded);
}

/** Last path segment of the URI, decoded once, without Android SAF decorations. */
function resolveUriSegment(uri: string): string {
  const withoutQuery = uri.split(/[?#]/)[0] ?? uri;
  const segments = withoutQuery.split('/').filter(Boolean);
  const lastSegment = segments.pop();
  if (!lastSegment) {
    throw new Error(UNSUPPORTED_FORMAT_MESSAGE);
  }

  const decoded = decodeUriPart(lastSegment);
  if (decoded.includes('..')) {
    throw new Error(UNSUPPORTED_FORMAT_MESSAGE);
  }

  // Handle Android SAF document segments like "primary:Download/novel.md"
  const afterColon = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : decoded;
  const baseName = afterColon.split(/[\\/]/).pop() ?? afterColon;
  return assertUsableBookFileName(baseName);
}

export function resolveBookFileNameFromUri(uri: string, explicitName?: string | null): string {
  const providerName = explicitName?.trim();
  if (providerName) {
    const resolved = resolveProviderName(providerName);
    if (resolved) return resolved;
  }
  return resolveUriSegment(uri);
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
  const read = await readBookTextFile(new File(uri));
  return { text: read.text, name: read.name };
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

  const { text, name } = await readFile(uri);
  const fileName = resolveBookFileNameFromUri(uri, name);

  if (!text || !text.trim()) {
    throw new Error('الملف فارغ ولا يحتوي على نص.');
  }

  return importContent(text, fileName, deps.db);
}
