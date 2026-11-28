import type { Book } from '@rewiaty/book-format';

import type {
  BookQaCitation,
  BookQaExcerpt,
  BookQaRequest,
  BookQaResponse,
  ByokInput,
} from '@/api/types';
import { stripHtmlToText } from '@/utils/chapter-timeline';
import type { DatabaseAdapter } from './database';
import type { ByokSecureStoreAdapter } from './byok-store';

/**
 * F49 — strict-index, spoiler-free Q&A.
 *
 * The reader may ask about the novel, but the context sent to the model is built **only** from
 * what the reader has already reached. This module owns that boundary:
 *
 * - `buildStrictQaExcerpts` walks the book structurally up to `(upToChapterId, upToBlockId)` and
 *   never returns a chapter or block past that cutoff. An unresolvable cutoff returns `[]` rather
 *   than guessing — a missing answer is better than a spoiler.
 * - `askStrictBookQuestion` is the BYOK-aware wrapper: it resolves the key, calls the typed API
 *   client, and maps every failure to a calm Arabic message without ever exposing key material.
 */

/** Context window sent by default; the endpoint accepts at most 40 excerpts. */
export const DEFAULT_STRICT_QA_MAX_EXCERPTS = 24;
/** Contract ceiling for `BookQaRequest.context_excerpts.maxItems`. */
export const MAX_STRICT_QA_EXCERPTS = 40;

export const STRICT_QA_NO_BYOK_MESSAGE_AR =
  'أضف مفتاح الذكاء الاصطناعي من الإعدادات عشان تقدر تسأل عن الكتاب أو تشرح الكلمات.';
export const STRICT_QA_OFFLINE_MESSAGE_AR =
  'إنت مش متصل بالإنترنت دلوقتي. وصّل النت وجرّب تاني.';
export const STRICT_QA_EMPTY_CONTEXT_MESSAGE_AR =
  'لسه مفيش نص كفاية قبل مكانك الحالي. اقرا شوية كمان واسأل تاني.';
export const STRICT_QA_EMPTY_QUESTION_MESSAGE_AR = 'اكتب سؤالك الأول.';
export const STRICT_QA_BUDGET_MESSAGE_AR =
  'وصلت لحد الميزانية المسموح بيها للكتاب ده. تقدر تزوّدها من الإعدادات.';
export const STRICT_QA_RATE_LIMIT_MESSAGE_AR =
  'السيرفر مشغول أو استهلاكك اليومي خلص. جرّب تاني بعد شوية.';
export const STRICT_QA_AUTH_MESSAGE_AR =
  'انتهت الجلسة. ارجع للمكتبة وافتح الكتاب تاني.';
export const STRICT_QA_GENERIC_ERROR_MESSAGE_AR =
  'تعذّر الحصول على الإجابة دلوقتي. جرّب تاني بعد شوية.';

const CHAPTER_ID_RE = /^ch(\d+)$/;
const BLOCK_ID_RE = /^ch(\d+)_p(\d+)$/;

