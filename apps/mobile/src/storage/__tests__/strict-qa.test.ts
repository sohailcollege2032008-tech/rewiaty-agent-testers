import type { Book } from '@rewiaty/book-format';

import type { BookQaRequest, BookQaResponse } from '@/api/types';
import {
  askStrictBookQuestion,
  buildStrictQaExcerpts,
  createStoredByokResolver,
  DEFAULT_STRICT_QA_MAX_EXCERPTS,
  explainCutoffForSelection,
  hasStoredByokKey,
  MAX_STRICT_QA_CHAPTER_TITLE_CHARS,
  MAX_STRICT_QA_EXCERPT_TEXT_CHARS,
  MAX_STRICT_QA_EXCERPTS,
  parseBlockPosition,
  parseChapterNumber,
  STRICT_QA_AUTH_MESSAGE_AR,
  STRICT_QA_BUDGET_MESSAGE_AR,
  STRICT_QA_EMPTY_CONTEXT_MESSAGE_AR,
  STRICT_QA_GENERIC_ERROR_MESSAGE_AR,
  STRICT_QA_NO_BYOK_MESSAGE_AR,
  STRICT_QA_OFFLINE_MESSAGE_AR,
  STRICT_QA_RATE_LIMIT_MESSAGE_AR,
  type StrictQaApiClient,
} from '@/storage/strict-qa';
import * as byokStore from '@/storage/byok-store';

/**
 * F49 strict-index Q&A — the boundary is the product.
 *
 * Every fixture here is text-shaped and key-shaped strings are dummies (`test-byok-key-fixture`);
 * no test opens a socket and none contains an `sk-` style secret (gitleaks runs on this tree).
 */

jest.mock('@/storage/byok-store', () => {
  const actual = jest.requireActual('@/storage/byok-store');
  return {
    ...actual,
    loadByokConfig: jest.fn(),
    readByokSecret: jest.fn(),
  };
});

const TEST_KEY = 'test-byok-key-fixture';

function blockId(chapterId: string, index: number): string {
  return `${chapterId}_p${String(index + 1).padStart(4, '0')}`;
}

function makeBook(chapters: Array<{ id: string; title: string; texts: string[] }>): Book {
  return {
    id: 'book_fixture_1',
    meta: { title: 'رواية الاختبار', lang: 'ar', dir: 'rtl' },
    footnotes: {},
    wordCount: 0,
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      wordCount: 0,
      hash: `${chapter.id}-hash`,
      blocks: chapter.texts.map((text, index) => ({
        id: blockId(chapter.id, index),
        kind: 'p' as const,
        html: `<p>${text}</p>`,
      })),
    })),
  };
}

const EPHEMERAL_BYOK = {
  mode: 'ephemeral' as const,
  provider: 'openai',
  api_key: TEST_KEY,
  model: 'gpt-4.1',
};

function okResponse(overrides: Partial<BookQaResponse> = {}): BookQaResponse {
  return {
    book_id: 'book_fixture_1',
    answer: 'الجواب من اللي قريته.',
    cutoff_block_id: 'ch02_p0002',
    citations: [{ block_id: 'ch02_p0001', quote: 'اقتباس من النص.' }],
    cost_usd: 0.0012,
    spoiler_free: true,
    ...overrides,
  };
}

function createClient(response: BookQaResponse = okResponse()) {
  const askBookQuestion = jest.fn(async (_bookId: string, _body: BookQaRequest) => response);
  const client: StrictQaApiClient = { askBookQuestion };
  return { client, askBookQuestion };
}

const THREE_CHAPTER_BOOK = makeBook([
  { id: 'ch01', title: 'الفصل الأول', texts: ['واحد', 'اثنان'] },
  { id: 'ch02', title: 'الفصل الثاني', texts: ['ثلاثة', 'أربعة', 'خمسة'] },
  { id: 'ch03', title: 'الفصل الثالث', texts: ['ستة', 'سبعة'] },
]);

