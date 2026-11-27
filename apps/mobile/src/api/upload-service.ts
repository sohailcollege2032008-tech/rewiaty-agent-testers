/**
 * Live `PdfUploadService` over the v0 `RewiatyApiClient`.
 *
 * Why (architecture): screens never talk to the network directly. The PDF-upload screen depends
 * on the injectable `PdfUploadService` seam, and this file is the one place that turns that seam
 * into real calls: presign → PUT → complete → estimate, then the F42 onboarding sample, the
 * art-direction persist, the job create and the SSE subscription.
 *
 * Two product rules are encoded here, not in the screen:
 *
 * 1. **Re-estimating an AI level never re-uploads the PDF.** Presign/complete are keyed by the
 *    picked file, so changing `ai_level` on the preflight card only calls `POST /v1/jobs/estimate`
 *    against the already-completed `upload_id`.
 * 2. **The reader never opens on an empty bundle.** `ensureChapterImported` runs the
 *    `ProgressiveBookImporter` for the first ready chapter *before* navigation, so the local
 *    canonical `book.md` already holds the chapter.
 *
 * BYOK material is resolved from F40 storage (`loadByokConfig` + `readByokSecret`) and attached to
 * the request body only; nothing here logs or persists a key.
 */

import * as DocumentPicker from 'expo-document-picker';
import { Directory, File } from 'expo-file-system';

import {
  loadByokConfig,
  normalizeCustomModelId,
  readByokSecret,
  sanitizeCustomBaseUrl,
  type ByokProvider,
} from '@/storage/byok-store';
import { getBookDir } from '@/storage/bundle';
import type { DatabaseAdapter } from '@/storage/database';
import type {
  AiLevel,
  BookArtDirection,
  BookArtDirectionInput,
  ByokInput,
  CostEstimateResponse,
  OnboardingSampleResponse,
  PdfUploadService,
  PickedPdf,
  StartConversionInput,
  StartConversionResult,
  UploadAndEstimateResult,
} from '@/types/upload-contract';

import type { RewiatyApiClient } from './client';
import { ProgressiveBookImporter, type ChapterAssetDownloader } from './progressive-import';
import { subscribeToJobEvents } from './sse';
import type {
  ChapterBundleAsset,
  JobCreateRequest,
  JobSseEvent,
  JobStatus,
  OnboardingSampleRequest,
} from './types';

/** The picked PDF, named as the brief calls it. Same shape as the contract's `PickedPdf`. */
export type PickedPdfFile = PickedPdf;

/**
 * `GenerateSampleRequest` plus the upload id the current preflight already holds.
 *
 * The contract's request body carries `upload_id` optionally; the screen only knows `book_id`,
 * so the service remembers the last upload for the book and fills it in.
 */
export type OnboardingSampleServiceInput = {
  book_id?: string;
  uploadId?: string;
  upload_id?: string;
  byok?: ByokInput;
};

export type StartConversionServiceInput = StartConversionInput & {
  /** Contract spelling (`budget_cap_usd`). */
  budget_cap_usd?: number;
  /** Camel-case convenience used by newer call sites. */
  budgetCapUsd?: number;
};

export type StartConversionServiceResult = StartConversionResult & {
  status?: JobStatus;
};

export type RewiatyApiUploadService = Omit<
  PdfUploadService,
  'uploadAndEstimate' | 'generateOnboardingSample' | 'startConversion' | 'subscribeProgress'
> & {
  /** Positional form (what the screen calls) and object form (used by newer code). */
  uploadAndEstimate(
    pdf: PickedPdf,
    options: { ai_level: AiLevel },
  ): Promise<UploadAndEstimateResult>;
  uploadAndEstimate(input: { file: PickedPdf; aiLevel: AiLevel }): Promise<UploadAndEstimateResult>;
  generateOnboardingSample(input?: OnboardingSampleServiceInput): Promise<OnboardingSampleResponse>;
  startConversion(input: StartConversionServiceInput): Promise<StartConversionServiceResult>;
  subscribeProgress(
    jobId: string,
    onEvent: (event: import('@/types/upload-contract').ConversionProgressEvent) => void,
    onError?: (error: Error) => void,
  ): () => void;
};

