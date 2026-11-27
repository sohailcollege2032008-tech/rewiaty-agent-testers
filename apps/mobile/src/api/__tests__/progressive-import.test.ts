import { ApiError, type RewiatyApiClient } from '@/api/client';
import { ProgressiveBookImporter, assembleBookMarkdown } from '@/api/progressive-import';
import type {
  BundleManifestResponse,
  ChapterBundleResponse,
} from '@/api/types';
import type { BookLibraryRecord } from '@/types/reader';

function bookRecord(id: string, title = 'أمواج'): BookLibraryRecord {
  return {
    id,
    title,
    author: null,
    dir: 'rtl',
    coverSeed: title,
    coverColor: null,
    progress: 0,
    lastOpenedAt: 0,
    addedAt: 0,
  };
}

function manifest(overrides: Partial<BundleManifestResponse> = {}): BundleManifestResponse {
  return {
    id: 'bk_1',
    meta: {
      title: 'أمواج',
      author: 'مصطفى شعبان',
      lang: 'ar',
      dir: 'rtl',
      coverColor: '#1b3a5c',
    },
    chapters: [
      { id: 'ch01', title: 'الفصل الأول', wordCount: 10, hash: 'hash-1' },
      { id: 'ch02', title: 'الفصل الثاني', wordCount: 12, hash: 'hash-2' },
    ],
    wordCount: 22,
    parserVersion: 1,
    is_complete: false,
    ready_chapter_ids: ['ch01', 'ch02'],
    book_md_url: '/v1/books/bk_1/bundle/book.md',
    assets: [],
    ...overrides,
  };
}

function chapterResponse(overrides: Partial<ChapterBundleResponse> = {}): ChapterBundleResponse {
  return {
    chapter_id: 'ch01',
    chapter_index: 1,
    title: 'الفصل الأول',
    hash: 'hash-1',
    word_count: 10,
    markdown: '# الفصل الأول\n\n- لم أكن أعرف أن البحر يغضب بهذا الشكل.',
    assets: [],
    ...overrides,
  };
}

function createClientMock(overrides: {
  manifest?: BundleManifestResponse;
  chapters?: Record<string, ChapterBundleResponse | Error>;
} = {}) {
  const manifestResponse = overrides.manifest ?? manifest();
  const chapters = overrides.chapters ?? {
    ch01: chapterResponse(),
    ch02: chapterResponse({
      chapter_id: 'ch02',
      chapter_index: 2,
      title: 'الفصل الثاني',
      hash: 'hash-2',
      markdown: '# الفصل الثاني\n\nقالت وهي تنظر إلى الأفق:\n- كلنا نغرق يا سعيد.',
    }),
  };

  const getBundleManifest = jest.fn(async () => manifestResponse);
  const getBundleChapter = jest.fn(async (_bookId: string, chapterId: string) => {
    const value = chapters[chapterId];
    if (!value) throw new Error(`no chapter fixture for ${chapterId}`);
    if (value instanceof Error) throw value;
    return value;
  });

  const client = {
    getBundleManifest,
    getBundleChapter,
  } as unknown as RewiatyApiClient;

  return { client, getBundleManifest, getBundleChapter };
}