describe('parseChapterNumber / parseBlockPosition', () => {
  it('parses chapter and block ids in reading order', () => {
    expect(parseChapterNumber('ch01')).toBe(1);
    expect(parseChapterNumber('ch12')).toBe(12);
    expect(parseBlockPosition('ch01_p0007')).toEqual({ chapterNumber: 1, blockNumber: 7 });

    expect(parseChapterNumber('ch')).toBeNull();
    expect(parseChapterNumber('chapter1')).toBeNull();
    expect(parseChapterNumber('')).toBeNull();
    expect(parseBlockPosition('ch01')).toBeNull();
    expect(parseBlockPosition('ch01_p')).toBeNull();
    expect(parseBlockPosition('fn_1_p0001')).toBeNull();
  });
});

describe('buildStrictQaExcerpts', () => {
  it('returns exactly the chapters and blocks up to the cutoff', () => {
    const excerpts = buildStrictQaExcerpts({
      book: THREE_CHAPTER_BOOK,
      upToChapterId: 'ch02',
      upToBlockId: 'ch02_p0002',
    });

    expect(excerpts.map((excerpt) => excerpt.block_id)).toEqual([
      'ch01_p0001',
      'ch01_p0002',
      'ch02_p0001',
      'ch02_p0002',
    ]);
    expect(excerpts.map((excerpt) => excerpt.text)).toEqual(['واحد', 'اثنان', 'ثلاثة', 'أربعة']);
    // The chapter title travels with every excerpt so the model can attribute it.
    expect(excerpts[0]?.chapter_title).toBe('الفصل الأول');
    expect(excerpts.at(-1)?.chapter_title).toBe('الفصل الثاني');
  });

  it('never returns a block past the cutoff, even when the reader is mid-chapter', () => {
    const excerpts = buildStrictQaExcerpts({
      book: THREE_CHAPTER_BOOK,
      upToChapterId: 'ch02',
      upToBlockId: 'ch02_p0001',
    });

    const ids = excerpts.map((excerpt) => excerpt.block_id);
    expect(ids).not.toContain('ch02_p0002');
    expect(ids).not.toContain('ch02_p0003');
    expect(ids.some((id) => id.startsWith('ch03'))).toBe(false);
  });

  it('slices the cutoff block at up_to_char_offset', () => {
    const book = makeBook([{ id: 'ch01', title: 'الفصل الأول', texts: ['abcdefghij'] }]);

    const excerpts = buildStrictQaExcerpts({
      book,
      upToChapterId: 'ch01',
      upToBlockId: 'ch01_p0001',
      upToCharOffset: 4,
    });

    expect(excerpts).toEqual([
      { block_id: 'ch01_p0001', chapter_title: 'الفصل الأول', text: 'abcd' },
    ]);
  });

  it('drops the cutoff block when the character offset is zero, keeping earlier text', () => {
    const excerpts = buildStrictQaExcerpts({
      book: THREE_CHAPTER_BOOK,
      upToChapterId: 'ch02',
      upToBlockId: 'ch02_p0002',
      upToCharOffset: 0,
    });

    expect(excerpts.map((excerpt) => excerpt.block_id)).toEqual([
      'ch01_p0001',
      'ch01_p0002',
      'ch02_p0001',
    ]);
  });

  it('skips blocks with no text (breaks and images) but keeps the cutoff strict', () => {
    const book = makeBook([
      { id: 'ch01', title: 'الفصل الأول', texts: ['واحد', 'اثنان'] },
      { id: 'ch02', title: 'الفصل الثاني', texts: ['ثلاثة', 'أربعة', 'خمسة'] },
    ]);
    const chapter = book.chapters[1]!;
    chapter.blocks.splice(1, 0, { id: 'ch02_p0002', kind: 'image', html: '' });
    // Renumber the blocks after the inserted image so ids stay ordered.
    chapter.blocks.forEach((block, index) => {
      block.id = blockId('ch02', index);
    });

    const excerpts = buildStrictQaExcerpts({
      book,
      upToChapterId: 'ch02',
      upToBlockId: 'ch02_p0003',
    });

    expect(excerpts.map((excerpt) => excerpt.block_id)).toEqual([
      'ch01_p0001',
      'ch01_p0002',
      'ch02_p0001',
      'ch02_p0003',
    ]);
    expect(excerpts.every((excerpt) => excerpt.text.length > 0)).toBe(true);
  });

  it('prefers the most recent window and clamps to the contract ceiling', () => {
    const texts = Array.from({ length: 60 }, (_, index) => `جملة ${index + 1}`);
    const book = makeBook([{ id: 'ch01', title: 'الفصل الأول', texts }]);

    const recent = buildStrictQaExcerpts({
      book,
      upToChapterId: 'ch01',
      upToBlockId: 'ch01_p0060',
      maxExcerpts: 5,
    });
    expect(recent.map((excerpt) => excerpt.text)).toEqual([
      'جملة 56',
      'جملة 57',
      'جملة 58',
      'جملة 59',
      'جملة 60',
    ]);

    const capped = buildStrictQaExcerpts({
      book,
      upToChapterId: 'ch01',
      upToBlockId: 'ch01_p0060',
      maxExcerpts: 999,
    });
    expect(capped).toHaveLength(MAX_STRICT_QA_EXCERPTS);

    const defaulted = buildStrictQaExcerpts({
      book,
      upToChapterId: 'ch01',
      upToBlockId: 'ch01_p0060',
    });
    expect(defaulted).toHaveLength(DEFAULT_STRICT_QA_MAX_EXCERPTS);
  });

  it('returns nothing when the cutoff cannot be resolved (never guesses)', () => {
    expect(
      buildStrictQaExcerpts({
        book: THREE_CHAPTER_BOOK,
        upToChapterId: 'ch99',
        upToBlockId: 'ch99_p0001',
      }),
    ).toEqual([]);

    expect(
      buildStrictQaExcerpts({
        book: THREE_CHAPTER_BOOK,
        upToChapterId: 'ch02',
        upToBlockId: 'ch03_p0001',
      }),
    ).toEqual([]);

    expect(
      buildStrictQaExcerpts({
        book: THREE_CHAPTER_BOOK,
        upToChapterId: 'ch02',
        upToBlockId: 'ch02_p9999',
      }),
    ).toEqual([]);

    expect(
      buildStrictQaExcerpts({ book: THREE_CHAPTER_BOOK, upToChapterId: '', upToBlockId: '' }),
    ).toEqual([]);
  });

  it('clamps excerpt text to 8000 chars and the chapter title to 300', () => {
    const longText = 'ا'.repeat(9000);
    const longTitle = 'ع'.repeat(400);
    const book = makeBook([{ id: 'ch01', title: longTitle, texts: [longText] }]);

    const excerpts = buildStrictQaExcerpts({
      book,
      upToChapterId: 'ch01',
      upToBlockId: 'ch01_p0001',
    });

    expect(excerpts).toHaveLength(1);
    expect(excerpts[0]?.text).toHaveLength(MAX_STRICT_QA_EXCERPT_TEXT_CHARS);
    expect(MAX_STRICT_QA_EXCERPT_TEXT_CHARS).toBe(8000);
    expect(excerpts[0]?.chapter_title).toHaveLength(MAX_STRICT_QA_CHAPTER_TITLE_CHARS);
    expect(MAX_STRICT_QA_CHAPTER_TITLE_CHARS).toBe(300);
    // Truncation keeps the beginning of the text, never a tail from a later position.
    expect(excerpts[0]?.text.startsWith('ااا')).toBe(true);
    expect(excerpts[0]?.chapter_title?.startsWith('ععع')).toBe(true);  });
});

