import * as SecureStore from 'expo-secure-store';

import { getKv, setKv, type DatabaseAdapter } from './database';

/**
 * F40 — BYOK (Bring Your Own Key) آمن.
 *
 * القاعدة اللي الملف ده بيحميها: **المفتاح الخام مبيخرجش من `expo-secure-store` أبداً**.
 * أي بيانات تانية (المزوّد، الموديل، وضع التخزين، آخر ٤ حروف، حالة وجود مفتاح) هي بيانات
 * غير سرية وبتتخزن في جدول `kv` العادي. مفيش `console.*` ولا رسالة `Error` فيها المفتاح،
 * وكل نص خارج من الملف بيعدي على `redactSecrets` الأول.
 */

export type ByokProvider = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'custom';

export type ByokStorageMode = 'ephemeral' | 'server-saved';

export type ByokModelPreset = {
  id: string;
  labelAr: string;
  provider: ByokProvider;
  supportsText: boolean;
  supportsVision: boolean;
};

export type ByokProviderInfo = {
  id: ByokProvider;
  labelAr: string;
  hintAr: string;
};

/**
 * كل الموديلات المقترحة بيدعم النص والصور مع بعض (شرط F40). التحقق نفسه
 * (`validateByokModelCapabilities`) شغال على أي موديل، حتى المخصص، وبي reject
 * أي موديل نص بس أو صور بس.
 */
export const BYOK_MODEL_PRESETS: readonly ByokModelPreset[] = [
  { id: 'gpt-4.1', labelAr: 'GPT-4.1', provider: 'openai', supportsText: true, supportsVision: true },
  {
    id: 'gpt-4.1-mini',
    labelAr: 'GPT-4.1 mini',
    provider: 'openai',
    supportsText: true,
    supportsVision: true,
  },
  {
    id: 'claude-sonnet-4-5',
    labelAr: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    supportsText: true,
    supportsVision: true,
  },
  {
    id: 'claude-opus-4-1',
    labelAr: 'Claude Opus 4.1',
    provider: 'anthropic',
    supportsText: true,
    supportsVision: true,
  },
  {
    id: 'claude-haiku-4-5',
    labelAr: 'Claude Haiku 4.5',
    provider: 'anthropic',
    supportsText: true,
    supportsVision: true,
  },
  {
    id: 'gemini-2.5-pro',
    labelAr: 'Gemini 2.5 Pro',
    provider: 'google',
    supportsText: true,
    supportsVision: true,
  },
  {
    id: 'gemini-2.5-flash',
    labelAr: 'Gemini 2.5 Flash',
    provider: 'google',
    supportsText: true,
    supportsVision: true,
  },
  {
    id: 'google/gemini-2.5-pro',
    labelAr: 'Gemini 2.5 Pro (OpenRouter)',
    provider: 'openrouter',
    supportsText: true,
    supportsVision: true,
  },
  {
    id: 'anthropic/claude-sonnet-4.5',
    labelAr: 'Claude Sonnet 4.5 (OpenRouter)',
    provider: 'openrouter',
    supportsText: true,
    supportsVision: true,
  },
];

/**
 * الـ placeholder القديم اللي كان بيتحفظ للمزوّد المخصّص قبل ما المستخدم يقدر يكتب اسم
 * موديل حقيقي. **مش اسم موديل** وممنوع يتبعت في `model` لأي gateway.
 *
 * Why (review finding): التطبيق كان بيبعت `custom-vision-model` لكل مزوّد مخصّص، فأي
 * gateway حقيقي بيرد بـ 404 model not found. البيانات القديمة اللي فيها القيمة دي بتفضل
 * تتقرا (عشان نعرض رسالة واضحة) لكن مش بتتبعت ولا بتتحفظ من جديد.
 */
export const LEGACY_CUSTOM_MODEL_ID = 'custom-vision-model';

/**
 * اسم الموديل المخصّص اللي بيكتبه المستخدم بنفسه (زي `deepseek-chat` أو
 * `meta-llama/Llama-3.1-70B-Instruct`). مسموح بالحروف والأرقام و `. _ - / : @` بس،
 * من غير مسافات — نفس الشكل اللي الـ gateways المتوافقة مع OpenAI بتقبله.
 */
const CUSTOM_MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,199}$/;

/** رسالة موديل مخصّص مطلوب — بتظهر لما المستخدم يحفظ من غير ما يكتب اسم موديل. */
export const BYOK_CUSTOM_MODEL_REQUIRED_ERROR_AR =
  'اكتب اسم الموديل الحقيقي للمزوّد المخصّص (زي deepseek-chat) قبل الحفظ.';

/** رسالة البيانات القديمة: الـ placeholder مش اسم موديل، فلازم المستخدم يكتب اسم حقيقي. */
export const BYOK_CUSTOM_MODEL_LEGACY_ERROR_AR =
  'الموديل المخصّص المحفوظ قديم ومش اسم موديل حقيقي. اكتب اسم الموديل من مزوّدك واحفظ تاني.';