/** `"ch02"` → `2`; anything that is not a chapter id → `null`. */
export function parseChapterNumber(chapterId: string | null | undefined): number | null {
  if (typeof chapterId !== 'string') return null;
  const match = CHAPTER_ID_RE.exec(chapterId.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export type BlockPosition = {
  chapterNumber: number;
  blockNumber: number;
};

/** `"ch02_p0012"` → `{ chapterNumber: 2, blockNumber: 12 }`; invalid → `null`. */
export function parseBlockPosition(blockId: string | null | undefined): BlockPosition | null {
  if (typeof blockId !== 'string') return null;
  const match = BLOCK_ID_RE.exec(blockId.trim());
  if (!match) return null;
  const chapterNumber = Number(match[1]);
  const blockNumber = Number(match[2]);
  if (!Number.isFinite(chapterNumber) || !Number.isFinite(blockNumber)) return null;
  return { chapterNumber, blockNumber };
}

export type BuildStrictQaExcerptsInput = {
  book: Pick<Book, 'chapters'>;
  upToChapterId: string;
  upToBlockId: string;
  /** Exclusive prefix cutoff inside the cutoff block. */
  upToCharOffset?: number;
  /** Recent context window size; defaults to 24 and is clamped to 1..40. */
  maxExcerpts?: number;
};

function clampMaxExcerpts(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_STRICT_QA_MAX_EXCERPTS;
  }
  return Math.min(MAX_STRICT_QA_EXCERPTS, Math.max(1, Math.floor(value)));
}

function sliceAtCharOffset(text: string, offset: number | undefined): string {
  if (offset === undefined) return text;
  if (!Number.isFinite(offset) || offset <= 0) return '';
  return text.slice(0, Math.floor(offset));
}

/**
 * Build `context_excerpts` strictly up to the reader's current position.
 *
 * Reading order is the book's own chapter/block order. Every excerpt returned sits at or before
 * `(upToChapterId, upToBlockId)`; when the cutoff cannot be resolved the result is empty, so no
 * future text can ever reach the model prompt.
 */
export function buildStrictQaExcerpts(input: BuildStrictQaExcerptsInput): BookQaExcerpt[] {
  const { book, upToChapterId, upToBlockId, upToCharOffset } = input;
  if (!upToChapterId || !upToBlockId) return [];

  const chapterNumber = parseChapterNumber(upToChapterId);
  const blockPosition = parseBlockPosition(upToBlockId);
  if (chapterNumber === null || blockPosition === null) return [];
  // The contract requires `up_to_block_id` to live in `up_to_chapter_id`.
  if (blockPosition.chapterNumber !== chapterNumber) return [];

  const chapters = book?.chapters ?? [];
  const cutoffChapterIndex = chapters.findIndex((chapter) => chapter.id === upToChapterId);
  if (cutoffChapterIndex < 0) return [];

  const collected: BookQaExcerpt[] = [];

  for (let chapterIndex = 0; chapterIndex <= cutoffChapterIndex; chapterIndex += 1) {
    const chapter = chapters[chapterIndex];
    if (!chapter) continue;
    const isCutoffChapter = chapterIndex === cutoffChapterIndex;

    if (!isCutoffChapter) {
      for (const block of chapter.blocks) {
        const text = stripHtmlToText(block.html);
        if (text) {
          collected.push({ block_id: block.id, chapter_title: chapter.title, text });
        }
      }
      continue;
    }

    const cutoffBlockIndex = chapter.blocks.findIndex((block) => block.id === upToBlockId);
    // Unresolvable cutoff: return nothing instead of guessing where the reader is.
    if (cutoffBlockIndex < 0) return [];

    for (let blockIndex = 0; blockIndex <= cutoffBlockIndex; blockIndex += 1) {
      const block = chapter.blocks[blockIndex];
      if (!block) continue;
      const isCutoffBlock = blockIndex === cutoffBlockIndex;
      const rawText = stripHtmlToText(block.html);
      const text = isCutoffBlock ? sliceAtCharOffset(rawText, upToCharOffset) : rawText;
      if (text) {
        collected.push({ block_id: block.id, chapter_title: chapter.title, text });
      }
    }
  }

  // Keep the most recent window: the reader cares about what they just read, not chapter one.
  return collected.slice(-clampMaxExcerpts(input.maxExcerpts));
}

/* --------------------------------------------------------- ask (BYOK) */

/** Minimal client seam, so tests never construct a real client and nothing hits the network. */
export interface StrictQaApiClient {
  askBookQuestion(bookId: string, body: BookQaRequest): Promise<BookQaResponse>;
}

/** Resolves the active BYOK key into the write-only envelope the endpoint expects. */
export type StrictQaByokResolver = () => Promise<ByokInput | null>;

export type AskStrictBookQuestionResult =
  | { status: 'ok'; response: BookQaResponse; excerpts: BookQaExcerpt[] }
  | { status: 'no_byok'; messageAr: string }
  | { status: 'offline'; messageAr: string }
  | { status: 'empty_context'; messageAr: string }
  | { status: 'error'; messageAr: string; code?: string; retryable: boolean };

export type AskStrictBookQuestionParams = {
  book: Pick<Book, 'chapters' | 'meta' | 'id'>;
  /** Defaults to `book.id`. */
  bookId?: string;
  question: string;
  upToChapterId: string;
  upToBlockId: string;
  upToCharOffset?: number;
  bookTitle?: string;
  budgetCapUsd?: number;
  maxExcerpts?: number;
  apiClient: StrictQaApiClient;
  resolveByok: StrictQaByokResolver;
  /**
   * The build can ship without a cloud origin, or the caller can detect the transport failure.
   * Either way the user gets one calm Arabic sentence instead of an English network error.
   */
  isOffline?: boolean | (() => boolean);
};

function resolveOffline(isOffline: AskStrictBookQuestionParams['isOffline']): boolean {
  if (typeof isOffline === 'function') {
    try {
      return isOffline() === true;
    } catch {
      return false;
    }
  }
  return isOffline === true;
}

function readErrorField(err: unknown, key: 'status' | 'code' | 'retryable'): unknown {
  if (!err || typeof err !== 'object') return undefined;
  return (err as Record<string, unknown>)[key];
}

function mapStrictQaError(err: unknown): AskStrictBookQuestionResult {
  const status = readErrorField(err, 'status');
  const code = readErrorField(err, 'code');
  const codeText = typeof code === 'string' ? code : undefined;

  // Deliberately never include `err.message`: an upstream echo must not reach the reader, and
  // every returned string is one of the fixed Arabic sentences above.
  if (status === 0 || codeText === 'NETWORK_ERROR' || codeText === 'UPLOAD_NETWORK_ERROR') {
    return { status: 'offline', messageAr: STRICT_QA_OFFLINE_MESSAGE_AR };
  }
  if (status === 402) {
    return { status: 'error', messageAr: STRICT_QA_BUDGET_MESSAGE_AR, code: codeText, retryable: false };
  }
  if (status === 429) {
    return { status: 'error', messageAr: STRICT_QA_RATE_LIMIT_MESSAGE_AR, code: codeText, retryable: true };
  }
  if (status === 401 || status === 403) {
    return { status: 'error', messageAr: STRICT_QA_AUTH_MESSAGE_AR, code: codeText, retryable: false };
  }
  return {
    status: 'error',
    messageAr: STRICT_QA_GENERIC_ERROR_MESSAGE_AR,
    ...(codeText ? { code: codeText } : {}),
    retryable: readErrorField(err, 'retryable') === true,
  };
}

/**
 * Ask the book a spoiler-free question, bounded by the reader's current position.
 *
 * The cutoff is resolved before any network work: no readable context → an explanatory message
 * and no paid call; no BYOK key → the "add your key" prompt; offline → the offline sentence.
 */
export async function askStrictBookQuestion(
  params: AskStrictBookQuestionParams,
): Promise<AskStrictBookQuestionResult> {
  const question = typeof params.question === 'string' ? params.question.trim() : '';
  if (!question) {
    return { status: 'error', messageAr: STRICT_QA_EMPTY_QUESTION_MESSAGE_AR, retryable: false };
  }

  if (resolveOffline(params.isOffline)) {
    return { status: 'offline', messageAr: STRICT_QA_OFFLINE_MESSAGE_AR };
  }

  let byok: ByokInput | null;
  try {
    byok = await params.resolveByok();
  } catch {
    return { status: 'error', messageAr: STRICT_QA_GENERIC_ERROR_MESSAGE_AR, retryable: true };
  }
  if (!byok) {
    return { status: 'no_byok', messageAr: STRICT_QA_NO_BYOK_MESSAGE_AR };
  }

  const excerpts = buildStrictQaExcerpts({
    book: params.book,
    upToChapterId: params.upToChapterId,
    upToBlockId: params.upToBlockId,
    ...(params.upToCharOffset === undefined ? {} : { upToCharOffset: params.upToCharOffset }),
    ...(params.maxExcerpts === undefined ? {} : { maxExcerpts: params.maxExcerpts }),
  });
  if (excerpts.length === 0) {
    return { status: 'empty_context', messageAr: STRICT_QA_EMPTY_CONTEXT_MESSAGE_AR };
  }

  const body: BookQaRequest = {
    question,
    up_to_chapter_id: params.upToChapterId,
    up_to_block_id: params.upToBlockId,
    ...(typeof params.upToCharOffset === 'number' &&
    Number.isFinite(params.upToCharOffset) &&
    params.upToCharOffset >= 0
      ? { up_to_char_offset: Math.floor(params.upToCharOffset) }
      : {}),
    ...(params.bookTitle ? { book_title: params.bookTitle } : {}),
    context_excerpts: excerpts,
    byok,
    ...(typeof params.budgetCapUsd === 'number' &&
    Number.isFinite(params.budgetCapUsd) &&
    params.budgetCapUsd >= 0
      ? { budget_cap_usd: params.budgetCapUsd }
      : {}),
  };

  try {
    const response = await params.apiClient.askBookQuestion(params.bookId ?? params.book.id, body);
    return { status: 'ok', response, excerpts };
  } catch (err) {
    return mapStrictQaError(err);
  }
}

/* ------------------------------------------------- stored BYOK resolver */

type ByokStoreModule = typeof import('./byok-store');

let cachedByokStore: ByokStoreModule | null = null;

/**
 * Load `byok-store` lazily.
 *
 * Why: it imports `expo-secure-store`, and this module is also imported by pure unit tests and
 * by screens whose tests never touch native modules. A lazy `require` keeps the excerpt builder
 * and the ask helper usable without a native runtime (same pattern as `api/device-session`).
 */
function loadByokStore(): ByokStoreModule {
  if (!cachedByokStore) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedByokStore = require('./byok-store') as ByokStoreModule;
  }
  return cachedByokStore;
}

