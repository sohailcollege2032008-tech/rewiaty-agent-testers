import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';

import { importBookArchiveFile } from '@/storage/archive-import';
import { importBookContent } from '@/storage/bundle';
import type { DatabaseAdapter } from '@/storage/database';
import { pickAndImportBook } from '@/storage/importer';

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: jest.fn(),
  },
}));

jest.mock('@/storage/archive-import', () => {
  const actual = jest.requireActual('@/storage/archive-import');
  return {
    ...actual,
    importBookArchiveFile: jest.fn(),
  };
});

// The name handed to `importBookContent` is exactly what Issue #45 is about, so the real
// implementation is kept and observed through a spy instead of being replaced by a stub.
jest.mock('@/storage/bundle', () => {
  const actual = jest.requireActual('@/storage/bundle');
  return {
    ...actual,
    importBookContent: jest.fn(actual.importBookContent),
  };
});

const mockImportBookContent = importBookContent as jest.MockedFunction<typeof importBookContent>;
const mockImportBookArchiveFile = importBookArchiveFile as jest.MockedFunction<
  typeof importBookArchiveFile
>;

/** `copyToCacheDirectory` lands the pick under a UUID, which is not the user's file name. */
const CACHE_UUID = 'deab4f75-55b7-4df6-941d-f64456e21ee0';

function createInMemoryDb(): DatabaseAdapter {
  return {
    async execAsync() {},
    async runAsync() {},
    async getFirstAsync() {
      return null;
    },
    async getAllAsync() {
      return [];
    },
  } as unknown as DatabaseAdapter;
}

async function writeCacheCopy(cacheName: string, text: string): Promise<File> {
  const file = new File(Paths.cache, cacheName);
  await file.write(text);
  return file;
}

function pickOnce(asset: { name: string; uri: string; size?: number }): void {
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
    canceled: false,
    assets: [{ ...asset, lastModified: 1 }],
  });
}

describe('pickAndImportBook file naming', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the picked file name, not the UUID of the cache copy', async () => {
    const cacheCopy = await writeCacheCopy(`${CACHE_UUID}.txt`, 'كان يا ما كان في قديم الزمان.');
    pickOnce({ name: 'قصتي.txt', uri: cacheCopy.uri });

    const record = await pickAndImportBook(createInMemoryDb());

    const passedName = mockImportBookContent.mock.calls[0]?.[1];
    expect(passedName).toBe('قصتي.txt');
    expect(passedName).not.toContain(CACHE_UUID);
    expect(record?.title).toBe('قصتي');
  });

  it('keeps the picked name for markdown too', async () => {
    const cacheCopy = await writeCacheCopy(`${CACHE_UUID}.md`, '# فصل أول\n\nنص الكتاب.');
    pickOnce({ name: 'edge-cases.md', uri: cacheCopy.uri });

    const record = await pickAndImportBook(createInMemoryDb());

    expect(mockImportBookContent.mock.calls[0]?.[1]).toBe('edge-cases.md');
    expect(record?.title).toBe('edge-cases');
  });

  it('falls back to the read file name when the picker offers no name', async () => {
    const cacheCopy = await writeCacheCopy(`${CACHE_UUID}.md`, 'نص بدون اسم من المنتقي.');
    pickOnce({ name: '', uri: cacheCopy.uri });

    await pickAndImportBook(createInMemoryDb());

    const passedName = mockImportBookContent.mock.calls[0]?.[1];
    expect(passedName).toBeTruthy();
    expect(passedName).toContain(CACHE_UUID);
  });

  it('falls back to the read file name when the picker offers whitespace only', async () => {
    const cacheCopy = await writeCacheCopy(`${CACHE_UUID}.md`, 'نص باسم مسافات فقط.');
    pickOnce({ name: '   ', uri: cacheCopy.uri });

    await pickAndImportBook(createInMemoryDb());

    const passedName = mockImportBookContent.mock.calls[0]?.[1];
    expect(passedName).toBeTruthy();
    expect(passedName).toContain(CACHE_UUID);
  });

  it('routes archive imports by the picked .epub/.zip name even when the cache copy has another extension', async () => {
    const cacheCopy = await writeCacheCopy(`${CACHE_UUID}.bin`, 'PK');
    pickOnce({ name: 'رواية-مصورة.epub', uri: cacheCopy.uri, size: 2 });
    const fakeRecord = {
      id: 'book-epub-1',
      title: 'رواية مصورة',
      author: null,
      dir: 'rtl' as const,
      coverSeed: 'رواية مصورة',
      coverColor: null,
      progress: 0,
      lastOpenedAt: 1,
      addedAt: 1,
    };
    mockImportBookArchiveFile.mockResolvedValueOnce(fakeRecord);

    const record = await pickAndImportBook(createInMemoryDb());

    expect(record).toEqual(fakeRecord);
    expect(mockImportBookArchiveFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'رواية-مصورة.epub' }),
      'رواية-مصورة.epub',
      expect.anything(),
    );
    expect(mockImportBookContent).not.toHaveBeenCalled();
  });

  it('still lets frontmatter decide the title for a named .md/.txt file', async () => {
    const text = ['---', 'title: عنوان من الـ frontmatter', 'author: مؤلف', '---', '', 'محتوى الكتاب.'].join(
      '\n',
    );
    const cacheCopy = await writeCacheCopy(`${CACHE_UUID}.md`, text);
    pickOnce({ name: 'edge-cases.md', uri: cacheCopy.uri });

    const record = await pickAndImportBook(createInMemoryDb());

    expect(mockImportBookContent.mock.calls[0]?.[1]).toBe('edge-cases.md');
    expect(record?.title).toBe('عنوان من الـ frontmatter');
  });
});