/** رسالة اسم موديل فيه حروف/مسافات مش مسموحة. */
export const BYOK_CUSTOM_MODEL_INVALID_ERROR_AR =
  'اسم الموديل فيه حروف أو مسافات غير مسموحة. اكتبه زي ما مزوّدك كاتبه (حروف إنجليزي وأرقام و . _ - / : @ بس).';

/** رسالة غياب `base_url` وقت حفظ مفتاح المزوّد المخصّص. */
export const BYOK_CUSTOM_BASE_URL_REQUIRED_ERROR_AR =
  'لازم تدخل رابط سيرفر https:// للمزوّد المخصّص قبل حفظ المفتاح.';

export const BYOK_PROVIDERS: readonly ByokProviderInfo[] = [
  { id: 'openai', labelAr: 'OpenAI', hintAr: 'مفاتيح بتبدأ بـ sk-' },
  { id: 'anthropic', labelAr: 'Anthropic', hintAr: 'مفاتيح بتبدأ بـ sk-ant-' },
  { id: 'google', labelAr: 'Google', hintAr: 'مفاتيح بتبدأ بـ AIza' },
  { id: 'openrouter', labelAr: 'OpenRouter', hintAr: 'مفاتيح بتبدأ بـ sk-or-v1-' },
  { id: 'custom', labelAr: 'مخصص', hintAr: 'أي مزوّد متوافق' },
];

export const DEFAULT_BYOK_MODEL_ID = 'gpt-4.1';

/** مفتاح `kv` للإعدادات غير السرية (المزوّد/الموديل/الوضع/آخر ٤ حروف). */
export const BYOK_KV_KEY = 'byok_config_v1';

/** بادئة اسم المدخل السرّي في `expo-secure-store` — المفتاح الخام بيعيش هنا وبس. */
export const BYOK_SECRET_ENTRY = ['rewiaty.byok', 'api_key', 'v1'].join('.');

/**
 * أقل طول مقبول لمفتاح API. أي مفتاح أقصر من كده بيتعامل معاه كقيمة غير صالحة:
 * مبيتخزنش، ومبيتعرضش آخر ٤ حروف منه، ومبيتحسبش كـ«مفتاح محفوظ».
 */
export const MIN_BYOK_KEY_LENGTH = 20;

/**
 * اسم المدخل السرّي لكل مزوّد على حدة. كل مزوّد ليه مفتاحه المستقل، فمفيش
 * مزوّد بيورث `hasKey` أو `keyLast4` من مزوّد تاني.
 * الحروف المستخدمة (`[A-Za-z0-9._-]`) مسموحة في `expo-secure-store`.
 */
export function getByokSecretEntryKey(provider: ByokProvider): string {
  return `${BYOK_SECRET_ENTRY}.${provider}`;
}

/** شارة الموديل في الواجهة — شرط F40 ظاهر للطالب. */
export const BYOK_MODELS_BADGE_AR = 'نص + صور';

export const BYOK_EMPTY_MESSAGE_AR = 'مفيش مفتاح محفوظ على الجهاز.';
export const BYOK_SAVED_MESSAGE_AR = 'المفتاح محفوظ على جهازك بأمان.';
export const BYOK_DELETED_MESSAGE_AR = 'المفتاح اتحذف من جهازك.';

/** وضع «الحفظ على السيرفر» لسه مش موصول بـ `/v1/keys` — بنقولها بصراحة. */
export const BYOK_SERVER_MODE_UNAVAILABLE_AR =
  'حفظ المفتاح على السيرفر قريباً — حالياً يعمل الوضع المؤقت فقط.';

/** رسالة التحقق الثابتة للمفتاح القصير — من غير أي حرف من المفتاح نفسه. */
export const BYOK_KEY_TOO_SHORT_ERROR_AR =
  'المفتاح قصير جداً — تأكد إنك نسخت المفتاح بالكامل (20 حرفاً على الأقل).';

/** رسائل ثابتة لأخطاء `expo-secure-store` — ممنوع تمرير نص الخطأ الأصلي. */
export const BYOK_SECURE_STORE_SAVE_ERROR_AR = 'تعذّر حفظ المفتاح بأمان على الجهاز. جرّب تاني.';
export const BYOK_SECURE_STORE_READ_ERROR_AR = 'تعذّر قراءة المفتاح المحفوظ من الجهاز.';
export const BYOK_SECURE_STORE_DELETE_ERROR_AR = 'تعذّر حذف المفتاح من الجهاز.';
export const BYOK_UNKNOWN_ERROR_AR = 'حصل خطأ غير متوقع في إعدادات المفتاح. جرّب تاني.';

