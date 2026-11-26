import type {
  AiLevel,
  AssetUrlResponse,
  BookArtDirection,
  BookArtDirectionInput,
  BookMdUrlResponse,
  BudgetConfig,
  BundleManifestResponse,
  ChapterBundleResponse,
  CompleteUploadResponse,
  CostEstimateResponse,
  DeviceAuthRequest,
  DeviceAuthResponse,
  ErrorResponse,
  EstimateRequest,
  JobCreateRequest,
  JobDetail,
  JobListResponse,
  JobResumeRequest,
  JobStatus,
  OnboardingSampleRequest,
  OnboardingSampleResponse,
  PresignUploadRequest,
  PresignUploadResponse,
  PushTokenRequest,
  PushTokenResponse,
  SaveKeyRequest,
  SavedKeyListResponse,
  SavedKeySummary,
  UsageSummaryResponse,
  BookUsageSummary,
} from './types';

/** Placeholder substituted for anything that looks like key material. */
const REDACTED = '[REDACTED]';

/**
 * Credentials shorter than this are not scrubbed: replacing a 1–2 character fragment
 * everywhere would corrupt ordinary words (and Arabic text) without protecting anything
 * meaningful. Everything a caller registers as a credential (`api_key`, `device_secret`,
 * `access_token`, push `token`) at or above this length is scrubbed from every text field.
 */
const MIN_CREDENTIAL_SCRUB_LENGTH = 3;

export interface ApiErrorOptions {
  status: number;
  code: string;
  messageAr?: string;
  retryable?: boolean;
  retryAfterSec?: number;
  /** Sanitizer applied to every text field, so no echoed credential can survive. */
  scrub?: (text: string) => string;
}

/**
 * A failed API call.
 *
 * Security rule (non-negotiable): this error never carries request credentials. `message`,
 * `code` and `messageAr` are scrubbed against every secret the client has seen (BYOK keys,
 * device secrets, access tokens) before they are stored, and `toJSON`/`toString` expose only
 * those scrubbed fields, so an error that is logged, serialized or reported can never leak a
 * key even when the upstream echoes it back in the code or the Arabic message.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly messageAr?: string;
  readonly retryable: boolean;
  readonly retryAfterSec?: number;

  constructor(message: string, options: ApiErrorOptions) {
    const scrub = options.scrub ?? ((text: string): string => text);
    super(scrub(message));
    this.name = 'ApiError';
    this.status = options.status;
    this.code = scrub(options.code);
    if (options.messageAr !== undefined) this.messageAr = scrub(options.messageAr);
    this.retryable = options.retryable ?? false;
    if (options.retryAfterSec !== undefined) this.retryAfterSec = options.retryAfterSec;
    // Keep `Object.keys(err)` limited to safe fields (no accidental `cause`/config objects).
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  toString(): string {
    const suffix = this.messageAr ? ` · ${this.messageAr}` : '';
    return `ApiError(${this.status} ${this.code}): ${this.message}${suffix}`;
  }

  toJSON(): {
    name: string;
    status: number;
    code: string;
    message: string;
    messageAr?: string;
    retryable: boolean;
    retryAfterSec?: number;
  } {
    return {
      name: this.name,
      status: this.status,
      code: this.code,
      message: this.message,
      messageAr: this.messageAr,
      retryable: this.retryable,
      retryAfterSec: this.retryAfterSec,
    };
  }
}

export interface RewiatyApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getAccessToken?: () => string | null | Promise<string | null>;
}

type QueryValue = string | number | boolean | undefined | null;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** Defaults to true; `false` for public endpoints (device auth). */
  auth?: boolean;
  /** Accepted non-2xx statuses for endpoints that answer 202 (`POST /v1/jobs`). */
  acceptStatuses?: number[];
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const params: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return params.length > 0 ? `?${params.join('&')}` : '';
}

function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  return undefined;
}

/**
 * Headers that must never be forwarded to object storage from a presign response.
 *
 * A presigned S3/GCS URL carries its signature in the query string, so object storage has no
 * use for the client's own credentials. If the backend ever echoes `Authorization`, `Cookie`
 * or `Proxy-Authorization` into `presign.headers`, the app JWT/session would travel to a third
 * party — so they are dropped here, case-insensitively.
 */
