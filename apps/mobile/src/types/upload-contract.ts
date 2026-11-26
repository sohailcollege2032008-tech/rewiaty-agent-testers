/**
 * Shapes of the L1 backend contract (`contracts/openapi.yaml`, v0) that the PDF upload
 * and F42 onboarding UI consumes.
 *
 * Why (product): the app must never talk to the backend directly from a screen — the
 * `PdfUploadService` below is the seam, so tests and an offline build can swap it out.
 * The field names stay exactly as the OpenAPI schema spells them (snake_case) so the
 * transition to a generated client is a rename, not a rewrite.
 */

export type AiLevel = 'purist' | 'essential' | 'curated' | 'directors_cut';

export type RoutingMode = 'text_only' | 'vision_ocr' | 'hybrid';

export type TextLayerQuality = 'usable' | 'corrupted' | 'empty' | 'mixed';

export type PipelineStage =
  | 'queued'
  | 'rendering'
  | 'detecting'
  | 'segmenting'
  | 'ocr'
  | 'qa'
  | 'tashkeel'
  | 'assembling'
  | 'bundling'
  | 'completed';

export type JobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type QueueReason = 'worker_saturated' | 'rate_limited' | 'upstream_429' | 'concurrency_limit';

/** A local PDF the user picked, before any byte leaves the device. */
export type PickedPdf = {
  uri: string;
  name: string;
  sizeBytes: number;
  mimeType?: string;
};

/** `CostBreakdown` — USD, split by modality. */
export type CostBreakdown = {
  text_usd: number;
  image_usd: number;
  total_usd: number;
};

/** `CostEstimateResponse` — the free, deterministic pre-flight estimate (F42). */
export type CostEstimateResponse = {
  upload_id: string;
  book_id: string;
  page_count: number;
  is_digital_text_clean: boolean;
  text_layer_quality: TextLayerQuality;
  routing_mode: RoutingMode;
  estimated_ocr_pages: number;
  estimated_image_count: number;
  estimated_cost_usd: CostBreakdown;
  estimated_duration_sec: number;
  warnings: string[];
};

/** `SuggestedThemeCandidate` — one AI-suggested reading theme (F42). */
export type SuggestedThemeCandidate = {
  theme_id: string;
  name_ar: string;
  name_en: string;
  background: string;
  surface: string;
  text: string;
  accent: string;
  rationale_ar: string;
};

/** `StyleDnaCandidate` — one AI-suggested illustration style (F42). */
export type StyleDnaCandidate = {
  style_id: string;
  name_ar: string;
  name_en: string;
  prompt_prefix: string;
  palette: string[];
  mood_tags: string[];
  preview_image_url?: string;
};

/** `OnboardingSampleResponse` — exactly 3 themes + 3 styles. */
export type OnboardingSampleResponse = {
  book_id: string;
  themes: SuggestedThemeCandidate[];
  styles: StyleDnaCandidate[];
  sample_cost_usd: number;
};

/** `BookArtDirectionInput` — the user's choice, persisted server-side. */
export type BookArtDirectionInput = {
  selected_theme_id: string;
  selected_style_id: string;
  custom_prompt_prefix?: string;
};

/** `BookArtDirection` — the saved record echoed back by the API. */
export type BookArtDirection = {
  book_id: string;
  selected_theme_id: string;
  selected_style_id: string;
  custom_prompt_prefix?: string;
  updated_at: string;
};

export type UploadAndEstimateResult = {
  upload_id: string;
  book_id: string;
  estimate: CostEstimateResponse;
};

/**
 * `ByokInput` — bring-your-own-key material attached to a job request (OpenAPI v0).
 *
 * Why (product): `ephemeral` carries the key for this one request only (the server never
 * persists it), while `saved` references a key the server already holds from F40. Keeping
 * the discriminated union exact means a generated client is a rename, not a rewrite.
 */
export type ByokInput =
  | {
      mode: 'ephemeral';
      provider: string;
      api_key: string;
      base_url?: string;
      model?: string;
      ttl_seconds?: number;
    }
  | { mode: 'saved'; key_id: string; model?: string };

