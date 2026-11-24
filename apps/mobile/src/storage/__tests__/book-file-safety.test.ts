import { File, Paths } from 'expo-file-system';

import {
  BOOK_FILE_BINARY_MESSAGE,
  BOOK_FILE_ENCODING_MESSAGE,
  BOOK_FILE_TOO_LARGE_MESSAGE,
  MAX_BOOK_FILE_BYTES,
  decodeBookBytes,
  readBookTextFile,
} from '@/storage/book-file';
import { importBookFromUri, resolveBookFileNameFromUri } from '@/storage/intent-import';
import type { BookLibraryRecord } from '@/types/reader';

const MOCK_RECORD = { id: 'book_safe_1' } as BookLibraryRecord;
const pad = (name: string) => `file:///mock/cache/${name}`;

function writeBytes(name: string, bytes: Uint8Array): File {
  const file = new File(Paths.cache, name);
  file.write(bytes);
  return file;
}

describe('book file size, type and encoding guards', () => {
  it('rejects a file bigger than 20 MB before reading its bytes', async () => {
    const oversized = new Uint8Array(MAX_BOOK_FILE_BYTES + 1);
    writeBytes('oversized.md', oversized);

    const importContent = jest.fn().mockResolvedValue(MOCK_RECORD);
    await expect(
      importBookFromUri(pad('oversized.md'), { importContent }),
    ).rejects.toThrow(BOOK_FILE_TOO_LARGE_MESSAGE);

    expect(importContent).not.toHaveBeenCalled();
  });

  it('checks the size from metadata, so a huge file is never loaded', async () => {
    const bytes = jest.fn().mockRejectedValue(new Error('must not read'));
    await expect(
      readBookTextFile({ size: MAX_BOOK_FILE_BYTES + 1, name: 'huge.md', bytes }),
    ).rejects.toThrow(BOOK_FILE_TOO_LARGE_MESSAGE);
    expect(bytes).not.toHaveBeenCalled();
  });

  it('rejects a binary file that has a NUL byte in the first 8 KB', async () => {
    writeBytes('binary.md', new Uint8Array([0x23, 0x20, 0x00, 0x41, 0x42]));

    const importContent = jest.fn().mockResolvedValue(MOCK_RECORD);
    await expect(importBookFromUri(pad('binary.md'), { importContent })).rejects.toThrow(
      BOOK_FILE_BINARY_MESSAGE,
    );
    expect(importContent).not.toHaveBeenCalled();
  });

  it('rejects bytes that are not valid UTF-8', async () => {
    writeBytes('broken.md', new Uint8Array([0x23, 0x20, 0xc3, 0x28, 0x0a]));

    const importContent = jest.fn().mockResolvedValue(MOCK_RECORD);
    await expect(importBookFromUri(pad('broken.md'), { importContent })).rejects.toThrow(
      BOOK_FILE_ENCODING_MESSAGE,
    );
    expect(importContent).not.toHaveBeenCalled();
  });

  it('strips the UTF-8 BOM before handing the text to the importer', async () => {
    writeBytes(
      'bom.md',
      new TextEncoder().encode('\uFEFF# الفصل الأول\n\nنص الكتاب.'),
    );

    const importContent = jest.fn().mockResolvedValue(MOCK_RECORD);
    await importBookFromUri(pad('bom.md'), { importContent });

    const [text, fileName] = importContent.mock.calls[0] as [string, string];
    expect(text.startsWith('#')).toBe(true);
    expect(text).toBe('# الفصل الأول\n\nنص الكتاب.');
    expect(fileName).toBe('bom.md');
  });

  it('decodes a normal UTF-8 file', () => {
    expect(decodeBookBytes(new TextEncoder().encode('نص عربي'))).toBe('نص عربي');
  });
});

describe('book file names are never guessed', () => {
  it('rejects an encoded traversal segment', () => {
    expect(() =>
      resolveBookFileNameFromUri('file:///storage/emulated/0/Download/%2F..%2Fetc%2Fpasswd'),
    ).toThrow('صيغة الملف غير مدعومة');
    expect(() =>
      resolveBookFileNameFromUri('content://com.android.providers/document/%2F..%2Fetc%2Fpasswd'),
    ).toThrow('صيغة الملف غير مدعومة');
  });

  it('rejects traversal inside a provider-supplied name', () => {
    expect(() =>
      resolveBookFileNameFromUri('file:///storage/Download/novel.md', '../../etc/passwd.md'),
    ).toThrow('صيغة الملف غير مدعومة');
    expect(() =>
      resolveBookFileNameFromUri('file:///storage/Download/novel.md', 'sub/dir/novel.md'),
    ).toThrow('صيغة الملف غير مدعومة');
    expect(() =>
      resolveBookFileNameFromUri('file:///storage/Download/novel.md', 'sub\\dir\\novel.md'),
    ).toThrow('صيغة الملف غير مدعومة');
  });

  it('rejects an unknown extension and a missing extension instead of appending .md', () => {
    expect(() => resolveBookFileNameFromUri('file:///storage/Download/book.pdf')).toThrow(
      'صيغة الملف غير مدعومة',
    );
    expect(() => resolveBookFileNameFromUri('file:///storage/Download/book')).toThrow(
      'صيغة الملف غير مدعومة',
    );
    expect(() => resolveBookFileNameFromUri('file:///storage/Download/')).toThrow(
      'صيغة الملف غير مدعومة',
    );
  });

  it('accepts .md, .markdown and .txt in any letter case', () => {
    expect(resolveBookFileNameFromUri('file:///storage/Download/Novel.MD')).toBe('Novel.MD');
    expect(resolveBookFileNameFromUri('file:///storage/Download/book.Markdown')).toBe(
      'book.Markdown',
    );
    expect(resolveBookFileNameFromUri('file:///storage/Download/book.TxT')).toBe('book.TxT');
  });

  it('prefers a usable provider name and falls back to the URI when the provider has no extension', () => {
    expect(
      resolveBookFileNameFromUri('file:///storage/Download/9f3a1b', 'رواية القمر.md'),
    ).toBe('رواية القمر.md');
    expect(resolveBookFileNameFromUri('file:///storage/Download/novel.txt', 'novel')).toBe(
      'novel.txt',
    );
  });
});
