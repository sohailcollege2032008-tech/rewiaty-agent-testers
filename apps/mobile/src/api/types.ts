/**
 * Typed mirror of the canonical Rewiaty backend contract (`contracts/openapi.yaml`, v0.1.0).
 *
 * Every type here corresponds to a `components.schemas` entry. Nothing is invented: field names
 * are snake_case exactly as the wire format uses them, and optional/required follow the contract.
 */

/* ------------------------------------------------------------------ enums */

export type AiLevel = 'purist' | 'essential' | 'curated' | 'directors_cut';

export type JobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type JobStage =
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

export type PauseReason =
  | 'rate_limited_429'
  | 'quota_exhausted'
  | 'budget_exceeded'
  | 'user_paused';

export type Platform = 'android' | 'ios' | 'web';

export type PushPlatform = 'android' | 'ios';

export type PushProvider = 'fcm' | 'expo' | 'apns';

export type BudgetMode = 'auto' | 'on_demand';

export type QueueReason =
  | 'worker_saturated'
  | 'rate_limited'
  | 'upstream_429'
  | 'concurrency_limit';

export type TextLayerQuality = 'usable' | 'corrupted' | 'empty' | 'mixed';

export type RoutingMode = 'text_only' | 'vision_ocr' | 'hybrid';

/* ------------------------------------------------------------------ auth */

export interface DeviceAuthRequest {
  device_id: string;
  platform: Platform;
  app_version?: string;
  device_secret?: string;
}

export interface DeviceAuthResponse {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  user_id: string;
  auth_provider: 'device';
  device_secret?: string;
}

/* ------------------------------------------------------------------ health */

export interface HealthResponse {
  status: 'ok';
  version: string;
}

/**
 * `checks` mirrors the backend `api/schemas.py`: one of `ok`, `error`, `skipped` per dependency.
 * (`skipped` is how the backend reports a check that could not run on this deployment.)
 */
export interface ReadinessResponse {
  status: 'ok' | 'degraded';
  checks: {
    redis: 'ok' | 'error' | 'skipped';
    storage: 'ok' | 'error' | 'skipped';
  };
}

/* ------------------------------------------------------------------ uploads */

export interface PresignUploadRequest {
  filename: string;
  content_type: 'application/pdf';
  size_bytes: number;
  /** Lowercase hex SHA-256 of the file. Integrity check only; never deduplicates. */
  sha256?: string;
}

export interface PresignUploadResponse {
  upload_id: string;
  book_id: string;
  upload_url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expires_at: string;
  raw_purge_after_hours: 24;
}

export interface CompleteUploadResponse {
  upload_id: string;
  book_id: string;
  size_bytes: number;
  status: 'uploaded';
  raw_purge_at: string;
}

/* ------------------------------------------------------------------ estimate */

export interface EstimateOptionsInput {
  tashkeel_enabled?: boolean;
}

export interface EstimateRequest {
  upload_id: string;
  ai_level: AiLevel;
  provider?: string;
  model?: string;
  options?: EstimateOptionsInput;
}

export interface CostBreakdown {
  text_usd: number;
  image_usd: number;
  total_usd: number;
}

export interface CostEstimateResponse {
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
}

/* ------------------------------------------------------------------ BYOK */

export interface SaveKeyRequest {
  provider: string;
  label?: string;
  /** Write-only. Never echoed back by the API. */
  api_key: string;
  base_url?: string;
  default_model?: string;
}

export interface SavedKeySummary {
  key_id: string;
  provider: string;
  label?: string;
  /** Last 4 characters only, e.g. `"…a91f"`. */
  key_hint: string;
  supports_text: true;
  supports_images: true;
  created_at: string;
}

export interface SavedKeyListResponse {
  keys: SavedKeySummary[];
}

export interface EphemeralByokInput {
  mode: 'ephemeral';
  provider: string;
  /** Write-only. Encrypted in Redis with a TTL, never logged or persisted. */
  api_key: string;
  base_url?: string;
  model?: string;
  ttl_seconds?: number;
}