describe('assembleBookMarkdown', () => {
  it('writes frontmatter then chapters in chapter_index order', () => {
    const markdown = assembleBookMarkdown(manifest().meta, [
      {
        chapterId: 'ch02',
        chapterIndex: 2,
        title: 'الفصل الثاني',
        hash: 'hash-2',
        markdown: 'نص التاني',
        assets: [],
      },
      {
        chapterId: 'ch01',
        chapterIndex: 1,
        title: 'الفصل الأول',
        hash: 'hash-1',
        markdown: 'نص الأول',
        assets: [],
      },
    ]);

    expect(markdown.startsWith('---\n')).toBe(true);
    expect(markdown).toContain('title: "أمواج"');
    expect(markdown).toContain('author: "مصطفى شعبان"');
    expect(markdown).toContain('dir: "rtl"');
    expect(markdown).toContain('coverColor: "#1b3a5c"');
    expect(markdown.indexOf('# الفصل الأول')).toBeLessThan(markdown.indexOf('# الفصل الثاني'));
  });

  it('does not duplicate a heading the chapter payload already carries', () => {
    const markdown = assembleBookMarkdown(manifest().meta, [
      {
        chapterId: 'ch01',
        chapterIndex: 1,
        title: 'الفصل الأول',
        hash: 'hash-1',
        markdown: '# الفصل الأول\n\nنص',
        assets: [],
      },
    ]);

    expect(markdown.match(/# الفصل الأول/g)).toHaveLength(1);
  });
});

describe('ProgressiveBookImporter', () => {
  it('downloads ready chapters and persists one assembled bundle', async () => {
    const { client, getBundleManifest, getBundleChapter } = createClientMock();
    const importBookContent = jest.fn(async () => bookRecord('bk_1'));
    const importer = new ProgressiveBookImporter(client, 'bk_1', undefined, {
      importBookContent,
    });

    const result = await importer.importReadyChapters();

    expect(getBundleManifest).toHaveBeenCalledWith('bk_1');
    expect(getBundleChapter).toHaveBeenCalledTimes(2);
    expect(getBundleChapter).toHaveBeenNthCalledWith(1, 'bk_1', 'ch01');
    expect(getBundleChapter).toHaveBeenNthCalledWith(2, 'bk_1', 'ch02');
    expect(result).toEqual({
      importedCount: 2,
      skippedCount: 0,
      totalChapters: 2,
      isComplete: false,
      bookRecord: bookRecord('bk_1'),
    });

    expect(importBookContent).toHaveBeenCalledTimes(1);
    const call = importBookContent.mock.calls[0] as unknown as [
      string,
      string,
      unknown,
      { bookId: string },
    ];
    expect(call[3]).toEqual({ bookId: 'bk_1' });
    expect(call[1]).toBe('أمواج.md');
    expect(call[0]).toContain('title: "أمواج"');
    expect(call[0]).toContain('# الفصل الأول');
    expect(call[0]).toContain('# الفصل الثاني');
  });

  it('skips chapters whose hash was already imported and does not rewrite the bundle', async () => {
    const { client, getBundleChapter } = createClientMock();
    const importBookContent = jest.fn(async () => bookRecord('bk_1'));
    const importer = new ProgressiveBookImporter(client, 'bk_1', undefined, {
      importBookContent,
    });

    await importer.importReadyChapters();
    const second = await importer.importReadyChapters();

    expect(getBundleChapter).toHaveBeenCalledTimes(2);
    expect(importBookContent).toHaveBeenCalledTimes(1);
    expect(second).toEqual({
      importedCount: 0,
      skippedCount: 2,
      totalChapters: 2,
      isComplete: false,
      bookRecord: null,
    });
  });

  it('re-downloads only the chapter whose hash changed and keeps the others', async () => {
    let manifestResponse = manifest();
    const chapters: Record<string, ChapterBundleResponse> = {
      ch01: chapterResponse(),
      ch02: chapterResponse({
        chapter_id: 'ch02',
        chapter_index: 2,
        title: 'الفصل الثاني',
        hash: 'hash-2',
        markdown: '# الفصل الثاني\n\nنص قديم.',
      }),
    };
    const client = {
      getBundleManifest: jest.fn(async () => manifestResponse),
      getBundleChapter: jest.fn(async (_bookId: string, chapterId: string) => chapters[chapterId]),
    } as unknown as RewiatyApiClient;
    const importBookContent = jest.fn(async () => bookRecord('bk_1'));
    const importer = new ProgressiveBookImporter(client, 'bk_1', undefined, { importBookContent });

    await importer.importReadyChapters();

    // Chapter 2 was rebuilt: new hash, new text; chapter 1 is untouched.
    manifestResponse = manifest({
      chapters: [
        { id: 'ch01', title: 'الفصل الأول', wordCount: 10, hash: 'hash-1' },
        { id: 'ch02', title: 'الفصل الثاني', wordCount: 14, hash: 'hash-2b' },
      ],
    });
    chapters.ch02 = chapterResponse({
      chapter_id: 'ch02',
      chapter_index: 2,
      title: 'الفصل الثاني',
      hash: 'hash-2b',
      markdown: '# الفصل الثاني\n\nنص معدّل.',
    });

    const result = await importer.importReadyChapters();

    expect(result.importedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(client.getBundleChapter).toHaveBeenCalledTimes(3);
    const lastMarkdown = (importBookContent.mock.calls[1] as unknown as [string])[0];
    expect(lastMarkdown).toContain('نص معدّل.');
    expect(lastMarkdown).toContain('# الفصل الأول');
    expect(lastMarkdown).not.toContain('نص قديم.');
  });

  it('restricts the run to the ids the caller passes', async () => {
    const { client, getBundleChapter } = createClientMock();
    const importBookContent = jest.fn(async () => bookRecord('bk_1'));
    const importer = new ProgressiveBookImporter(client, 'bk_1', undefined, {
      importBookContent,
    });

    const result = await importer.importReadyChapters(['ch01']);

    expect(getBundleChapter).toHaveBeenCalledTimes(1);
    expect(getBundleChapter).toHaveBeenCalledWith('bk_1', 'ch01');
    expect(result.importedCount).toBe(1);
    expect(result.totalChapters).toBe(2);
  });

  it('skips a chapter advertised as ready but answering 404', async () => {
    const chapters: Record<string, ChapterBundleResponse | Error> = {
      ch01: new ApiError('not ready', { status: 404, code: 'NOT_FOUND', retryable: false }),
      ch02: chapterResponse({
        chapter_id: 'ch02',
        chapter_index: 2,
        title: 'الفصل الثاني',
        hash: 'hash-2',
        markdown: '# الفصل الثاني\n\n- كلنا نغرق يا سعيد.',
      }),
    };
    const { client, getBundleChapter } = createClientMock({ chapters });
    const importBookContent = jest.fn(async () => bookRecord('bk_1'));
    const importer = new ProgressiveBookImporter(client, 'bk_1', undefined, {
      importBookContent,
    });

    const result = await importer.importReadyChapters();

    expect(getBundleChapter).toHaveBeenCalledTimes(2);
    expect(result.importedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    // ch02 arrived but ch01 is still missing: book.md must not be written out of order.
    expect(importBookContent).not.toHaveBeenCalled();
    expect(result.bookRecord).toBeNull();

    // Once ch01 is downloadable, the whole prefix is written in document order.
    chapters.ch01 = chapterResponse();
    const retried = await importer.importReadyChapters();

    expect(importBookContent).toHaveBeenCalledTimes(1);
    const markdown = (importBookContent.mock.calls[0] as unknown as [string])[0];
    expect(markdown.indexOf('# الفصل الأول')).toBeGreaterThan(-1);
    expect(markdown.indexOf('# الفصل الأول')).toBeLessThan(markdown.indexOf('# الفصل الثاني'));
    expect(retried.bookRecord).toEqual(bookRecord('bk_1'));
  });

  it('rethrows a non-404 chapter failure', async () => {
    const { client } = createClientMock({
      chapters: {
        ch01: new ApiError('boom', { status: 500, code: 'INTERNAL_ERROR', retryable: true }),
        ch02: chapterResponse({ chapter_id: 'ch02', chapter_index: 2, hash: 'hash-2' }),
      },
    });
    const importer = new ProgressiveBookImporter(client, 'bk_1', undefined, {
      importBookContent: async () => bookRecord('bk_1'),
    });

    await expect(importer.importReadyChapters()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('downloads each referenced asset once across chapters', async () => {
    const sharedAsset = {
      name: 'fig-001.webp',
      url: '/v1/books/bk_1/bundle/assets/fig-001.webp',
      width: 1280,
      height: 842,
    };
    const { client } = createClientMock({
      chapters: {
        ch01: chapterResponse({ assets: [sharedAsset] }),
        ch02: chapterResponse({
          chapter_id: 'ch02',
          chapter_index: 2,
          hash: 'hash-2',
          assets: [sharedAsset],
        }),
      },
    });
    const downloadAsset = jest.fn(async () => undefined);
    const importer = new ProgressiveBookImporter(client, 'bk_1', undefined, {
      importBookContent: async () => bookRecord('bk_1'),
      downloadAsset,
    });

    await importer.importReadyChapters();

    expect(downloadAsset).toHaveBeenCalledTimes(1);
    expect(downloadAsset).toHaveBeenCalledWith(sharedAsset, 'bk_1');
  });

  it('never writes ch02 as ch01 when chapters arrive out of order', async () => {
    // First poll: only chapter 2 is ready.
    let manifestResponse = manifest({ ready_chapter_ids: ['ch02'] });
    const { client, getBundleManifest } = createClientMock();
    getBundleManifest.mockImplementation(async () => manifestResponse);
    const importBookContent = jest.fn(async () => bookRecord('bk_1'));
    const importer = new ProgressiveBookImporter(client, 'bk_1', undefined, {
      importBookContent,
    });

    const first = await importer.importReadyChapters();
    expect(first.importedCount).toBe(1);
    // ch02 is cached, but the document prefix is broken: no book.md yet.
    expect(importBookContent).not.toHaveBeenCalled();

    // Second poll: chapter 1 is ready too.
    manifestResponse = manifest();
    const second = await importer.importReadyChapters();

    expect(importBookContent).toHaveBeenCalledTimes(1);
    const markdown = (importBookContent.mock.calls[0] as unknown as [string])[0];
    // Exactly one section per chapter, in document order: ch01's text is never ch02's.
    expect(markdown.match(/^# /gm)).toHaveLength(2);
    expect(markdown.indexOf('# الفصل الأول')).toBeGreaterThan(-1);
    expect(markdown.indexOf('# الفصل الأول')).toBeLessThan(markdown.indexOf('# الفصل الثاني'));
    expect(markdown).toContain('لم أكن أعرف أن البحر يغضب');
    expect(second.bookRecord).toEqual(bookRecord('bk_1'));
  });

  it('keeps newly fetched chapters staged until importBookContent succeeds, then retries the write', async () => {
    const { client, getBundleChapter } = createClientMock();
    const importBookContent = jest
      .fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue(bookRecord('bk_1'));
    const importer = new ProgressiveBookImporter(client, 'bk_1', undefined, {
      importBookContent,
    });

    await expect(importer.importReadyChapters()).rejects.toThrow('disk full');

    // The retry rewrites book.md without re-downloading the chapters (they were staged, not lost).
    const retried = await importer.importReadyChapters();

    expect(getBundleChapter).toHaveBeenCalledTimes(2);
    expect(importBookContent).toHaveBeenCalledTimes(2);
    const retryMarkdown = (importBookContent.mock.calls[1] as unknown as [string])[0];
    expect(retryMarkdown).toContain('# الفصل الأول');
    expect(retryMarkdown).toContain('# الفصل الثاني');
    expect(retried.bookRecord).toEqual(bookRecord('bk_1'));
  });

  it('re-fetches a fresh chapter payload for a failed asset even when the hash is unchanged', async () => {
    const staleAsset = {
      name: 'fig-009.webp',
      url: '/v1/books/bk_1/bundle/assets/fig-009.webp?X-Amz-Signature=stale',
      width: 1280,
      height: 842,
    };
    const freshAsset = {
      ...staleAsset,
      url: '/v1/books/bk_1/bundle/assets/fig-009.webp?X-Amz-Signature=fresh',
    };
    const chapters: Record<string, ChapterBundleResponse> = {
      ch01: chapterResponse({ assets: [staleAsset] }),
    };
    const client = {
      getBundleManifest: jest.fn(async () =>
        manifest({
          chapters: [{ id: 'ch01', title: 'الفصل الأول', wordCount: 10, hash: 'hash-1' }],
          ready_chapter_ids: ['ch01'],
        }),
      ),
      getBundleChapter: jest.fn(async (_bookId: string, chapterId: string) => chapters[chapterId]),
    } as unknown as RewiatyApiClient;
    const downloadAsset = jest
      .fn()
      .mockRejectedValueOnce(new Error('presigned url expired'))
      .mockResolvedValue(undefined);
    const importBookContent = jest.fn(async () => bookRecord('bk_1'));
    const importer = new ProgressiveBookImporter(client, 'bk_1', undefined, {
      importBookContent,
      downloadAsset,
    });

    await importer.importReadyChapters();
    expect(downloadAsset).toHaveBeenCalledTimes(1);
    expect(downloadAsset.mock.calls[0]![0]).toEqual(staleAsset);

    // The backend re-signs the asset URL; the chapter text (hash) is identical.
    chapters.ch01 = chapterResponse({ assets: [freshAsset] });

    await importer.importReadyChapters();

    // A second payload fetch is what supplies the new presigned URL — not a replay of the old one.
    expect(client.getBundleChapter).toHaveBeenCalledTimes(2);
    expect(downloadAsset).toHaveBeenCalledTimes(2);
    expect(downloadAsset.mock.calls[1]![0]).toEqual(freshAsset);
    expect(downloadAsset.mock.calls[1]![0]).not.toEqual(staleAsset);
    // The text was unchanged, so book.md is not rewritten.
    expect(importBookContent).toHaveBeenCalledTimes(1);
  });

  it('stops re-fetching assets once the retry succeeds', async () => {
    const asset = {
      name: 'fig-010.webp',
      url: '/v1/books/bk_1/bundle/assets/fig-010.webp',
      width: 640,
      height: 480,
    };
    const client = {
      getBundleManifest: jest.fn(async () =>
        manifest({
          chapters: [{ id: 'ch01', title: 'الفصل الأول', wordCount: 10, hash: 'hash-1' }],
          ready_chapter_ids: ['ch01'],
        }),
      ),
      getBundleChapter: jest.fn(async () => chapterResponse({ assets: [asset] })),
    } as unknown as RewiatyApiClient;
    const downloadAsset = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const importer = new ProgressiveBookImporter(client, 'bk_1', undefined, {
      importBookContent: async () => bookRecord('bk_1'),
      downloadAsset,
    });

    await importer.importReadyChapters();
    await importer.importReadyChapters();
    expect(client.getBundleChapter).toHaveBeenCalledTimes(2);

    // Asset is now on disk: a third run skips the payload entirely.
    await importer.importReadyChapters();
    expect(client.getBundleChapter).toHaveBeenCalledTimes(2);
    expect(downloadAsset).toHaveBeenCalledTimes(2);
  });

  it('supports an options-object constructor and reports completion', async () => {
    const { client } = createClientMock({
      manifest: manifest({ is_complete: true }),
    });
    const importBookContent = jest.fn(async () => bookRecord('bk_1'));
    const importer = new ProgressiveBookImporter({
      client,
      bookId: 'bk_1',
      deps: { importBookContent },
    });

    const result = await importer.importReadyChapters();

    expect(result.isComplete).toBe(true);
    expect(result.bookRecord?.id).toBe('bk_1');
    expect(importBookContent).toHaveBeenCalledTimes(1);
  });

  it('imports nothing when the manifest has no ready chapters', async () => {
    const { client } = createClientMock({
      manifest: manifest({ ready_chapter_ids: [] }),
    });
    const importBookContent = jest.fn();
    const importer = new ProgressiveBookImporter(client, 'bk_1', undefined, {
      importBookContent,
    });

    const result = await importer.importReadyChapters();

    expect(result).toEqual({
      importedCount: 0,
      skippedCount: 0,
      totalChapters: 2,
      isComplete: false,
      bookRecord: null,
    });
    expect(importBookContent).not.toHaveBeenCalled();
  });
});