export type CreateRewiatyApiUploadServiceOptions = {
  client: RewiatyApiClient;
  /** Where the progressive importer writes the local canonical bundle. */
  db?: DatabaseAdapter;
  /** Injectable for tests; defaults to `expo-document-picker` limited to PDFs. */
  pickPdf?: () => Promise<PickedPdfFile | null>;
  /** Injectable for tests; defaults to reading the picked file with `expo-file-system`. */
  readPdfBytes?: (uri: string) => Promise<Uint8Array>;
  /** Injectable for tests; defaults to F40 storage (secure-store key + kv config). */
  resolveByok?: () => Promise<ByokInput | undefined>;
  /**
   * Injectable for tests; defaults to downloading each chapter image into
   * `books/<book_id>/assets/<name>` over `fetch`.
   */
  downloadAsset?: ChapterAssetDownloader;
};

/** Shown when the user asks for an AI sample before saving a key. */
export const SAMPLE_NEEDS_BYOK_AR = 'محتاج تحفظ مفتاح الموديل الأول عشان نجهّز العيّنة.';

/**
 * Shown when a conversion is attempted without a BYOK key.
 *
 * Why (review P2): `POST /v1/jobs` requires `byok` by contract. Sending the request without it
 * spends a round-trip only to come back as a generic HTTP error; refusing locally keeps the
 * message specific and the user on the settings screen that fixes it.
 */
export const CONVERSION_NEEDS_BYOK_AR =
  'محتاج تحفظ مفتاح الموديل الأول من إعدادات الذكاء الاصطناعي عشان تبدأ التحويل.';

/** Strong references to files mid-read (Hermes can collect a `File` during `await`). */
const filesInFlight = new Set<File>();

async function readFileBytes(uri: string): Promise<Uint8Array> {
  const file = new File(uri);
  filesInFlight.add(file);
  try {
    return await file.bytes();
  } finally {
    filesInFlight.delete(file);
  }
}

async function pickPdfWithDocumentPicker(): Promise<PickedPdfFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets || result.assets.length === 0) return null;
  const asset = result.assets[0]!;
  return {
    uri: asset.uri,
    name: asset.name,
    sizeBytes: typeof asset.size === 'number' && asset.size > 0 ? asset.size : 0,
    mimeType: asset.mimeType ?? 'application/pdf',
  };
}

/** Shown when the custom provider has no usable `https://` base URL. */
export const CUSTOM_BASE_URL_NEEDED_AR =
  'محتاج تضيف رابط سيرفر https:// صالح للمزوّد المخصّص من إعدادات الذكاء الاصطناعي.';

async function resolveByokFromStorage(db?: DatabaseAdapter): Promise<ByokInput | undefined> {
  const config = await loadByokConfig(db);
  if (!config.hasKey) return undefined;
  const apiKey = await readByokSecret(config.provider as ByokProvider);
  if (!apiKey) return undefined;

  // The backend only understands `openai_compatible` for arbitrary gateways; the app's
  // `custom` provider is that same thing plus a mandatory `base_url` and a real model name.
  if (config.provider === 'custom') {
    const baseUrl = sanitizeCustomBaseUrl(config.customBaseUrl);
    if (!baseUrl) {
      throw new Error(CUSTOM_BASE_URL_NEEDED_AR);
    }
    // Why (review finding): the old fixed placeholder (`custom-vision-model`) is not a model
    // any real gateway knows. `normalizeCustomModelId` throws the right Arabic message:
    // «اكتب اسم الموديل» for a missing name and a clear «البيانات القديمة» message for the
    // placeholder, instead of sending it and failing with an opaque 404.
    const model = normalizeCustomModelId(config.modelId);
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
}

const ABSOLUTE_ASSET_URL = /^https?:\/\//i;

/**
 * True only for a flat, single-segment filename.
 *
 * Why (security): `asset.name` comes from a server-supplied manifest. Anything that could
 * navigate the filesystem (`/`, `\\`, `\0`) or climb a directory (`..` anywhere) is refused
 * before a `File` is even constructed, so a hostile manifest can never write outside
 * `books/<book_id>/assets/`.
 */
export function isSafeChapterAssetName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  if (name.length === 0 || name === '.' || name === '..') return false;
  if (name.includes('..')) return false;
  if (/[/\\\0]/.test(name)) return false;
  return true;
}