export interface SavedByokRef {
  mode: 'saved';
  key_id: string;
  model?: string;
}

export type ByokInput = EphemeralByokInput | SavedByokRef;

/* ------------------------------------------------------------------ jobs */

export interface JobOptionsInput {
  tashkeel_enabled?: boolean;
  ocr_dpi?: number;
  priority_first_chapters?: number;
}

export interface JobCreateRequest {
  book_id: string;
  upload_id: string;
  ai_level: AiLevel;
  byok: ByokInput;
  budget_cap_usd?: number;
  options?: JobOptionsInput;
}

export interface JobProgress {
  current_page: number;
  total_pages: number;
  percent: number;
  ready_chapters_count: number;
  total_chapters_estimated: number;
}

export interface ReadyChapterSummary {
  chapter_id: string;
  chapter_index: number;
  title: string;
  word_count: number;
  chapter_url: string;
  manifest_url: string;
}

export interface BudgetStatus {
  book_cost_usd: number;
  book_cap_usd: number;
  mode: BudgetMode;
}

export interface QueueState {
  position: number;
  reason: QueueReason;
  /** Ready-to-render Arabic message: `"في قائمة الانتظار"`. */
  display_message_ar: string;
  retry_after_sec: number;
}

export interface JobError {
  code: string;
  message: string;
  message_ar?: string;
  retryable: boolean;
  retry_after_sec?: number;
}

export interface JobSummary {
  job_id: string;
  book_id: string;
  status: JobStatus;
  stage: JobStage;
  ai_level: AiLevel;
  progress: JobProgress;
  created_at: string;
  updated_at: string;
  pause_reason?: PauseReason;
}

export interface JobDetail {
  job_id: string;
  book_id: string;
  status: JobStatus;
  stage: JobStage;
  ai_level: AiLevel;
  progress: JobProgress;
  ready_chapters: ReadyChapterSummary[];
  budget_status: BudgetStatus;
  byok_mode?: 'ephemeral' | 'saved';
  queue_state?: QueueState;
  error?: JobError;
  created_at: string;
  updated_at: string;
  pause_reason?: PauseReason;
}

export interface JobListResponse {
  jobs: JobSummary[];
  /** Absent on the last page. */
  next_cursor?: string;
}

export interface JobResumeRequest {
  byok?: ByokInput;
}

/* ------------------------------------------------------------------ SSE */

export interface SseJobStatusEvent {
  job_id: string;
  status: JobStatus;
  previous_status?: JobStatus;
  /** Present when `status` is `paused`: why the worker stopped. */
  pause_reason?: PauseReason;
  updated_at: string;
}

export interface SseJobStageEvent {
  job_id: string;
  stage: JobStage;
  previous_stage?: JobStage;
  updated_at: string;
}

export interface SsePageProgressEvent {
  job_id: string;
  current_page: number;
  total_pages: number;
  percent: number;
  stage: JobStage;
}

export interface SseChapterReadyEvent {
  chapter_id: string;
  chapter_index: number;
  title: string;
  /** Renderable Arabic message, e.g. `"الفصل الأول جاهز، ابدأ اقرا"`. */
  message_ar: string;
  chapter_url: string;
  manifest_url: string;
  word_count?: number;
}

export interface SseBudgetModeChangedEvent {
  mode: 'on_demand';
  reason: string;
  spent_usd: number;
  cap_usd: number;
}

export interface SseJobQueuedEvent {
  position: number;
  reason: QueueReason;
  display_message_ar: string;
  retry_after_sec: number;
}

export interface SseJobCompletedEvent {
  job_id: string;
  book_id: string;
  manifest_url: string;
  book_md_url: string;
  chapters_count: number;
  pages_processed: number;
}

export interface SseJobFailedEvent {
  job_id: string;
  error: JobError;
}

export interface SseHeartbeatEvent {
  ts: string;
}