/** `GenerateSampleRequest` — the F42 onboarding sample asks for 3 themes + 3 styles. */
export type GenerateSampleInput = {
  book_id: string;
  byok?: ByokInput;
};

/**
 * `JobCreateRequest` — the body of `POST /v1/jobs`.
 *
 * Why (contract): art direction is deliberately NOT here. It is persisted first through
 * `saveArtDirection` (`PUT /v1/books/{book_id}/art-direction`) and the job create request
 * only references the book — matching L1 OpenAPI v0. Sending it inline was a contract
 * drift the review caught.
 */
export type StartConversionInput = {
  book_id: string;
  upload_id: string;
  ai_level: AiLevel;
  byok?: ByokInput;
};

/** The HTTP `202` body: a job id plus the queue snapshot the job starts in. */
export type StartConversionResult = {
  job_id: string;
  book_id: string;
  queue_state?: QueueState;
};

/** `JobError` — stable code, Arabic message when available, never key material. */
export type JobError = {
  code: string;
  message: string;
  message_ar?: string;
  retryable: boolean;
  retry_after_sec?: number;
};

/** `QueueState` — F48 graceful degradation; waiting, not failing. */
export type QueueState = {
  position: number;
  reason: QueueReason;
  display_message_ar: string;
  retry_after_sec: number;
};

/** `ReadyChapterSummary` — a chapter readable while the rest still processes. */
export type ReadyChapterSummary = {
  chapter_id: string;
  chapter_index: number;
  title: string;
  message_ar: string;
  word_count?: number;
};

/**
 * The SSE stream of `/v1/jobs/{job_id}/events`, flattened into one discriminated union so a
 * reducer (and a test) can push a single event at a time.
 */
export type ConversionProgressEvent =
  | { type: 'job.status'; job_id: string; status: JobStatus }
  | { type: 'job.stage'; job_id: string; stage: PipelineStage }
  | {
      type: 'page.progress';
      job_id: string;
      current_page: number;
      total_pages: number;
      percent: number;
      stage: PipelineStage;
    }
  | {
      type: 'chapter.ready';
      chapter_id: string;
      chapter_index: number;
      title: string;
      message_ar: string;
      chapter_url: string;
      manifest_url: string;
      word_count?: number;
    }
  | {
      type: 'budget.mode_changed';
      mode: 'on_demand';
      reason: string;
      spent_usd: number;
      cap_usd: number;
    }
  | {
      type: 'job.queued';
      position: number;
      reason: QueueReason;
      display_message_ar: string;
      retry_after_sec: number;
    }
  | {
      type: 'job.completed';
      job_id: string;
      book_id: string;
      manifest_url: string;
      book_md_url: string;
      chapters_count: number;
      pages_processed: number;
    }
  | { type: 'job.failed'; job_id: string; error: JobError };

/**
 * Everything the upload flow needs from the network, behind one injectable object.
 * `subscribeProgress` returns its own unsubscribe so the screen can never leak a stream.
 *
 * `ensureChapterImported` is the local-readiness check: before the reader is opened the
 * service must confirm the first chapter is really on the device, otherwise the user would
 * land in an empty reader while the bundle is still downloading.
 */
export type PdfUploadService = {
  pickPdf: () => Promise<PickedPdf | null>;
  uploadAndEstimate: (
    pdf: PickedPdf,
    options: { ai_level: AiLevel },
  ) => Promise<UploadAndEstimateResult>;
  generateOnboardingSample: (input: GenerateSampleInput) => Promise<OnboardingSampleResponse>;
  saveArtDirection: (bookId: string, input: BookArtDirectionInput) => Promise<BookArtDirection>;
  startConversion: (input: StartConversionInput) => Promise<StartConversionResult>;
  ensureChapterImported?: (bookId: string, chapterId: string) => Promise<void>;
  subscribeProgress: (
    jobId: string,
    onEvent: (event: ConversionProgressEvent) => void,
  ) => () => void;
};