/**
 * The default BYOK resolver used by the reader.
 *
 * Returns `null` when no key is stored (so the UI can show the "add your key" prompt) and an
 * ephemeral envelope otherwise. The raw key is read from secure storage at call time only; it is
 * never logged or returned as part of any user-visible string.
 */
export function createStoredByokResolver(
  db?: DatabaseAdapter,
  adapter?: ByokSecureStoreAdapter,
): StrictQaByokResolver {
  return async () => {
    const store = loadByokStore();
    const config = await store.loadByokConfig(db, adapter);
    if (!config.hasKey) return null;
    const apiKey = await store.readByokSecret(config.provider, adapter);
    if (!apiKey) return null;
    if (config.provider === 'custom') {
      const baseUrl = store.sanitizeCustomBaseUrl(config.customBaseUrl);
      if (!baseUrl) return null;
      let model: string;
      try {
        model = store.normalizeCustomModelId(config.modelId);
      } catch {
        return null;
      }
      return {
        mode: 'ephemeral',
        provider: 'openai_compatible',
        api_key: apiKey,
        base_url: baseUrl,
        model,
      };
    }
    return {
      mode: 'ephemeral',
      provider: config.provider,
      api_key: apiKey,
      model: config.modelId,
    };
  };
}

/** Whether a usable key is stored — for showing the calm settings hint before a tap. */
export async function hasStoredByokKey(
  db?: DatabaseAdapter,
  adapter?: ByokSecureStoreAdapter,
): Promise<boolean> {
  try {
    const store = loadByokStore();
    const config = await store.loadByokConfig(db, adapter);
    return config.hasKey === true;
  } catch {
    return false;
  }
}

/** Re-exported for callers that only need the citation shape in their view models. */
export type { BookQaCitation };