export type JobSseEvent =
  | { event: 'job.status'; id?: string; data: SseJobStatusEvent }
  | { event: 'job.stage'; id?: string; data: SseJobStageEvent }
  | { event: 'page.progress'; id?: string; data: SsePageProgressEvent }
  | { event: 'chapter.ready'; id?: string; data: SseChapterReadyEvent }
  | { event: 'budget.mode_changed'; id?: string; data: SseBudgetModeChangedEvent }
  | { event: 'job.queued'; id?: string; data: SseJobQueuedEvent }
  | { event: 'job.completed'; id?: string; data: SseJobCompletedEvent }
  | { event: 'job.failed'; id?: string; data: SseJobFailedEvent }
  | { event: 'heartbeat'; id?: string; data: SseHeartbeatEvent };

/* ------------------------------------------------------------------ bundle */

export interface BundleMeta {
  title: string;
  author: string;
  lang: string;
  dir: 'rtl' | 'ltr';
  /** CSS hex colour used by the reader for the cover. */
  coverColor?: string;
}

export interface BundleManifestChapter {
  id: string;
  title: string;
  wordCount: number;
  /** Content hash, stable across rebuilds. */
  hash: string;
}

export interface BundleManifestAsset {
  name: string;
  content_type: 'image/webp';
  size_bytes: number;
  width: number;
  height: number;
  url: string;
}

/**
 * `tashkeel` marker written by the backend's `run_tashkeel_pass`. Present only when the pass
 * ran; `applied: true` means `book.md` carries diacritics while the undiacritized text is
 * preserved verbatim at `originalFile`.
 */
export interface BundleTashkeelMeta {
  applied: boolean;
  originalFile: string;
}

export interface BundleManifestResponse {
  id: string;
  meta: BundleMeta;
  chapters: BundleManifestChapter[];
  /** Total of `chapters[].wordCount`, computed by the pinned `@rewiaty/book-format`. */
  wordCount: number;
  parserVersion: 1;
  /** Format the source text arrived in (`md` for server-produced bundles). */
  sourceFormat?: 'md' | 'txt';
  /** Semver of the pinned `@rewiaty/book-format` used to compute hashes (e.g. `"0.1.0"`). */
  bookFormatVersion?: string;
  tashkeel?: BundleTashkeelMeta;
  is_complete: boolean;
  /** Chapter ids whose branch is downloadable right now. */
  ready_chapter_ids: string[];
  /** URL of the full `book.md` (404 until `is_complete`). */
  book_md_url: string;
  assets: BundleManifestAsset[];
}

export interface ChapterBundleAsset {
  name: string;
  url: string;
  width: number;
  height: number;
}

export interface ChapterBundleResponse {
  chapter_id: string;
  chapter_index: number;
  title: string;
  hash: string;
  word_count: number;
  /** Chapter markdown body, exactly as it appears in `book.md`. */
  markdown: string;
  assets: ChapterBundleAsset[];
}

export interface BookMdUrlResponse {
  url: string;
  expires_at: string;
}

export interface AssetUrlResponse {
  url: string;
  expires_at: string;
  content_type: 'image/webp';
  size_bytes: number;
}

/* ------------------------------------------------------------------ budget & usage */

export interface BudgetConfig {
  default_ai_level: AiLevel;
  max_book_cost_usd: number;
  max_daily_images: number;
  on_demand_threshold_percent: number;
}

export interface UsageBreakdown {
  text_cost_usd: number;
  image_cost_usd: number;
  total_cost_usd: number;
  text_input_tokens: number;
  text_output_tokens: number;
  images_generated: number;
}

export interface DailyImagesUsage {
  date: string;
  used: number;
  limit: number;
  remaining: number;
}

export interface BookUsageSummary {
  book_id: string;
  text_cost_usd: number;
  image_cost_usd: number;
  total_cost_usd: number;
  text_input_tokens: number;
  text_output_tokens: number;
  images_generated: number;
  budget_cap_usd: number;
  budget_mode: BudgetMode;
}