describe('explainCutoffForSelection', () => {
  it('cuts at the end of the selected word inside its own block (not the page anchor)', () => {
    const before = 'وقف في آخر السوق ينادي على ';
    const word = 'البطل';
    const after = '. ثم حدث في الصفحة الجاية ما لسه القارئ ما قراهوش.';
    const text = `${before}${word}${after}`;
    const book = makeBook([{ id: 'ch01', title: 'الفصل الأول', texts: [text] }]);
    const blockId = 'ch01_p0001';
    const charOffset = text.indexOf(word);

    const cutoff = explainCutoffForSelection({
      chapterId: 'ch01',
      anchor: { blockId, charOffset },
      length: word.length,
    });

    expect(cutoff).toEqual({
      chapterId: 'ch01',
      blockId,
      charOffset: charOffset + word.length,
    });

    // The whole sentence up to the last letter of the word reaches the model; nothing after it.
    const excerpts = buildStrictQaExcerpts({
      book,
      upToChapterId: cutoff!.chapterId,
      upToBlockId: cutoff!.blockId,
      upToCharOffset: cutoff!.charOffset,
    });

    expect(excerpts).toHaveLength(1);
    expect(excerpts[0]?.text).toBe(`${before}${word}`);
    expect(excerpts[0]?.text.endsWith(word)).toBe(true);
    expect(excerpts[0]?.text).not.toContain('ثم حدث');
  });

  it('returns null when there is no usable selection to cut at', () => {
    expect(explainCutoffForSelection(null)).toBeNull();
    expect(explainCutoffForSelection(undefined)).toBeNull();
    expect(
      explainCutoffForSelection({
        chapterId: '',
        anchor: { blockId: 'ch01_p0001', charOffset: 2 },
        length: 3,
      }),
    ).toBeNull();
    expect(
      explainCutoffForSelection({
        chapterId: 'ch01',
        anchor: { blockId: '', charOffset: 2 },
        length: 3,
      }),
    ).toBeNull();
  });
});