/** رسالة رابط السيرفر للمزوّد المخصّص — ثابتة ومن غير أي تفاصيل تقنية. */
export const BYOK_CUSTOM_BASE_URL_ERROR_AR = 'رابط السيرفر لازم يبدأ بـ https:// ويكون عنوان صحيح.';

export type ByokConfig = {
  provider: ByokProvider;
  modelId: string;
  storageMode: ByokStorageMode;
  keyLast4: string | null;
  hasKey: boolean;
  updatedAt: number;
  /** `base_url` for the `custom` provider only; always HTTPS or `null`. */
  customBaseUrl?: string | null;
};

export const DEFAULT_BYOK_CONFIG: ByokConfig = {
  provider: 'openai',
  modelId: DEFAULT_BYOK_MODEL_ID,
  storageMode: 'ephemeral',
  keyLast4: null,
  hasKey: false,
  updatedAt: 0,
  customBaseUrl: null,
};

/**
 * واجهة `expo-secure-store` اللي بنستخدمها — قابلة للحقن عشان الاختبارات
 * تشتغل من غير native module.
 */
export type ByokSecureStoreAdapter = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export const expoSecureStoreAdapter: ByokSecureStoreAdapter = {
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
};

const VALID_PROVIDERS = new Set<ByokProvider>(BYOK_PROVIDERS.map((provider) => provider.id));
const VALID_STORAGE_MODES = new Set<ByokStorageMode>(['ephemeral', 'server-saved']);

export function isByokProvider(value: unknown): value is ByokProvider {
  return typeof value === 'string' && VALID_PROVIDERS.has(value as ByokProvider);
}

export function isByokStorageMode(value: unknown): value is ByokStorageMode {
  return typeof value === 'string' && VALID_STORAGE_MODES.has(value as ByokStorageMode);
}

/**
 * `base_url` للمزوّد المخصّص: HTTPS بس، عنوان غير فاضي، ومن غير مسافات
 * أو بيانات دخول مدسوسة في الرابط (`user:pass@host`).
 *
 * بيرجع الرابط بعد التنضيف (بدون `/` في الآخر)، أو بيرمي رسالة عربية ثابتة.
 */
export function validateHttpsBaseUrl(raw: string): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const match = /^https:\/\/([^\s/?#]+)([^\s]*)$/i.exec(value);
  if (!match) {
    throw new Error(BYOK_CUSTOM_BASE_URL_ERROR_AR);
  }

  const authority = match[1] ?? '';
  const host = authority.replace(/:\d+$/, '');
  const validHost = host.length > 0 && !host.includes('@') && !host.includes('\\') && /^[^\s:/@]+$/.test(host);
  if (!authority || !validHost) {
    throw new Error(BYOK_CUSTOM_BASE_URL_ERROR_AR);
  }

  // بندّي السيرفر عناوين ثابتة من غير `/` زيادة في الآخر.
  return value.replace(/\/+$/, '');
}

/** نسخة غير رامية من `validateHttpsBaseUrl` — بترجع `null` لأي قيمة غير صالحة. */
export function sanitizeCustomBaseUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    return validateHttpsBaseUrl(raw);
  } catch {
    return null;
  }
}

/** القيمة القديمة (`custom-vision-model`) — مش اسم موديل حقيقي وممنوع تتبعت. */
export function isLegacyCustomModelId(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === LEGACY_CUSTOM_MODEL_ID;
}

/** اسم موديل مخصّص صالح: مش فاضي، شكل صحيح، ومش الـ placeholder القديم. */
export function isValidCustomModelId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || isLegacyCustomModelId(trimmed)) return false;
  return CUSTOM_MODEL_ID_PATTERN.test(trimmed);
}

/**
 * تنظيف اسم الموديل المخصّص قبل الحفظ/الإرسال.
 *
 * التمييز بين الرسائل مقصود: البيانات القديمة (`custom-vision-model`) ليه رسالة
 * «حدّث اسم الموديل» مختلفة عن «اكتب اسم الموديل» عشان المستخدم يفهم إن اللي اتحفظ
 * قبل كده مش اسم موديل حقيقي.
 */
export function normalizeCustomModelId(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (isLegacyCustomModelId(value)) {
    throw new Error(BYOK_CUSTOM_MODEL_LEGACY_ERROR_AR);
  }
  if (!value) {
    throw new Error(BYOK_CUSTOM_MODEL_REQUIRED_ERROR_AR);
  }
  if (!isValidCustomModelId(value)) {
    throw new Error(BYOK_CUSTOM_MODEL_INVALID_ERROR_AR);
  }
  return value;
}

export type ByokCapabilityResult =
  | { valid: true }
  | { valid: false; reason: 'missing-text' | 'missing-vision' | 'missing-both'; message: string };