export interface UsageSummaryResponse {
  month: string;
  totals: UsageBreakdown;
  daily_images: DailyImagesUsage;
  books: BookUsageSummary[];
}

/* ------------------------------------------------------------------ notifications */

export interface PushTokenRequest {
  device_id: string;
  platform: PushPlatform;
  provider: PushProvider;
  /** Write-only: never echoed back. */
  token: string;
}

export interface PushTokenResponse {
  token_id: string;
  device_id: string;
  platform: PushPlatform;
  provider: PushProvider;
  registered_at: string;
}

/* ------------------------------------------------------------------ onboarding (F42) */

export interface SuggestedThemeCandidate {
  theme_id: string;
  name_ar: string;
  name_en: string;
  background: string;
  surface: string;
  text: string;
  accent: string;
  rationale_ar: string;
}

export interface StyleDnaCandidate {
  style_id: string;
  name_ar: string;
  name_en: string;
  prompt_prefix: string;
  palette: string[];
  mood_tags: string[];
  preview_image_url?: string;
}

export interface OnboardingSampleRequest {
  upload_id?: string;
  byok: ByokInput;
  include_style_previews?: boolean;
}

export interface OnboardingSampleResponse {
  book_id: string;
  themes: SuggestedThemeCandidate[];
  styles: StyleDnaCandidate[];
  sample_cost_usd: number;
}

export interface BookArtDirectionInput {
  selected_theme_id: string;
  selected_style_id: string;
  custom_prompt_prefix?: string;
}

export interface BookArtDirection {
  book_id: string;
  selected_theme_id: string;
  selected_style_id: string;
  custom_prompt_prefix?: string;
  updated_at: string;
}

/* ------------------------------------------- strict-index Q&A (F49) */

/**
 * One client-supplied context excerpt for the spoiler-free Q&A endpoint.
 *
 * Its `block_id` must sit at or before the request's `up_to_block_id`: the server rejects
 * anything past the strict-index cutoff rather than silently dropping it.
 */
export interface BookQaExcerpt {
  /** Block id in reading order, e.g. `"ch02_p0012"`. */
  block_id: string;
  chapter_title?: string;
  text: string;
}

/**
 * Spoiler-free Q&A request bounded by the reader's current position (F49).
 *
 * Only content up to **and including** `up_to_block_id` may enter the model prompt. The
 * reader app builds `context_excerpts` strictly from the book up to that cutoff so the answer
 * can never describe, hint at or reveal later plot.
 */
export interface BookQaRequest {
  question: string;
  up_to_chapter_id: string;
  up_to_block_id: string;
  /**
   * Exclusive 0-based character prefix cutoff inside `up_to_block_id` (e.g. `120` keeps only
   * `text[:120]`). Applied to the cutoff block in both server-loaded bundles and client
   * `context_excerpts`.
   */
  up_to_char_offset?: number;
  book_title?: string;
  context_excerpts?: BookQaExcerpt[];
  byok: ByokInput;
  budget_cap_usd?: number;
}

/** A cited block; `block_id` is always at or before the enforced cutoff. */
export interface BookQaCitation {
  block_id: string;
  quote: string;
}

/**
 * Spoiler-free answer. `spoiler_free` is always `true`; `cutoff_block_id` echoes the enforced
 * boundary. Never contains an `api_key` or any provider secret.
 */
export interface BookQaResponse {
  book_id: string;
  answer: string;
  cutoff_block_id: string;
  citations: BookQaCitation[];
  cost_usd: number;
  spoiler_free: true;
}

/* ------------------------------------------------------------------ errors */

export interface ErrorDetail {
  code: string;
  /** Developer-facing English message. */
  message: string;
  /** Optional Arabic user-facing message. */
  message_ar?: string;
  retryable: boolean;
  retry_after_sec?: number;
  /** Non-sensitive context only: field names, limits, ids. */
  details?: Record<string, unknown>;
}

export interface ErrorResponse {
  error: ErrorDetail;
}