function resolveChapterAssetUrl(baseUrl: string, assetUrl: string): string {
  if (ABSOLUTE_ASSET_URL.test(assetUrl)) return assetUrl;
  const base = baseUrl.replace(/\/+$/, '');
  const path = assetUrl.startsWith('/') ? assetUrl : `/${assetUrl}`;
  return `${base}${path}`;
}

/**
 * The real `downloadAsset` used by `ensureChapterImported`.
 *
 * Two rules, both load-bearing for staging:
 * 1. **Never leak the device JWT to a third party.** A relative URL is our own API and gets
 *    `Authorization`; an absolute (presigned S3) URL is fetched bare.
 * 2. **Never trust the manifest's filename.** `isSafeChapterAssetName` is checked first.
 */
export function createChapterAssetDownloader(client: RewiatyApiClient): ChapterAssetDownloader {
  return async (asset: ChapterBundleAsset, bookId: string): Promise<void> => {
    if (!isSafeChapterAssetName(asset.name)) {
      throw new Error('اسم صورة الفصل غير صالح.');
    }

    const isAbsolute = ABSOLUTE_ASSET_URL.test(asset.url);
    const url = isAbsolute ? asset.url : resolveChapterAssetUrl(client.getBaseUrl(), asset.url);

    const headers: Record<string, string> = {};
    if (!isAbsolute) {
      const token = await client.getAuthToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });
    if (!response.ok) {
      throw new Error(`تعذّر تنزيل صورة الفصل (${response.status}).`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const bookDir = getBookDir(bookId);
    bookDir.create({ intermediates: true, idempotent: true });
    const assetsDir = new Directory(bookDir, 'assets');
    assetsDir.create({ intermediates: true, idempotent: true });
    await new File(assetsDir, asset.name).write(bytes);
  };
}

/** Flatten one wire SSE frame into the discriminated event the screen's reducer expects. */
export function toProgressEvent(
  event: JobSseEvent,
): import('@/types/upload-contract').ConversionProgressEvent | null {
  switch (event.event) {
    case 'job.status':
      return { type: 'job.status', job_id: event.data.job_id, status: event.data.status };
    case 'job.stage':
      return { type: 'job.stage', job_id: event.data.job_id, stage: event.data.stage };
    case 'page.progress':
      return {
        type: 'page.progress',
        job_id: event.data.job_id,
        current_page: event.data.current_page,
        total_pages: event.data.total_pages,
        percent: event.data.percent,
        stage: event.data.stage,
      };
    case 'chapter.ready':
      return {
        type: 'chapter.ready',
        chapter_id: event.data.chapter_id,
        chapter_index: event.data.chapter_index,
        title: event.data.title,
        message_ar: event.data.message_ar,
        chapter_url: event.data.chapter_url,
        manifest_url: event.data.manifest_url,
        word_count: event.data.word_count,
      };
    case 'budget.mode_changed':
      return {
        type: 'budget.mode_changed',
        mode: event.data.mode,
        reason: event.data.reason,
        spent_usd: event.data.spent_usd,
        cap_usd: event.data.cap_usd,
      };
    case 'job.queued':
      return {
        type: 'job.queued',
        position: event.data.position,
        reason: event.data.reason,
        display_message_ar: event.data.display_message_ar,
        retry_after_sec: event.data.retry_after_sec,
      };
    case 'job.completed':
      return {
        type: 'job.completed',
        job_id: event.data.job_id,
        book_id: event.data.book_id,
        manifest_url: event.data.manifest_url,
        book_md_url: event.data.book_md_url,
        chapters_count: event.data.chapters_count,
        pages_processed: event.data.pages_processed,
      };
    case 'job.failed':
      return { type: 'job.failed', job_id: event.data.job_id, error: event.data.error };
    default:
      // `heartbeat` is transport liveness, not progress.
      return null;
  }
}

function fileCacheKey(pdf: PickedPdfFile): string {
  return `${pdf.uri}|${pdf.sizeBytes}|${pdf.name}`;
}

/**
 * Build the live upload service.
 *
 * Every dependency that touches the network, the filesystem or secure storage is injectable so a
 * Jest test (and an offline demo build) never needs a real backend.
 */
export function createRewiatyApiUploadService(
  options: CreateRewiatyApiUploadServiceOptions,
): RewiatyApiUploadService {
  const { client, db } = options;
  const pick = options.pickPdf ?? pickPdfWithDocumentPicker;
  const readBytes = options.readPdfBytes ?? readFileBytes;
  const resolveByok = options.resolveByok ?? (() => resolveByokFromStorage(db));
  const downloadAsset = options.downloadAsset ?? createChapterAssetDownloader(client);

  /** `book_id` since the last estimate, used when a caller omits it. */
  let lastBookId: string | undefined;
  let lastUploadId: string | undefined;
  /** Per-book last known `upload_id`, so switching between PDFs never pairs mismatched ids. */
  const bookToUploadId = new Map<string, string>();
  /** One progressive importer per `book_id` so multi-chapter imports keep earlier chapters. */
  const importers = new Map<string, ProgressiveBookImporter>();
  /** Books that have persisted at least one bundle to disk through `ensureChapterImported`. */
  const importedBooks = new Set<string>();

  /**
   * Per-picked-file upload cache. The key is the file identity, so changing only `ai_level`
   * never presigns or uploads again — it just re-estimates against the stored `upload_id`.
   */
  const uploads = new Map<string, { upload_id: string; book_id: string }>();

  async function ensureUploaded(pdf: PickedPdfFile): Promise<{ upload_id: string; book_id: string }> {
    const key = fileCacheKey(pdf);
    const cached = uploads.get(key);
    if (cached) return cached;

    // Android SAF content URIs sometimes omit `asset.size` (leaving `sizeBytes === 0`).
    // Read the file once upfront in that case so `presignUpload` never sends `size_bytes: 0`.
    let preReadBytes: Uint8Array | null = null;
    let sizeBytes = pdf.sizeBytes;
    if (!(typeof sizeBytes === 'number' && sizeBytes > 0)) {
      preReadBytes = await readBytes(pdf.uri);
      sizeBytes = preReadBytes.byteLength;
    }

    const presign = await client.presignUpload({
      filename: pdf.name,
      content_type: 'application/pdf',
      size_bytes: sizeBytes,
    });
    const bytes = preReadBytes ?? (await readBytes(pdf.uri));
    await client.uploadPdfBytes(presign, bytes);
    const completed = await client.completeUpload(presign.upload_id);

    // Cache before estimating: a failed estimate must not force a second upload.
    const entry = {
      upload_id: completed.upload_id || presign.upload_id,
      book_id: completed.book_id || presign.book_id,
    };
    uploads.set(key, entry);
    bookToUploadId.set(entry.book_id, entry.upload_id);
    lastBookId = entry.book_id;
    lastUploadId = entry.upload_id;
    return entry;
  }

  async function estimateFor(pdf: PickedPdfFile, aiLevel: AiLevel): Promise<UploadAndEstimateResult> {
    const ids = await ensureUploaded(pdf);
    const estimate: CostEstimateResponse = await client.estimateJob({
      upload_id: ids.upload_id,
      ai_level: aiLevel,
    });
    const resolved = {
      upload_id: estimate.upload_id || ids.upload_id,
      book_id: estimate.book_id || ids.book_id,
    };
    bookToUploadId.set(resolved.book_id, resolved.upload_id);
    lastBookId = resolved.book_id;
    lastUploadId = resolved.upload_id;
    // Refresh the cache with whatever the estimate echoed, so the ids always agree.
    uploads.set(fileCacheKey(pdf), resolved);
    return { upload_id: resolved.upload_id, book_id: resolved.book_id, estimate };
  }

  const uploadAndEstimate = (async (
    pdfOrInput: PickedPdfFile | { file: PickedPdfFile; aiLevel: AiLevel },
    callOptions?: { ai_level: AiLevel },
  ): Promise<UploadAndEstimateResult> => {
    if ('file' in pdfOrInput) {
      return estimateFor(pdfOrInput.file, pdfOrInput.aiLevel);
    }
    return estimateFor(pdfOrInput, callOptions?.ai_level ?? 'essential');
  }) as RewiatyApiUploadService['uploadAndEstimate'];

  const service: RewiatyApiUploadService = {
    pickPdf: async () => pick(),

    uploadAndEstimate,

    generateOnboardingSample: async (input?: OnboardingSampleServiceInput) => {
      const explicitBookId = input?.book_id;
      const bookId = explicitBookId ?? lastBookId;
      if (!bookId) {
        throw new Error('مفيش كتاب محدد نجهّز له عيّنة.');
      }
      /**
       * Why (review P3): `lastUploadId` belongs to the *last uploaded* book. Reusing it for a
       * different explicit `book_id` would ask the server for a sample of book A using book B's
       * upload — the exact cross-book mix-up this map exists to prevent. It stays a fallback
       * only when the caller did not name a book and no per-book upload is known.
       */
      const uploadId =
        input?.uploadId ??
        input?.upload_id ??
        bookToUploadId.get(bookId) ??
        (explicitBookId ? undefined : lastUploadId);
      const byok = input?.byok ?? (await resolveByok());
      if (!byok) {
        throw new Error(SAMPLE_NEEDS_BYOK_AR);
      }
      const body: OnboardingSampleRequest = {
        ...(uploadId ? { upload_id: uploadId } : {}),
        byok,
        include_style_previews: true,
      };
      return client.generateOnboardingSample(bookId, body);
    },

    saveArtDirection: (bookId: string, input: BookArtDirectionInput): Promise<BookArtDirection> =>
      client.saveArtDirection(bookId, input),

    startConversion: async (input: StartConversionServiceInput): Promise<StartConversionServiceResult> => {
      const byok = input.byok ?? (await resolveByok());
      // Why (review P2): `byok` is required by the v0 contract. Refusing here — before any
      // request — turns a generic server error into the one action that fixes it.
      if (!byok) {
        throw new Error(CONVERSION_NEEDS_BYOK_AR);
      }
      const budgetCapUsd = input.budget_cap_usd ?? input.budgetCapUsd;
      // Why (OpenAPI v0): art direction is persisted on its own endpoint first; the job body only
      // references the book.
      const body: JobCreateRequest = {
        book_id: input.book_id,
        upload_id: input.upload_id,
        ai_level: input.ai_level,
        byok,
        ...(budgetCapUsd === undefined ? {} : { budget_cap_usd: budgetCapUsd }),
      };
      const job = await client.createJob(body);
      return {
        job_id: job.job_id,
        book_id: job.book_id || input.book_id,
        status: job.status,
        ...(job.queue_state ? { queue_state: job.queue_state } : {}),
      };
    },

    subscribeProgress: (jobId, onEvent, onError) => {
      const controller = new AbortController();
      void subscribeToJobEvents({
        baseUrl: client.getBaseUrl(),
        jobId,
        getAccessToken: () => client.getAuthToken(),
        signal: controller.signal,
        onEvent: (event) => {
          const mapped = toProgressEvent(event);
          if (mapped) onEvent(mapped);
        },
        ...(onError
          ? {
              onError: (error: Error) => {
                if (!controller.signal.aborted) onError(error);
              },
            }
          : {}),
      }).catch((error: unknown) => {
        if (controller.signal.aborted || !onError) return;
        onError(error instanceof Error ? error : new Error(String(error)));
      });
      // The synchronous unsubscribe is what the screen stores in its ref; aborting closes the
      // stream and stops the reconnect loop.
      return () => controller.abort();
    },

    ensureChapterImported: async (bookId: string, chapterId?: string): Promise<void> => {
      let importer = importers.get(bookId);
      if (!importer) {
        importer = new ProgressiveBookImporter(client, bookId, db, { downloadAsset });
        importers.set(bookId, importer);
      }
      // No chapter id means the job completed without a `chapter.ready` event: import whatever
      // the manifest marks ready (the importer already no-ops when nothing is ready yet).
      const result =
        chapterId === undefined
          ? await importer.importReadyChapters()
          : await importer.importReadyChapters([chapterId]);
      if (result) {
        if (result.bookRecord) {
          importedBooks.add(bookId);
        } else if (!importedBooks.has(bookId)) {
          throw new Error('الفصل لسه مش جاهز للفتح دلوقتي، جرّب تاني بعد ثواني.');
        }
      }
    },
  };

  return service;
}