/** F40: الموديل لازم يدعم النص والصور مع بعض. أي نقص بيرجع رسالة عربية واضحة. */
export function validateByokModelCapabilities(model: ByokModelPreset): ByokCapabilityResult {
  const hasText = model.supportsText === true;
  const hasVision = model.supportsVision === true;
  const name = model.labelAr || model.id;

  if (hasText && hasVision) {
    return { valid: true };
  }

  if (!hasText && !hasVision) {
    return {
      valid: false,
      reason: 'missing-both',
      message: `الموديل «${name}» مش بيدعم النص ولا الصور. روايتي محتاج موديل بيقرا الاتنين مع بعض.`,
    };
  }

  if (!hasVision) {
    return {
      valid: false,
      reason: 'missing-vision',
      message: `الموديل «${name}» بيدعم النص بس ومش بيدعم الصور. روايتي محتاج موديل بيقرا النص والصور مع بعض.`,
    };
  }

  return {
    valid: false,
    reason: 'missing-text',
    message: `الموديل «${name}» بيدعم الصور بس ومش بيدعم النص. روايتي محتاج موديل بيقرا النص والصور مع بعض.`,
  };
}

export function assertByokModelCapabilities(model: ByokModelPreset): void {
  const result = validateByokModelCapabilities(model);
  if (!result.valid) {
    throw new Error(result.message);
  }
}

export function getByokModel(modelId: string): ByokModelPreset | null {
  return BYOK_MODEL_PRESETS.find((model) => model.id === modelId) ?? null;
}

export function getByokModelsForProvider(provider: ByokProvider): readonly ByokModelPreset[] {
  return BYOK_MODEL_PRESETS.filter((model) => model.provider === provider);
}

/** أول موديل صالح للمزوّد — بيرجع null لو المزوّد ملوش presets. */
export function getPreferredByokModelId(provider: ByokProvider): string | null {
  const models = getByokModelsForProvider(provider);
  return models[0]?.id ?? null;
}

function sanitizeByokConfig(raw: unknown): ByokConfig {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const provider = isByokProvider(source.provider) ? source.provider : DEFAULT_BYOK_CONFIG.provider;

  const requestedModelId = typeof source.modelId === 'string' ? source.modelId : '';
  let modelId: string;
  if (provider === 'custom') {
    // المزوّد المخصّص بيعتمد على اسم موديل بيكتبه المستخدم. بنقبل أي اسم صالح؛
    // والـ placeholder القديم بيفضل زي ما هو عشان الواجهة تعرض رسالة تحديث واضحة.
    // أي قيمة تانية غير صالحة بتبقى فاضية — مش بنستبدلها بموديل مزوّد تاني.
    modelId = isLegacyCustomModelId(requestedModelId)
      ? LEGACY_CUSTOM_MODEL_ID
      : isValidCustomModelId(requestedModelId)
        ? requestedModelId.trim()
        : '';
  } else {
    const knownModel = getByokModel(requestedModelId);
    modelId =
      knownModel && knownModel.provider === provider
        ? knownModel.id
        : (getPreferredByokModelId(provider) ?? DEFAULT_BYOK_CONFIG.modelId);
  }

  // وضع «السيرفر» مش مفعّل لحد ما `/v1/keys` يتوصل — أي قيمة قديمة بتترجع للوضع المؤقت
  // بدل ما نوعد بحفظ على السيرفر مش موجود.
  const storageMode: ByokStorageMode = 'ephemeral';

  // آخر ٤ حروف بس — مش المفتاح. بنرفض أي قيمة أطول من ٨ حروف أو فيها مسافات
  // عشان مايتخزنش سر عن طريق الخطأ في `kv`.
  const rawLast4 = source.keyLast4;
  const keyLast4 =
    typeof rawLast4 === 'string' && rawLast4.length > 0 && rawLast4.length <= 8 && !/\s/.test(rawLast4)
      ? rawLast4
      : null;

  const hasKey = source.hasKey === true && keyLast4 !== null;
  const updatedAt =
    typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt) ? source.updatedAt : 0;

  // رابط السيرفر المخصّص بيتخزن بس لو HTTPS صالح؛ أي قيمة قديمة/تالفة بتبقى `null`.
  const customBaseUrl = sanitizeCustomBaseUrl(source.customBaseUrl);

  return { provider, modelId, storageMode, keyLast4, hasKey, updatedAt, customBaseUrl };
}

/**
 * آخر ٤ حروف — بترجع `null` لأي قيمة أقصر من `MIN_BYOK_KEY_LENGTH`،
 * عشان مفيش سر قصير يتقطع ويتعرض أو يتخزن.
 */
function lastFour(secret: string): string | null {
  if (secret.length < MIN_BYOK_KEY_LENGTH) return null;
  return secret.slice(-4);
}

function normalizeApiKey(apiKey: string): string {
  return apiKey.trim();
}