describe('askStrictBookQuestion', () => {
  it('sends only the bounded excerpts and the caller BYOK envelope', async () => {
    const { client, askBookQuestion } = createClient();

    const result = await askStrictBookQuestion({
      book: THREE_CHAPTER_BOOK,
      question: '  ملخص اللي قريته لحد هنا  ',
      upToChapterId: 'ch02',
      upToBlockId: 'ch02_p0002',
      upToCharOffset: 2,
      bookTitle: 'رواية الاختبار',
      apiClient: client,
      resolveByok: async () => EPHEMERAL_BYOK,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.response.answer).toBe('الجواب من اللي قريته.');
    expect(askBookQuestion).toHaveBeenCalledTimes(1);

    const [bookId, body] = askBookQuestion.mock.calls[0]!;
    expect(bookId).toBe('book_fixture_1');
    expect(body.question).toBe('ملخص اللي قريته لحد هنا');
    expect(body.book_title).toBe('رواية الاختبار');
    expect(body.byok).toEqual(EPHEMERAL_BYOK);
    expect(body.up_to_char_offset).toBe(2);

    const ids = body.context_excerpts?.map((excerpt) => excerpt.block_id) ?? [];
    expect(ids).toEqual(['ch01_p0001', 'ch01_p0002', 'ch02_p0001', 'ch02_p0002']);
    // The cutoff excerpt is truncated exactly like the request says.
    expect(body.context_excerpts?.at(-1)?.text).toBe('أر');
    expect(ids.some((id) => id.startsWith('ch03'))).toBe(false);
  });

  it('does not call the API when BYOK is not configured', async () => {
    const { client, askBookQuestion } = createClient();

    const result = await askStrictBookQuestion({
      book: THREE_CHAPTER_BOOK,
      question: 'سؤال',
      upToChapterId: 'ch02',
      upToBlockId: 'ch02_p0002',
      apiClient: client,
      resolveByok: async () => null,
    });

    expect(result).toEqual({ status: 'no_byok', messageAr: STRICT_QA_NO_BYOK_MESSAGE_AR });
    expect(askBookQuestion).not.toHaveBeenCalled();
  });

  it('answers offline before resolving a key or building context', async () => {
    const { client, askBookQuestion } = createClient();
    const resolveByok = jest.fn(async () => EPHEMERAL_BYOK);

    const result = await askStrictBookQuestion({
      book: THREE_CHAPTER_BOOK,
      question: 'سؤال',
      upToChapterId: 'ch02',
      upToBlockId: 'ch02_p0002',
      apiClient: client,
      resolveByok,
      isOffline: true,
    });

    expect(result).toEqual({ status: 'offline', messageAr: STRICT_QA_OFFLINE_MESSAGE_AR });
    expect(resolveByok).not.toHaveBeenCalled();
    expect(askBookQuestion).not.toHaveBeenCalled();
  });

  it('answers empty context (and spends nothing) when the cutoff has no text', async () => {
    const { client, askBookQuestion } = createClient();

    const result = await askStrictBookQuestion({
      book: THREE_CHAPTER_BOOK,
      question: 'سؤال',
      upToChapterId: 'ch02',
      upToBlockId: '',
      apiClient: client,
      resolveByok: async () => EPHEMERAL_BYOK,
    });

    expect(result).toEqual({
      status: 'empty_context',
      messageAr: STRICT_QA_EMPTY_CONTEXT_MESSAGE_AR,
    });
    expect(askBookQuestion).not.toHaveBeenCalled();
  });

  it('rejects an empty question without doing any work', async () => {
    const { client, askBookQuestion } = createClient();
    const resolveByok = jest.fn(async () => EPHEMERAL_BYOK);

    const result = await askStrictBookQuestion({
      book: THREE_CHAPTER_BOOK,
      question: '   ',
      upToChapterId: 'ch02',
      upToBlockId: 'ch02_p0002',
      apiClient: client,
      resolveByok,
    });

    expect(result.status).toBe('error');
    expect(resolveByok).not.toHaveBeenCalled();
    expect(askBookQuestion).not.toHaveBeenCalled();
  });

  it('maps a transport failure to the offline sentence without echoing the error', async () => {
    const client: StrictQaApiClient = {
      askBookQuestion: async () => {
        throw Object.assign(new Error(`socket closed for ${TEST_KEY}`), {
          status: 0,
          code: 'NETWORK_ERROR',
        });
      },
    };

    const result = await askStrictBookQuestion({
      book: THREE_CHAPTER_BOOK,
      question: 'سؤال',
      upToChapterId: 'ch02',
      upToBlockId: 'ch02_p0002',
      apiClient: client,
      resolveByok: async () => EPHEMERAL_BYOK,
    });

    expect(result).toEqual({ status: 'offline', messageAr: STRICT_QA_OFFLINE_MESSAGE_AR });
    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
  });

  it('maps budget and rate-limit answers to their own calm messages', async () => {
    const budgetClient: StrictQaApiClient = {
      askBookQuestion: async () => {
        throw Object.assign(new Error('over budget'), { status: 402, code: 'BUDGET_EXCEEDED' });
      },
    };
    const rateClient: StrictQaApiClient = {
      askBookQuestion: async () => {
        throw Object.assign(new Error('slow down'), { status: 429, code: 'RATE_LIMITED' });
      },
    };

    const base = {
      book: THREE_CHAPTER_BOOK,
      question: 'سؤال',
      upToChapterId: 'ch02',
      upToBlockId: 'ch02_p0002',
      resolveByok: async () => EPHEMERAL_BYOK,
    };

    const budget = await askStrictBookQuestion({ ...base, apiClient: budgetClient });
    expect(budget).toMatchObject({ status: 'error', messageAr: STRICT_QA_BUDGET_MESSAGE_AR });

    const rate = await askStrictBookQuestion({ ...base, apiClient: rateClient });
    expect(rate).toMatchObject({ status: 'error', messageAr: STRICT_QA_RATE_LIMIT_MESSAGE_AR });
  });

  it('maps 401 and 403 to the "link the device" sentence', async () => {
    const unauthorized: StrictQaApiClient = {
      askBookQuestion: async () => {
        throw Object.assign(new Error('unauthorized'), { status: 401, code: 'UNAUTHORIZED' });
      },
    };
    const forbidden: StrictQaApiClient = {
      askBookQuestion: async () => {
        throw Object.assign(new Error('forbidden'), { status: 403, code: 'FORBIDDEN' });
      },
    };

    const base = {
      book: THREE_CHAPTER_BOOK,
      question: 'سؤال',
      upToChapterId: 'ch02',
      upToBlockId: 'ch02_p0002',
      resolveByok: async () => EPHEMERAL_BYOK,
    };

    const auth = await askStrictBookQuestion({ ...base, apiClient: unauthorized });
    expect(auth).toMatchObject({ status: 'error', messageAr: STRICT_QA_AUTH_MESSAGE_AR });
    const denied = await askStrictBookQuestion({ ...base, apiClient: forbidden });
    expect(denied).toMatchObject({ status: 'error', messageAr: STRICT_QA_AUTH_MESSAGE_AR });

    expect(STRICT_QA_AUTH_MESSAGE_AR).toBe('اربط الجهاز بالخدمة الأول من إعدادات الـ AI');
  });

  it('never surfaces a provider error message (so an echoed key cannot leak)', async () => {
    const client: StrictQaApiClient = {
      askBookQuestion: async () => {
        throw Object.assign(new Error(`provider rejected key ${TEST_KEY}`), {
          status: 422,
          code: 'INVALID_REQUEST',
          retryable: false,
        });
      },
    };

    const result = await askStrictBookQuestion({
      book: THREE_CHAPTER_BOOK,
      question: 'سؤال',
      upToChapterId: 'ch02',
      upToBlockId: 'ch02_p0002',
      apiClient: client,
      resolveByok: async () => EPHEMERAL_BYOK,
    });

    expect(result).toMatchObject({
      status: 'error',
      messageAr: STRICT_QA_GENERIC_ERROR_MESSAGE_AR,
      retryable: false,
    });
    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
    expect(JSON.stringify(result)).not.toContain('provider rejected');
  });

  it('treats a throwing resolver as a calm retryable error', async () => {
    const { client, askBookQuestion } = createClient();

    const result = await askStrictBookQuestion({
      book: THREE_CHAPTER_BOOK,
      question: 'سؤال',
      upToChapterId: 'ch02',
      upToBlockId: 'ch02_p0002',
      apiClient: client,
      resolveByok: async () => {
        throw new Error('secure store locked');
      },
    });

    expect(result).toMatchObject({
      status: 'error',
      messageAr: STRICT_QA_GENERIC_ERROR_MESSAGE_AR,
      retryable: true,
    });
    expect(askBookQuestion).not.toHaveBeenCalled();
  });
});

describe('stored BYOK resolver', () => {
  const loadByokConfigMock = byokStore.loadByokConfig as unknown as jest.Mock;
  const readByokSecretMock = byokStore.readByokSecret as unknown as jest.Mock;

  beforeEach(() => {
    loadByokConfigMock.mockReset();
    readByokSecretMock.mockReset();
  });

  it('returns null when no key is stored', async () => {
    loadByokConfigMock.mockResolvedValue({ hasKey: false, provider: 'openai', modelId: 'gpt-4.1' });
    const resolver = createStoredByokResolver();
    await expect(resolver()).resolves.toBeNull();
    expect(readByokSecretMock).not.toHaveBeenCalled();
  });

  it('reads the active provider key from secure storage into an ephemeral envelope', async () => {
    loadByokConfigMock.mockResolvedValue({
      hasKey: true,
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-5',
    });
    readByokSecretMock.mockResolvedValue(TEST_KEY);

    const resolver = createStoredByokResolver();
    await expect(resolver()).resolves.toEqual({
      mode: 'ephemeral',
      provider: 'anthropic',
      api_key: TEST_KEY,
      model: 'claude-sonnet-4-5',
    });
  });

  it('maps stored custom provider to openai_compatible with HTTPS base_url and valid model', async () => {
    loadByokConfigMock.mockResolvedValue({
      hasKey: true,
      provider: 'custom',
      customBaseUrl: 'https://llm.example.test/v1',
      modelId: 'qwen-2.5-72b',
    });
    readByokSecretMock.mockResolvedValue(TEST_KEY);

    const resolver = createStoredByokResolver();
    await expect(resolver()).resolves.toEqual({
      mode: 'ephemeral',
      provider: 'openai_compatible',
      api_key: TEST_KEY,
      base_url: 'https://llm.example.test/v1',
      model: 'qwen-2.5-72b',
    });

    loadByokConfigMock.mockResolvedValue({
      hasKey: true,
      provider: 'custom',
      customBaseUrl: null,
      modelId: 'qwen-2.5-72b',
    });
    await expect(resolver()).resolves.toBeNull();
  });

  it('hasStoredByokKey reports the stored flag and swallows storage failures', async () => {
    loadByokConfigMock.mockResolvedValueOnce({ hasKey: true });
    await expect(hasStoredByokKey()).resolves.toBe(true);

    loadByokConfigMock.mockRejectedValueOnce(new Error('locked'));
    await expect(hasStoredByokKey()).resolves.toBe(false);
  });
});
