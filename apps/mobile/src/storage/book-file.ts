/** Hard ceiling for a book file. Anything bigger is a mistake, not a novel. */
export const MAX_BOOK_FILE_BYTES = 20 * 1024 * 1024;
/** How far into the file we look for a NUL byte before deciding it is binary. */
const BINARY_PROBE_BYTES = 8 * 1024;
const BOM = '\uFEFF';

export const BOOK_FILE_TOO_LARGE_MESSAGE = 'الملف كبير أوي. أقصى حجم 20 ميجابايت.';
export const BOOK_FILE_BINARY_MESSAGE = 'الملف ده مش ملف نصي. اختر ملف .md أو .txt.';
export const BOOK_FILE_ENCODING_MESSAGE =
  'الملف مش بترميز UTF-8. حوّله لـ UTF-8 وجرّب تاني.';

export type ReadableBookFile = {
  size: number;
  name?: string;
  bytes: () => Promise<Uint8Array>;
};

export type BookFileRead = {
  text: string;
  name: string | null;
};

export function assertBookFileSize(sizeBytes: number): void {
  if (sizeBytes > MAX_BOOK_FILE_BYTES) {
    throw new Error(BOOK_FILE_TOO_LARGE_MESSAGE);
  }
}

/** Decode bytes as UTF-8, rejecting binary files and malformed text. */
export function decodeBookBytes(bytes: Uint8Array): string {
  const probe = Math.min(bytes.length, BINARY_PROBE_BYTES);
  for (let i = 0; i < probe; i += 1) {
    if (bytes[i] === 0) {
      throw new Error(BOOK_FILE_BINARY_MESSAGE);
    }
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(BOOK_FILE_ENCODING_MESSAGE);
  }

  return text.startsWith(BOM) ? text.slice(1) : text;
}

/**
 * Read a book file safely: the size is checked from metadata before any bytes are
 * loaded, then the bytes are decoded as strict UTF-8 with the BOM stripped.
 */
export async function readBookTextFile(file: ReadableBookFile): Promise<BookFileRead> {
  // Size first, so a 2 GB pick never lands in the JS heap.
  assertBookFileSize(file.size);
  const bytes = await file.bytes();
  // Content providers sometimes report 0 for size; re-check what we actually read.
  assertBookFileSize(bytes.byteLength);
  const name = file.name?.trim();
  return {
    text: decodeBookBytes(bytes),
    name: name ? name : null,
  };
}