function assertStorableApiKey(apiKey: string): string {
  const trimmed = normalizeApiKey(apiKey);
  if (!trimmed) {
    throw new Error('اكتب مفتاح الـ API الأول.');
  }
  if (trimmed.length < MIN_BYOK_KEY_LENGTH) {
    // رسالة ثابتة. مفيش ولا حرف من المفتاح فيها.
    throw new Error(BYOK_KEY_TOO_SHORT_ERROR_AR);
  }
  if (/\s/.test(trimmed)) {
    // رسالة الخطأ نفسها مبتشيلش المفتاح عشان ما يتسربش في أي لوج.
    throw new Error('المفتاح فيه مسافات أو سطور — انسخه من جديد من غير مسافات.');
  }
  return trimmed;
}

export function maskApiKey(apiKey: string | null | undefined): string {
  const trimmed = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!trimmed) return '';

  let prefix = '';
  if (trimmed.startsWith('sk-ant-')) prefix = 'sk-ant-';
  else if (trimmed.startsWith('sk-or-v1-')) prefix = 'sk-or-v1-';
  else if (trimmed.startsWith('sk-proj-')) prefix = 'sk-proj-';
  else if (trimmed.startsWith('sk-')) prefix = 'sk-';
  else if (trimmed.startsWith('AIza')) prefix = 'AIza';

  const tail = lastFour(trimmed);
  // قيمة أقصر من الحد الآمن: بنعرض البادئة بس، من غير أي حرف من السر.
  return tail ? `${prefix}••••${tail}` : `${prefix}••••`;
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-or-v1-[A-Za-z0-9_-]{8,}/g,
  /sk-proj-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9_-]{8,}/g,
  /AIza[0-9A-Za-z_-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

export const REDACTED = '[REDACTED]';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** تشفير/تعمية أي مفتاح أو Bearer token في نص قبل ما يتكتب في أي لوج. */
export function redactSecrets(text: string, extraSecrets?: readonly (string | null | undefined)[]): string {
  let result = text;
  for (const secret of extraSecrets ?? []) {
    const trimmed = typeof secret === 'string' ? secret.trim() : '';
    if (!trimmed) continue;
    result = result.replace(new RegExp(escapeRegExp(trimmed), 'g'), REDACTED);
  }
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

export type SanitizedError = {
  name: string;
  message: string;
  stack?: string;
};

/** نسخة آمنة من أي error تتكتب في اللوج — المفتاح الخام مستحيل يظهر فيها. */
export function sanitizeErrorForLog(err: unknown, knownKey?: string | null): SanitizedError {
  const secrets = knownKey ? [knownKey] : [];
  if (err instanceof Error) {
    const sanitized: SanitizedError = {
      name: redactSecrets(err.name, secrets),
      message: redactSecrets(err.message, secrets),
    };
    if (typeof err.stack === 'string') {
      sanitized.stack = redactSecrets(err.stack, secrets);
    }
    return sanitized;
  }

  return {
    name: 'UnknownError',
    message: redactSecrets(typeof err === 'string' ? err : String(err), secrets),
  };
}

export type ByokKeyTransport = 'ephemeral-header' | 'server-vault';

export type ByokRequestEnvelope = {
  headers: Record<string, string>;
  metadata: {
    storageMode: ByokStorageMode;
    keyTransport: ByokKeyTransport;
    keyLast4: string | null;
  };
};

/**
 * هيدرز آمنة للـ backend. مفيش أي لوج هنا — ولا حتى عند الفشل.
 * - ephemeral: المفتاح بيتبعت مؤقت في هيدر مخصص لكل طلب.
 * - server-saved: مفيش مفتاح خام في الهيدر، السيرفر بيستخدم المفتاح المشفّر المحفوظ.
 */
export function buildSafeRequestHeaders(
  apiKey: string | null | undefined,
  mode: ByokStorageMode,
): ByokRequestEnvelope {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';

  if (mode === 'server-saved') {
    return {
      headers: { 'x-byok-storage-mode': 'server-saved' },
      metadata: {
        storageMode: 'server-saved',
        keyTransport: 'server-vault',
        keyLast4: key ? lastFour(key) : null,
      },
    };
  }

  if (!key) {
    throw new Error('مفيش مفتاح متاح للطلب المؤقت. احفظ المفتاح الأول.');
  }
  if (/\s/.test(key)) {
    throw new Error('المفتاح فيه مسافات أو سطور مش مسموحة في الطلب.');
  }

  return {
    headers: {
      'x-byok-storage-mode': 'ephemeral',
      'x-byok-api-key': key,
    },
    metadata: {
      storageMode: 'ephemeral',
      keyTransport: 'ephemeral-header',
      keyLast4: lastFour(key),
    },
  };
}

type StoredSecret = { key: string | null; invalid: boolean };

/**
 * قراءة آمنة لمفتاح مزوّد واحد. أي خطأ من `expo-secure-store` بيتحوّل لرسالة
 * ثابتة — نص الخطأ الأصلي (اللي ممكن يحتوي السر) مبيخرجش من هنا أبداً.
 */
async function readStoredSecret(
  provider: ByokProvider,
  adapter: ByokSecureStoreAdapter,
): Promise<StoredSecret> {
  let raw: string | null;
  try {
    raw = await adapter.getItemAsync(getByokSecretEntryKey(provider));
  } catch {
    throw new Error(BYOK_SECURE_STORE_READ_ERROR_AR);
  }

  if (!raw) return { key: null, invalid: false };

  const trimmed = raw.trim();
  if (trimmed.length < MIN_BYOK_KEY_LENGTH) {
    // قيمة قصيرة/تالفة: مبنستخدمهاش ومبنعرضش آخر حروفها.
    return { key: null, invalid: true };
  }
  return { key: trimmed, invalid: false };
}

async function writeStoredSecret(
  provider: ByokProvider,
  apiKey: string,
  adapter: ByokSecureStoreAdapter,
): Promise<void> {
  try {
    await adapter.setItemAsync(getByokSecretEntryKey(provider), apiKey);
  } catch {
    throw new Error(BYOK_SECURE_STORE_SAVE_ERROR_AR);
  }
}

async function deleteStoredSecret(
  provider: ByokProvider,
  adapter: ByokSecureStoreAdapter,
): Promise<void> {
  try {
    await adapter.deleteItemAsync(getByokSecretEntryKey(provider));
  } catch {
    throw new Error(BYOK_SECURE_STORE_DELETE_ERROR_AR);
  }
}

/** حذف «أفضل محاولة» للقيمة التالفة — فشل الحذف مبيوقفش التحميل. */
async function deleteInvalidSecretBestEffort(
  provider: ByokProvider,
  adapter: ByokSecureStoreAdapter,
): Promise<void> {
  try {
    await adapter.deleteItemAsync(getByokSecretEntryKey(provider));
  } catch {
    // مفيش أي إفصاح عن نص الخطأ هنا.
  }
}

export async function loadByokConfig(
  db?: DatabaseAdapter,
  adapter: ByokSecureStoreAdapter = expoSecureStoreAdapter,
): Promise<ByokConfig> {
  const stored = sanitizeByokConfig(await getKv<Partial<ByokConfig> | null>(BYOK_KV_KEY, null, db));
  const provider = stored.provider;

  const secret = await readStoredSecret(provider, adapter);
  if (secret.invalid) {
    await deleteInvalidSecretBestEffort(provider, adapter);
  }

  if (secret.key) {
    const keyLast4 = lastFour(secret.key);
    if (!stored.hasKey || stored.keyLast4 !== keyLast4) {
      const repaired: ByokConfig = { ...stored, hasKey: true, keyLast4 };
      await setKv(BYOK_KV_KEY, repaired, db);
      return repaired;
    }
    return stored;
  }

  if (stored.hasKey || stored.keyLast4 !== null) {
    const cleared: ByokConfig = { ...stored, hasKey: false, keyLast4: null };
    await setKv(BYOK_KV_KEY, cleared, db);
    return cleared;
  }

  return stored;
}

/**
 * بيقرا المفتاح الخام لمزوّد معيّن للاستخدام في الطلب — ممنوع يتكتب في أي لوج أو `kv`.
 * مفتاح أقصر من `MIN_BYOK_KEY_LENGTH` بيترجع `null` (قيمة غير صالحة).
 */
export async function readByokSecret(
  provider: ByokProvider,
  adapter: ByokSecureStoreAdapter = expoSecureStoreAdapter,
): Promise<string | null> {
  const secret = await readStoredSecret(provider, adapter);
  return secret.key;
}

/**
 * بيقرا المفتاح الخام للمزوّد النشط افتراضياً — ممنوع يتكتب في أي لوج أو `kv`.
 */
export async function readByokApiKey(
  adapter: ByokSecureStoreAdapter = expoSecureStoreAdapter,
  provider: ByokProvider = DEFAULT_BYOK_CONFIG.provider,
): Promise<string | null> {
  return readByokSecret(provider, adapter);
}

export type SaveByokKeyInput = {
  apiKey: string;
  provider?: ByokProvider;
  modelId?: string;
  storageMode?: ByokStorageMode;
  /** `base_url` للمزوّد المخصّص — لازم HTTPS صالح لو اتبعت. */
  customBaseUrl?: string | null;
  now?: number;
};

/**
 * رابط السيرفر بعد التعديل: القيمة المرسلة لو موجودة، وإلا القيمة المحفوظة.
 * الرابط الغلط بيرمي من غير ما يلمس SecureStore أو `kv`.
 */
function resolveCustomBaseUrl(
  provided: string | null | undefined,
  current: ByokConfig,
): string | null {
  if (provided === undefined) return current.customBaseUrl ?? null;
  if (provided === null) return null;
  return validateHttpsBaseUrl(provided);
}

/**
 * بيحفظ المفتاح الخام في SecureStore، وبيكتب الإعدادات غير السرية في `kv`.
 * الإرجاع `ByokConfig` مش فيه ولا حرف من المفتاح غير آخر ٤ حروف.
 */
export async function saveByokKey(
  input: SaveByokKeyInput,
  db?: DatabaseAdapter,
  adapter: ByokSecureStoreAdapter = expoSecureStoreAdapter,
): Promise<ByokConfig> {
  // التحقق (بما فيه الحد الأدنى للطول) قبل أي كتابة على SecureStore أو `kv`.
  const apiKey = assertStorableApiKey(input.apiKey);
  if (input.storageMode === 'server-saved') {
    throw new Error(BYOK_SERVER_MODE_UNAVAILABLE_AR);
  }

  const current = await loadByokConfig(db, adapter);
  const provider = input.provider ?? current.provider;
  if (!isByokProvider(provider)) {
    throw new Error('المزوّد المختار مش مدعوم.');
  }

  const requestedModelId = input.modelId ?? (provider === current.provider ? current.modelId : null);
  const storageMode: ByokStorageMode = 'ephemeral';

  let modelId: string;
  let customBaseUrl: string | null = null;
  if (provider === 'custom') {
    // Why (review finding): مفتاح مخصّص من غير `base_url` عمره ما ينجح — بنرفض الحفظ
    // برسالة عربية واضحة بدل ما نخزّن مفتاح بحالة ناقصة.
    customBaseUrl = resolveCustomBaseUrl(input.customBaseUrl, current);
    if (!customBaseUrl) {
      throw new Error(BYOK_CUSTOM_BASE_URL_REQUIRED_ERROR_AR);
    }
    // اسم الموديل الحقيقي إلزامي — الـ placeholder القديم بيترفض برسالة تحديث واضحة.
    modelId = normalizeCustomModelId(requestedModelId);
  } else {
    let model = requestedModelId ? getByokModel(requestedModelId) : null;
    if (!model || model.provider !== provider) {
      const fallbackId = getPreferredByokModelId(provider);
      model = fallbackId ? getByokModel(fallbackId) : null;
    }
    if (!model) {
      throw new Error('المزوّد ده مش ليه موديلات جاهزة. اختار مزوّد تاني.');
    }
    assertByokModelCapabilities(model);
    modelId = model.id;
    // التحقق من رابط السيرفر قبل أي كتابة — رابط غلط ميسيبش مفتاح محفوظ بحالة ناقصة.
    customBaseUrl = resolveCustomBaseUrl(input.customBaseUrl, current);
  }

  // المفتاح بيتكتب في مدخل المزوّد نفسه فقط — مفاتيح المزوّدين التانيين مش بتتأثر.
  await writeStoredSecret(provider, apiKey, adapter);

  const config: ByokConfig = {
    provider,
    modelId,
    storageMode,
    keyLast4: lastFour(apiKey),
    hasKey: true,
    updatedAt: input.now ?? Date.now(),
    customBaseUrl,
  };
  // `config` مفيهوش المفتاح — بس آخر ٤ حروف.
  await setKv(BYOK_KV_KEY, config, db);
  return config;
}

export type SaveByokPreferencesInput = {
  provider?: ByokProvider;
  modelId?: string;
  storageMode?: ByokStorageMode;
  /** `base_url` للمزوّد المخصّص — لازم HTTPS صالح لو اتبعت. */
  customBaseUrl?: string | null;
  now?: number;
};

/** بيحفظ اختيارات المستخدم غير السرية، مع فرض شرط «نص + صور» على أي موديل جديد. */
export async function saveByokPreferences(
  input: SaveByokPreferencesInput,
  db?: DatabaseAdapter,
  adapter: ByokSecureStoreAdapter = expoSecureStoreAdapter,
): Promise<ByokConfig> {
  if (input.storageMode === 'server-saved') {
    throw new Error(BYOK_SERVER_MODE_UNAVAILABLE_AR);
  }

  const current = await loadByokConfig(db, adapter);
  const provider = input.provider ?? current.provider;
  if (!isByokProvider(provider)) {
    throw new Error('المزوّد المختار مش مدعوم.');
  }

  let modelId = current.modelId;
  if (input.modelId !== undefined) {
    if (provider === 'custom') {
      // المزوّد المخصّص بيقبل أي اسم موديل حقيقي يكتبه المستخدم (مش لازم يكون من القايمة).
      modelId = normalizeCustomModelId(input.modelId);
    } else {
      const requested = getByokModel(input.modelId);
      if (!requested || requested.provider !== provider) {
        throw new Error('الموديل المختار مش تابع للمزوّد ده.');
      }
      assertByokModelCapabilities(requested);
      modelId = requested.id;
    }
  } else if (input.provider !== undefined && provider !== current.provider) {
    if (provider === 'custom') {
      // موديل المزوّد القديم مش صالح للـ gateway المخصّص — المستخدم بيكتب اسمه بنفسه.
      modelId = '';
    } else {
      // موديل المزوّد القديم مش صالح للمزوّد الجديد — نختار أول موديل صالح.
      const fallbackId = getPreferredByokModelId(provider);
      if (!fallbackId) {
        throw new Error('المزوّد ده مش ليه موديلات جاهزة. اختار مزوّد تاني.');
      }
      const fallback = getByokModel(fallbackId);
      if (!fallback) {
        throw new Error('المزوّد ده مش ليه موديلات جاهزة. اختار مزوّد تاني.');
      }
      assertByokModelCapabilities(fallback);
      modelId = fallback.id;
    }
  }

  // `hasKey` و`keyLast4` بيتحسبوا من مدخل المزوّد النشط نفسه فقط —
  // مفيش وراثة من المزوّد اللي كنا عليه.
  const secret = await readStoredSecret(provider, adapter);
  if (secret.invalid) {
    await deleteInvalidSecretBestEffort(provider, adapter);
  }
  const keyLast4 = secret.key ? lastFour(secret.key) : null;
  const customBaseUrl = resolveCustomBaseUrl(input.customBaseUrl, current);

  const next: ByokConfig = {
    provider,
    modelId,
    storageMode: 'ephemeral',
    keyLast4,
    hasKey: secret.key !== null,
    updatedAt: input.now ?? current.updatedAt,
    customBaseUrl,
  };
  await setKv(BYOK_KV_KEY, next, db);
  return next;
}

export async function clearByokKey(
  db?: DatabaseAdapter,
  adapter: ByokSecureStoreAdapter = expoSecureStoreAdapter,
  now: number = Date.now(),
): Promise<ByokConfig> {
  const current = await loadByokConfig(db, adapter);
  const provider = current.provider;
  // حذف مفتاح المزوّد النشط بس — مفاتيح المزوّدين التانيين بتفضل زي ما هي.
  await deleteStoredSecret(provider, adapter);
  const next: ByokConfig = {
    ...current,
    keyLast4: null,
    hasKey: false,
    updatedAt: now,
  };
  await setKv(BYOK_KV_KEY, next, db);
  return next;
}

/**
 * الرسائل اللي مسموح تظهر في الواجهة. أي نص تاني (خصوصاً نص خطأ من
 * `expo-secure-store` اللي ممكن يكون فيه سر) بيتبدّل برسالة ثابتة.
 */
const SAFE_BYOK_ERROR_MESSAGES: ReadonlySet<string> = new Set<string>([
  'اكتب مفتاح الـ API الأول.',
  'المفتاح فيه مسافات أو سطور — انسخه من جديد من غير مسافات.',
  'المزوّد المختار مش مدعوم.',
  'المزوّد ده مش ليه موديلات جاهزة. اختار مزوّد تاني.',
  'الموديل المختار مش تابع للمزوّد ده.',
  'مفيش مفتاح متاح للطلب المؤقت. احفظ المفتاح الأول.',
  'المفتاح فيه مسافات أو سطور مش مسموحة في الطلب.',
  BYOK_CUSTOM_BASE_URL_ERROR_AR,
  BYOK_CUSTOM_BASE_URL_REQUIRED_ERROR_AR,
  BYOK_CUSTOM_MODEL_REQUIRED_ERROR_AR,
  BYOK_CUSTOM_MODEL_LEGACY_ERROR_AR,
  BYOK_CUSTOM_MODEL_INVALID_ERROR_AR,
  BYOK_KEY_TOO_SHORT_ERROR_AR,
  BYOK_SERVER_MODE_UNAVAILABLE_AR,
  BYOK_SECURE_STORE_SAVE_ERROR_AR,
  BYOK_SECURE_STORE_READ_ERROR_AR,
  BYOK_SECURE_STORE_DELETE_ERROR_AR,
]);

/** بيحوّل أي خطأ لرسالة واجهة ثابتة وآمنة — ممنوع يمرر نص الخطأ الأصلي. */
export function toSafeByokErrorMessage(err: unknown): string {
  if (err instanceof Error && SAFE_BYOK_ERROR_MESSAGES.has(err.message)) {
    return err.message;
  }
  // نص ثابت موجود في القايمة أعلاه — من غير أي تفاصيل من الخطأ الأصلي.
  return BYOK_UNKNOWN_ERROR_AR;
}

export function getByokStatusLabel(config: ByokConfig | null | undefined): string {
  if (!config || !config.hasKey) return BYOK_EMPTY_MESSAGE_AR;
  if (!config.keyLast4) return BYOK_SAVED_MESSAGE_AR;
  return `مفتاح محفوظ ••••${config.keyLast4}`;
}