const FORBIDDEN_UPLOAD_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization', 'set-cookie']);

function sanitizeUploadHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (FORBIDDEN_UPLOAD_HEADERS.has(key.trim().toLowerCase())) continue;
    safe[key] = value;
  }
  return safe;
}

/**
 * Typed client for the Rewiaty backend v0 contract.
 *
 * Holds at most one credential: the device JWT. It is never interpolated into a message, a
 * serialized field or a log line — only into the `Authorization` header of a request.
 */
export class RewiatyApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly getAccessTokenOption?: () => string | null | Promise<string | null>;
  private accessToken: string | null = null;

  /** Every secret value this client has handled, used to scrub upstream error echoes. */
  private readonly secrets = new Set<string>();

  constructor(options: RewiatyApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImpl =
      options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.getAccessTokenOption = options.getAccessToken;
  }

  /** Store (or clear) the device JWT used for `Authorization: Bearer`. */
  setAccessToken(token: string | null): void {
    this.accessToken = token;
    if (token) this.rememberSecret(token);
  }

  /** The token the next request will use, honouring a custom `getAccessToken`. */
  private async resolveAccessToken(): Promise<string | null> {
    if (this.getAccessTokenOption) {
      const token = await this.getAccessTokenOption();
      if (token) this.rememberSecret(token);
      return token ?? null;
    }
    return this.accessToken;
  }

  private rememberSecret(value: string | null | undefined): void {
    if (!value) return;
    const trimmed = value.trim();
    if (trimmed.length < MIN_CREDENTIAL_SCRUB_LENGTH) return;
    this.secrets.add(trimmed);
  }

  /** Remove every known secret value from a piece of text (upstream error echoes included). */
  private scrub(text: string): string {
    if (!text) return text;
    let result = text;
    // Longest first: scrubbing a short secret that is a substring of a longer one would
    // leave a fragment of the longer credential behind.
    const ordered = [...this.secrets].sort((a, b) => b.length - a.length);
    for (const secret of ordered) {
      if (result.includes(secret)) {
        result = result.split(secret).join(REDACTED);
      }
    }
    return result;
  }

  private async buildHeaders(options: RequestOptions): Promise<Record<string, string>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.auth !== false) {
      const token = await this.resolveAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const url = `${this.baseUrl}${path}${buildQuery(options.query)}`;
    const headers = await this.buildHeaders(options);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      throw new ApiError(this.scrub(`تعذّر الاتصال بالسيرفر: ${raw}`), {
        status: 0,
        code: 'NETWORK_ERROR',
        retryable: true,
      });
    }

    const accepted = options.acceptStatuses ?? [];
    if (!response.ok && !accepted.includes(response.status)) {
      throw await this.toApiError(response);
    }

    if (response.status === 204) {
      return undefined as unknown as T;
    }

    const text = await response.text();
    if (!text || !text.trim()) {
      return undefined as unknown as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      // A 2xx with a non-JSON body is a contract violation, not a crash.
      throw new ApiError(this.scrub('رد السيرفر غير صالح'), {
        status: response.status,
        code: 'INVALID_RESPONSE',
        retryable: false,
      });
    }
  }

  private async toApiError(response: Response): Promise<ApiError> {
    const retryAfterHeader = parseRetryAfter(response.headers?.get?.('Retry-After') ?? null);
    let payload: Partial<ErrorResponse> | null = null;
    try {
      const text = await response.text();
      if (text && text.trim()) payload = JSON.parse(text) as Partial<ErrorResponse>;
    } catch {
      payload = null;
    }

    const detail = payload?.error;
    const fallbackCode = `HTTP_${response.status}`;
    const code = typeof detail?.code === 'string' && detail.code ? detail.code : fallbackCode;
    const rawMessage =
      typeof detail?.message === 'string' && detail.message
        ? detail.message
        : response.statusText || `HTTP ${response.status}`;

    const options: ApiErrorOptions = {
      status: response.status,
      code,
      retryable: typeof detail?.retryable === 'boolean' ? detail.retryable : isRetryableStatus(response.status),
      // Every text field is sanitized inside the constructor as well, so `code` and
      // `message_ar` echoes are covered exactly like `message`.
      scrub: (text: string) => this.scrub(text),
    };
    if (typeof detail?.message_ar === 'string' && detail.message_ar) {
      options.messageAr = detail.message_ar;
    }
    const retryAfter =
      typeof detail?.retry_after_sec === 'number' ? detail.retry_after_sec : retryAfterHeader;
    if (typeof retryAfter === 'number') options.retryAfterSec = retryAfter;

    return new ApiError(rawMessage, options);
  }

  /* ---------------------------------------------------------------- auth */

  async authenticateDevice(body: DeviceAuthRequest): Promise<DeviceAuthResponse> {
    this.rememberSecret(body.device_secret);
    const response = await this.request<DeviceAuthResponse>('/v1/auth/device', {
      method: 'POST',
      body,
      auth: false,
    });
    this.rememberSecret(response.access_token);
    this.rememberSecret(response.device_secret);
    // A custom token provider owns the lifecycle; otherwise cache what the server issued.
    if (!this.getAccessTokenOption) {
      this.accessToken = response.access_token;
    }
    return response;
  }

  /* ------------------------------------------------------------- uploads */

  presignUpload(body: PresignUploadRequest): Promise<PresignUploadResponse> {
    return this.request<PresignUploadResponse>('/v1/uploads/presign', { method: 'POST', body });
  }

  /**
   * PUT the PDF bytes straight to object storage at the presigned URL.
   *
   * Sends only the storage-relevant headers from the presign response: the app Bearer JWT and
   * any cookie must never reach S3, and the presigned signature already lives in the URL.
   */
  async uploadPdfBytes(
    presign: PresignUploadResponse,
    data: Uint8Array | ArrayBuffer | Blob,
  ): Promise<void> {
    const headers = sanitizeUploadHeaders(presign.headers);
    let response: Response;
    try {
      response = await this.fetchImpl(presign.upload_url, {
        method: presign.method ?? 'PUT',
        headers,
        body: data as BodyInit,
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      throw new ApiError(this.scrub(`تعذّر رفع الملف: ${raw}`), {
        status: 0,
        code: 'UPLOAD_NETWORK_ERROR',
        retryable: true,
      });
    }
    if (!response.ok) {
      throw new ApiError(this.scrub(`فشل رفع الملف إلى التخزين (${response.status})`), {
        status: response.status,
        code: 'UPLOAD_FAILED',
        retryable: isRetryableStatus(response.status),
      });
    }
  }

  completeUpload(uploadId: string): Promise<CompleteUploadResponse> {
    return this.request<CompleteUploadResponse>(
      `/v1/uploads/${encodeURIComponent(uploadId)}/complete`,
      { method: 'POST' },
    );
  }

  /* ------------------------------------------------------------ estimate */

  estimateJob(body: EstimateRequest): Promise<CostEstimateResponse> {
    return this.request<CostEstimateResponse>('/v1/jobs/estimate', { method: 'POST', body });
  }

  /* ---------------------------------------------------------------- BYOK */

  listKeys(): Promise<SavedKeyListResponse> {
    return this.request<SavedKeyListResponse>('/v1/keys');
  }

  saveKey(body: SaveKeyRequest): Promise<SavedKeySummary> {
    this.rememberSecret(body.api_key);
    return this.request<SavedKeySummary>('/v1/keys', { method: 'POST', body });
  }

  async deleteKey(keyId: string): Promise<void> {
    await this.request<void>(`/v1/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' });
  }

  /* ---------------------------------------------------------------- jobs */

  listJobs(params: { status?: JobStatus; limit?: number; cursor?: string } = {}): Promise<JobListResponse> {
    return this.request<JobListResponse>('/v1/jobs', {
      query: { status: params.status, limit: params.limit, cursor: params.cursor },
    });
  }

  createJob(body: JobCreateRequest): Promise<JobDetail> {
    this.rememberByok(body.byok);
    // 202 is the documented graceful-degradation answer (queued), not an error.
    return this.request<JobDetail>('/v1/jobs', {
      method: 'POST',
      body,
      acceptStatuses: [202],
    });
  }

  getJob(jobId: string): Promise<JobDetail> {
    return this.request<JobDetail>(`/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  pauseJob(jobId: string): Promise<JobDetail> {
    return this.request<JobDetail>(`/v1/jobs/${encodeURIComponent(jobId)}/pause`, {
      method: 'POST',
    });
  }

  resumeJob(jobId: string, body?: JobResumeRequest): Promise<JobDetail> {
    if (body?.byok) this.rememberByok(body.byok);
    return this.request<JobDetail>(`/v1/jobs/${encodeURIComponent(jobId)}/resume`, {
      method: 'POST',
      ...(body === undefined ? {} : { body }),
    });
  }

  cancelJob(jobId: string): Promise<JobDetail> {
    return this.request<JobDetail>(`/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
    });
  }

  /* -------------------------------------------------------------- bundle */

  getBundleManifest(bookId: string): Promise<BundleManifestResponse> {
    return this.request<BundleManifestResponse>(
      `/v1/books/${encodeURIComponent(bookId)}/bundle/manifest`,
    );
  }

  getBundleChapter(bookId: string, chapterId: string): Promise<ChapterBundleResponse> {
    return this.request<ChapterBundleResponse>(
      `/v1/books/${encodeURIComponent(bookId)}/bundle/chapters/${encodeURIComponent(chapterId)}`,
    );
  }

  getBookMdUrl(
    bookId: string,
    options: { variant?: 'current' | 'original' } = {},
  ): Promise<BookMdUrlResponse> {
    return this.request<BookMdUrlResponse>(
      `/v1/books/${encodeURIComponent(bookId)}/bundle/book.md`,
      { query: { format: 'url', variant: options.variant } },
    );
  }

  getAssetUrl(bookId: string, assetName: string): Promise<AssetUrlResponse> {
    return this.request<AssetUrlResponse>(
      `/v1/books/${encodeURIComponent(bookId)}/bundle/assets/${encodeURIComponent(assetName)}`,
    );
  }

  /* -------------------------------------------------------- budget & usage */

  getBudget(): Promise<BudgetConfig> {
    return this.request<BudgetConfig>('/v1/budget');
  }

  updateBudget(body: Partial<BudgetConfig>): Promise<BudgetConfig> {
    return this.request<BudgetConfig>('/v1/budget', { method: 'PUT', body });
  }

  getUsage(month?: string): Promise<UsageSummaryResponse> {
    return this.request<UsageSummaryResponse>('/v1/usage', { query: { month } });
  }

  getBookUsage(bookId: string): Promise<BookUsageSummary> {
    return this.request<BookUsageSummary>(`/v1/books/${encodeURIComponent(bookId)}/usage`);
  }

  /* ------------------------------------------------------- notifications */

  registerPushToken(body: PushTokenRequest): Promise<PushTokenResponse> {
    // The provider token is not an API credential, but it is write-only in the contract.
    this.rememberSecret(body.token);
    return this.request<PushTokenResponse>('/v1/devices/push-token', { method: 'POST', body });
  }

  async deletePushToken(tokenId: string): Promise<void> {
    await this.request<void>(`/v1/devices/push-token/${encodeURIComponent(tokenId)}`, {
      method: 'DELETE',
    });
  }

  /* ---------------------------------------------------- onboarding (F42) */

  generateOnboardingSample(
    bookId: string,
    body: OnboardingSampleRequest,
  ): Promise<OnboardingSampleResponse> {
    this.rememberByok(body.byok);
    return this.request<OnboardingSampleResponse>(
      `/v1/books/${encodeURIComponent(bookId)}/onboarding/sample`,
      { method: 'POST', body },
    );
  }

  getArtDirection(bookId: string): Promise<BookArtDirection> {
    return this.request<BookArtDirection>(
      `/v1/books/${encodeURIComponent(bookId)}/art-direction`,
    );
  }

  saveArtDirection(
    bookId: string,
    body: BookArtDirectionInput,
  ): Promise<BookArtDirection> {
    return this.request<BookArtDirection>(
      `/v1/books/${encodeURIComponent(bookId)}/art-direction`,
      { method: 'PUT', body },
    );
  }

  private rememberByok(byok: { mode: string; api_key?: string } | undefined): void {
    if (!byok) return;
    if (byok.mode === 'ephemeral') this.rememberSecret(byok.api_key);
  }
}

/** Re-exported so callers can type table literals without importing `types.ts` directly. */
export type { AiLevel };
