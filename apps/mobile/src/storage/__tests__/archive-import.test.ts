import { strToU8, zipSync } from 'fflate';
import { Directory, File, Paths } from 'expo-file-system';

import { EPUB_DRM_MESSAGE, MAX_ARCHIVE_FILE_BYTES } from '@rewiaty/book-format';

import {
  ARCHIVE_TOO_LARGE_FILE_MESSAGE,
  importBookArchiveBytes,
  importBookArchiveFile,
  isArchiveBookFileName,
  isArchiveBookMimeType,
} from '@/storage/archive-import';
import type { BookLibraryRecord } from '@/types/reader';

const MOCK_RECORD = { id: 'book_archive_1', title: 'كتاب تجريبي' } as BookLibraryRecord;

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const OPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>حِكَايَةُ الْاِخْتِبَارِ</dc:title>
    <dc:creator>كَاتِبُ الْاِخْتِبَارِ</dc:creator>
    <dc:language>ar</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="fig" href="images/fig.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`;

const CHAPTER = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>الفصل</title></head>
<body><h1>الْفَصْلُ الْأَوَّلُ</h1><p>نَصٌّ لِلْاِخْتِبَارِ.</p><p><img src="images/fig.png" alt="شكل"/></p></body></html>`;

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);

function buildEpub(imageBytes: Uint8Array = PNG_BYTES): Uint8Array {
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(CONTAINER_XML),
    'OEBPS/content.opf': strToU8(OPF),
    'OEBPS/ch1.xhtml': strToU8(CHAPTER),
    'OEBPS/images/fig.png': imageBytes,
    'OEBPS/style.css': strToU8('body{color:red}'),
  });
}

/** Mock of the bundle writer: it only writes book.md, exactly like the real one for this fixture. */
function bundlingImportContent() {
  return jest.fn(
    async (
      markdown: string,
      _fileName: string,
      _db: unknown,
      options?: { bookId?: string; bookDir?: Directory },
    ) => {
      if (options?.bookDir) {
        await new File(options.bookDir, 'book.md').write(markdown);
      }
      return { ...MOCK_RECORD, id: options?.bookId ?? MOCK_RECORD.id };
    },
  );
}

const TEMP_ROOT = new Directory(Paths.cache, 'rewiaty-archive-tests');

function freshRoot(): Directory {
  if (TEMP_ROOT.exists) TEMP_ROOT.delete();
  TEMP_ROOT.create({ intermediates: true, idempotent: true });
  return TEMP_ROOT;
}

describe('archive book import', () => {
  afterEach(() => {
    if (TEMP_ROOT.exists) TEMP_ROOT.delete();
  });

  it('recognises .zip/.epub by name and by MIME type', () => {
    expect(isArchiveBookFileName('رواية.zip')).toBe(true);
    expect(isArchiveBookFileName('book.EPUB')).toBe(true);
    expect(isArchiveBookFileName('book.md')).toBe(false);
    expect(isArchiveBookFileName(null)).toBe(false);
    expect(isArchiveBookMimeType('application/epub+zip')).toBe(true);
    expect(isArchiveBookMimeType('application/zip; charset=binary')).toBe(true);
    expect(isArchiveBookMimeType('text/markdown')).toBe(false);
  });

  it('writes the EPUB into the book folder as book.md + assets, through the normal bundle path', async () => {
    const root = freshRoot();
    const importContent = jest.fn().mockResolvedValue(MOCK_RECORD);
    let bookDirUsed: Directory | null = null;

    const record = await importBookArchiveBytes(buildEpub(), 'حكاية.epub', undefined, {
      importContent,
      bookDirFor: (bookId) => {
        bookDirUsed = new Directory(root, bookId);
        return bookDirUsed;
      },
    });

    expect(record).toEqual(MOCK_RECORD);
    expect(importContent).toHaveBeenCalledTimes(1);

    const [markdown, fileName] = importContent.mock.calls[0] as [string, string];
    expect(fileName).toBe('حكاية.md');
    expect(markdown).toContain('title: "حِكَايَةُ الْاِخْتِبَارِ"');
    expect(markdown).toContain('# الْفَصْلُ الْأَوَّلُ');
    expect(markdown).toContain('![شكل](assets/fig.png)');
    expect(markdown).not.toContain('color:red');

    const asset = new File(bookDirUsed as unknown as Directory, 'assets/fig.png');
    expect(asset.exists).toBe(true);
    expect(Array.from(await asset.bytes())).toEqual(Array.from(PNG_BYTES));
  });

  it('rejects an oversized archive before reading its bytes', async () => {
    const bytes = jest.fn();
    await expect(
      importBookArchiveFile(
        { size: 512 * 1024 * 1024, name: 'huge.epub', bytes },
        'huge.epub',
      ),
    ).rejects.toThrow(ARCHIVE_TOO_LARGE_FILE_MESSAGE);
    expect(bytes).not.toHaveBeenCalled();
  });

  it('rejects an archive just over the real 50 MiB limit, at the boundary', async () => {
    const bytes = jest.fn();
    // One byte past the limit proves the boundary itself; 512 MiB would pass even with a wrong cap.
    await expect(
      importBookArchiveFile(
        { size: MAX_ARCHIVE_FILE_BYTES + 1, name: 'big.epub', bytes },
        'big.epub',
      ),
    ).rejects.toThrow(ARCHIVE_TOO_LARGE_FILE_MESSAGE);
    expect(bytes).not.toHaveBeenCalled();

    // Exactly at the limit is allowed through to the reader (which then fails on the content).
    await expect(
      importBookArchiveFile(
        { size: MAX_ARCHIVE_FILE_BYTES, name: 'at-limit.epub', bytes: async () => strToU8('not a zip') },
        'at-limit.epub',
      ),
    ).rejects.not.toThrow(ARCHIVE_TOO_LARGE_FILE_MESSAGE);
  });

  it('states the real 50 MiB limit in the Arabic rejection message', () => {
    expect(ARCHIVE_TOO_LARGE_FILE_MESSAGE).toContain('50 ميجابايت');
    expect(ARCHIVE_TOO_LARGE_FILE_MESSAGE).not.toContain('100');
  });

  it('surfaces the Arabic DRM message instead of importing a locked EPUB', async () => {
    const locked = zipSync({
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8(CONTAINER_XML),
      'META-INF/rights.xml': strToU8('<rights/>'),
      'OEBPS/content.opf': strToU8(OPF),
      'OEBPS/ch1.xhtml': strToU8(CHAPTER),
    });
    const importContent = jest.fn();
    await expect(
      importBookArchiveBytes(locked, 'locked.epub', undefined, { importContent }),
    ).rejects.toThrow(EPUB_DRM_MESSAGE);
    expect(importContent).not.toHaveBeenCalled();
  });

  it('cleans up a half-written book folder when the import fails', async () => {
    const root = freshRoot();
    const importContent = jest.fn().mockRejectedValue(new Error('boom'));
    let created: Directory | null = null;

    await expect(
      importBookArchiveBytes(buildEpub(), 'fail.epub', undefined, {
        importContent,
        bookDirFor: (bookId) => {
          created = new Directory(root, bookId);
          return created;
        },
      }),
    ).rejects.toThrow('boom');

    expect(created).not.toBeNull();
    expect((created as unknown as Directory).exists).toBe(false);
    // No staging leftovers either: a failed import must leave the library root clean.
    expect(root.list()).toEqual([]);
  });

  it('keeps the previous book intact when a re-import fails after writing its assets', async () => {
    const root = freshRoot();
    const dirFor = (bookId: string) => new Directory(root, bookId);

    const first = await importBookArchiveBytes(buildEpub(), 'novel.epub', undefined, {
      importContent: bundlingImportContent(),
      bookDirFor: dirFor,
    });

    // Second import of the same archive: images are staged, then the bundle write fails.
    await expect(
      importBookArchiveBytes(buildEpub(), 'novel.epub', undefined, {
        importContent: jest.fn().mockRejectedValue(new Error('boom')),
        bookDirFor: dirFor,
      }),
    ).rejects.toThrow('boom');

    const bookDir = new Directory(root, first.id);
    expect(bookDir.exists).toBe(true);
    expect(new File(bookDir, 'book.md').exists).toBe(true);
    expect(Array.from(await new File(bookDir, 'assets/fig.png').bytes())).toEqual(Array.from(PNG_BYTES));
    expect(root.list()).toHaveLength(1);
  });

  it('does not overwrite the first book images when a second, different-image import fails', async () => {
    const root = freshRoot();
    const dirFor = (bookId: string) => new Directory(root, bookId);

    const first = await importBookArchiveBytes(buildEpub(PNG_BYTES), 'novel.epub', undefined, {
      importContent: bundlingImportContent(),
      bookDirFor: dirFor,
    });

    // Same text, different picture, and the bundle write fails after the images were staged.
    const otherPng = new Uint8Array([...PNG_BYTES, 0xde, 0xad, 0xbe, 0xef]);
    await expect(
      importBookArchiveBytes(buildEpub(otherPng), 'novel.epub', undefined, {
        importContent: jest.fn().mockRejectedValue(new Error('boom')),
        bookDirFor: dirFor,
      }),
    ).rejects.toThrow('boom');

    expect(
      Array.from(await new File(new Directory(root, first.id), 'assets/fig.png').bytes()),
    ).toEqual(Array.from(PNG_BYTES));
    expect(root.list()).toHaveLength(1);
  });

  it('gives archives with identical text but different image bytes different book ids', async () => {
    const root = freshRoot();
    const dirFor = (bookId: string) => new Directory(root, bookId);
    const otherPng = new Uint8Array([...PNG_BYTES, 0xaa, 0xbb]);

    const first = await importBookArchiveBytes(buildEpub(PNG_BYTES), 'one.epub', undefined, {
      importContent: bundlingImportContent(),
      bookDirFor: dirFor,
    });
    const second = await importBookArchiveBytes(buildEpub(otherPng), 'two.epub', undefined, {
      importContent: bundlingImportContent(),
      bookDirFor: dirFor,
    });

    expect(first.id).not.toBe(second.id);
    // Both books keep their own picture; the second import cannot overwrite the first.
    expect(
      Array.from(await new File(new Directory(root, first.id), 'assets/fig.png').bytes()),
    ).toEqual(Array.from(PNG_BYTES));
    expect(
      Array.from(await new File(new Directory(root, second.id), 'assets/fig.png').bytes()),
    ).toEqual(Array.from(otherPng));
  });

  it('maps the exact same archive to the same id, so re-importing is idempotent', async () => {
    const root = freshRoot();
    const dirFor = (bookId: string) => new Directory(root, bookId);

    const first = await importBookArchiveBytes(buildEpub(), 'novel.epub', undefined, {
      importContent: bundlingImportContent(),
      bookDirFor: dirFor,
    });
    const second = await importBookArchiveBytes(buildEpub(), 'renamed.epub', undefined, {
      importContent: bundlingImportContent(),
      bookDirFor: dirFor,
    });

    expect(second.id).toBe(first.id);
    expect(root.list()).toHaveLength(1);
  });
});
