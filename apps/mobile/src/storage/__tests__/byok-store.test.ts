import {
  BYOK_CUSTOM_BASE_URL_ERROR_AR,
  BYOK_DELETED_MESSAGE_AR,
  BYOK_KEY_TOO_SHORT_ERROR_AR,
  BYOK_KV_KEY,
  BYOK_SECURE_STORE_DELETE_ERROR_AR,
  BYOK_SECURE_STORE_READ_ERROR_AR,
  BYOK_SECURE_STORE_SAVE_ERROR_AR,
  BYOK_SECRET_ENTRY,
  BYOK_SERVER_MODE_UNAVAILABLE_AR,
  BYOK_UNKNOWN_ERROR_AR,
  DEFAULT_BYOK_CONFIG,
  MIN_BYOK_KEY_LENGTH,
  assertByokModelCapabilities,
  buildSafeRequestHeaders,
  clearByokKey,
  getByokModel,
  getByokModelsForProvider,
  getByokSecretEntryKey,
  getByokStatusLabel,
  loadByokConfig,
  maskApiKey,
  readByokApiKey,
  readByokSecret,
  redactSecrets,
  sanitizeCustomBaseUrl,
  sanitizeErrorForLog,
  saveByokKey,
  saveByokPreferences,
  toSafeByokErrorMessage,
  validateByokModelCapabilities,
  validateHttpsBaseUrl,
  type ByokModelPreset,
  type ByokSecureStoreAdapter,
} from '@/storage/byok-store';
import type { DatabaseAdapter } from '@/storage/database';

import * as database from '@/storage/database';

jest.setTimeout(90_000);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const OPENAI_KEY = 'sk-proj-' + 'test-only-openai-1234';
const ANTHROPIC_KEY = 'sk-ant-api03-ZyXwVuTsRqPoNmLk9876';
const GOOGLE_KEY = 'AIza' + 'test-only-google-abcdefghijkl';
const OPENROUTER_KEY = 'sk-or-v1-' + 'test-only-openrouter-9876';

function createKvTestDb() {
  const kv = new Map<string, string>();
  const db: DatabaseAdapter = {
    async execAsync() {},
    async runAsync(source: string, ...params: unknown[]) {
      if (source.includes('INSERT INTO kv')) {
        const [key, value] = params as [string, string];
        kv.set(key, value);
        return { changes: 1 };
      }
      return { changes: 0 };
    },
    async getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null> {
      if (source.includes('FROM kv')) {
        const [key] = params as [string];
        const value = kv.get(key);
        return value !== undefined ? ({ value } as T) : null;
      }
      return null;
    },
    async getAllAsync<T>(): Promise<T[]> {
      return [];
    },
  };
  return { db, kv };
}

function createSecureStore() {
  const entries = new Map<string, string>();
  const adapter: ByokSecureStoreAdapter = {
    getItemAsync: jest.fn(async (key: string) => entries.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      entries.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      entries.delete(key);
    }),
  };
  return { adapter, entries };
}

function consoleArgs(spies: jest.SpyInstance[]): string[] {
  const seen: string[] = [];
  for (const spy of spies) {
    for (const call of spy.mock.calls) {
      for (const arg of call) {
        if (typeof arg === 'string') {
          seen.push(arg);
        } else {
          try {
            seen.push(JSON.stringify(arg));
          } catch {
            seen.push(String(arg));
          }
        }
      }
    }
  }
  return seen;
}

describe('byok-store — التخزين الآمن للمفتاح', () => {
  let db: DatabaseAdapter;
  let kv: Map<string, string>;
  let adapter: ByokSecureStoreAdapter;
  let entries: Map<string, string>;

  beforeEach(() => {
    const dbHarness = createKvTestDb();
    db = dbHarness.db;
    kv = dbHarness.kv;
    const secureHarness = createSecureStore();
    adapter = secureHarness.adapter;
    entries = secureHarness.entries;
  });

  it('defaults to ephemeral mode with no key and a vision-capable model', () => {
    expect(DEFAULT_BYOK_CONFIG.storageMode).toBe('ephemeral');
    expect(DEFAULT_BYOK_CONFIG.hasKey).toBe(false);
    const model = getByokModel(DEFAULT_BYOK_CONFIG.modelId);
    expect(model).not.toBeNull();
    expect(model?.supportsText).toBe(true);
    expect(model?.supportsVision).toBe(true);
  });

  it('stores the raw key ONLY in SecureStore — never in the SQLite kv table', async () => {
    const runAsyncSpy = jest.spyOn(db, 'runAsync');

    const config = await saveByokKey(
      { apiKey: OPENAI_KEY, provider: 'openai', modelId: 'gpt-4.1', now: 1_700_000_000_000 },
      db,
      adapter,
    );

    // SecureStore got the raw key exactly, in the provider-scoped entry.
    expect(adapter.setItemAsync).toHaveBeenCalledWith(getByokSecretEntryKey('openai'), OPENAI_KEY);
    expect(entries.get(getByokSecretEntryKey('openai'))).toBe(OPENAI_KEY);

    // The returned config carries no raw key at all.
    expect(config.hasKey).toBe(true);
    expect(config.keyLast4).toBe('1234');
    expect(config.updatedAt).toBe(1_700_000_000_000);
    expect(JSON.stringify(config)).not.toContain(OPENAI_KEY);
    expect((config as Record<string, unknown>).apiKey).toBeUndefined();

    // Nothing that reached setKv/runAsync ever contained the raw key.
    const everyParam = JSON.stringify(runAsyncSpy.mock.calls);
    expect(everyParam).not.toContain(OPENAI_KEY);
    expect(JSON.stringify([...kv.entries()])).not.toContain(OPENAI_KEY);

    // The persisted kv row is non-secret only.
    const rawRow = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM kv WHERE key = ?',
      BYOK_KV_KEY,
    );
    expect(rawRow).not.toBeNull();
    const parsed = JSON.parse(rawRow!.value) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      provider: 'openai',
      modelId: 'gpt-4.1',
      storageMode: 'ephemeral',
      keyLast4: '1234',
      hasKey: true,
    });
    expect(Object.keys(parsed).sort()).toEqual(
      ['customBaseUrl', 'hasKey', 'keyLast4', 'modelId', 'provider', 'storageMode', 'updatedAt'].sort(),
    );
    expect(parsed.customBaseUrl).toBeNull();
  });

  it('rejects the server-saved mode and keeps ephemeral as the only active mode', async () => {
    await saveByokPreferences({ storageMode: 'ephemeral', now: 10 }, db, adapter);
    expect((await loadByokConfig(db, adapter)).storageMode).toBe('ephemeral');

    // مفيش وعد بحفظ على السيرفر قبل ما `/v1/keys` يتوصل.
    await expect(
      saveByokPreferences({ storageMode: 'server-saved', now: 11 }, db, adapter),
    ).rejects.toThrow(BYOK_SERVER_MODE_UNAVAILABLE_AR);

    const reloaded = await loadByokConfig(db, adapter);
    expect(reloaded.storageMode).toBe('ephemeral');
    expect(JSON.stringify([...kv.entries()])).not.toContain('apiKey');
    expect(JSON.parse(kv.get(BYOK_KV_KEY)!).storageMode).toBe('ephemeral');
  });

  it('normalizes a legacy stored server-saved mode to ephemeral on load', async () => {
    await db.runAsync(
      'INSERT INTO kv (key, value) VALUES (?, ?)',
      BYOK_KV_KEY,
      JSON.stringify({ ...DEFAULT_BYOK_CONFIG, storageMode: 'server-saved' }),
    );

    const loaded = await loadByokConfig(db, adapter);
    expect(loaded.storageMode).toBe('ephemeral');
  });

  it('never passes the raw key to setKv (the kv writer)', async () => {
    const setKvSpy = jest.spyOn(database, 'setKv');
    try {
      const config = await saveByokKey(
        { apiKey: OPENROUTER_KEY, provider: 'openrouter' },
        db,
        adapter,
      );
      expect(setKvSpy).toHaveBeenCalled();
      for (const call of setKvSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(OPENROUTER_KEY);
      }
      expect(JSON.stringify(config)).not.toContain(OPENROUTER_KEY);
    } finally {
      setKvSpy.mockRestore();
    }
  });

  it('reads the raw key back only through the secure reader', async () => {
    await saveByokKey({ apiKey: ANTHROPIC_KEY, provider: 'anthropic' }, db, adapter);
    await expect(readByokApiKey(adapter, 'anthropic')).resolves.toBe(ANTHROPIC_KEY);
    await expect(readByokSecret('anthropic', adapter)).resolves.toBe(ANTHROPIC_KEY);
    // مزوّد تاني ملهوش مفتاح — مفيش وراثة.
    await expect(readByokSecret('openai', adapter)).resolves.toBeNull();
  });

  it('deletes the key from SecureStore and clears the non-secret status', async () => {
    await saveByokKey({ apiKey: GOOGLE_KEY, provider: 'google' }, db, adapter);

    const cleared = await clearByokKey(db, adapter, 4242);

    expect(adapter.deleteItemAsync).toHaveBeenCalledWith(getByokSecretEntryKey('google'));
    expect(entries.has(getByokSecretEntryKey('google'))).toBe(false);
    expect(cleared.hasKey).toBe(false);
    expect(cleared.keyLast4).toBeNull();
    expect(cleared.updatedAt).toBe(4242);
    expect(await readByokApiKey(adapter, 'google')).toBeNull();

    const reloaded = await loadByokConfig(db, adapter);
    expect(reloaded.hasKey).toBe(false);
    expect(reloaded.keyLast4).toBeNull();
    expect(getByokStatusLabel(reloaded)).toBe('مفيش مفتاح محفوظ على الجهاز.');
    expect(getByokStatusLabel(cleared)).toContain('مفيش مفتاح');
    expect(BYOK_DELETED_MESSAGE_AR).toContain('اتحذف');
  });

  it('repairs hasKey when SecureStore and kv disagree', async () => {
    // kv says a key exists but storage was wiped → status must not lie.
    await db.runAsync(
      'INSERT INTO kv (key, value) VALUES (?, ?)',
      BYOK_KV_KEY,
      JSON.stringify({ ...DEFAULT_BYOK_CONFIG, hasKey: true, keyLast4: '9999' }),
    );
    const repaired = await loadByokConfig(db, adapter);
    expect(repaired.hasKey).toBe(false);
    expect(repaired.keyLast4).toBeNull();

    // SecureStore has a key but kv does not know about it → recover the last4 only.
    await adapter.setItemAsync(getByokSecretEntryKey('openai'), OPENROUTER_KEY);
    const recovered = await loadByokConfig(db, adapter);
    expect(recovered.hasKey).toBe(true);
    expect(recovered.keyLast4).toBe('9876');
    expect(JSON.stringify([...kv.entries()])).not.toContain(OPENROUTER_KEY);
  });

  it('rejects a key with whitespace/newlines and never echoes it in the error', async () => {
    const leaked = `${OPENAI_KEY}\nInjected-Header: yes`;
    await expect(saveByokKey({ apiKey: leaked }, db, adapter)).rejects.toThrow(/مسافات/);

    let caught: unknown;
    try {
      await saveByokKey({ apiKey: leaked }, db, adapter);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).not.toContain(OPENAI_KEY);
    expect(sanitizeErrorForLog(caught, leaked).message).not.toContain(OPENAI_KEY);
    expect(sanitizeErrorForLog(caught, leaked).message).not.toContain('Injected-Header');

    // Nothing was written anywhere for this attempt.
    expect(entries.has(getByokSecretEntryKey('openai'))).toBe(false);
    expect(JSON.stringify([...kv.entries()])).not.toContain(OPENAI_KEY);
  });

  it('rejects an empty key', async () => {
    await expect(saveByokKey({ apiKey: '   ' }, db, adapter)).rejects.toThrow(/اكتب مفتاح/);
    expect(adapter.setItemAsync).not.toHaveBeenCalled();
  });

  it('switches provider and falls back to a vision-capable model of that provider', async () => {
    await saveByokKey({ apiKey: OPENAI_KEY, provider: 'openai', modelId: 'gpt-4.1' }, db, adapter);
    const next = await saveByokPreferences({ provider: 'google' }, db, adapter);
    expect(next.provider).toBe('google');
    expect(getByokModelsForProvider('google').some((model) => model.id === next.modelId)).toBe(true);
    expect(getByokModel(next.modelId)?.supportsVision).toBe(true);
  });
});

describe('byok-store — الفحص والتفقيط', () => {
  it('validateByokModelCapabilities accepts text+vision and rejects text-only', () => {
    const both = getByokModel('gemini-2.5-pro')!;
    expect(validateByokModelCapabilities(both)).toEqual({ valid: true });

    const textOnly: ByokModelPreset = {
      id: 'text-only-model',
      labelAr: 'موديل نصي',
      provider: 'custom',
      supportsText: true,
      supportsVision: false,
    };
    const result = validateByokModelCapabilities(textOnly);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('missing-vision');
      expect(result.message).toContain('صور');
    }
    expect(() => assertByokModelCapabilities(textOnly)).toThrow(/صور/);

    const visionOnly: ByokModelPreset = { ...textOnly, supportsText: false, supportsVision: true };
    const visionOnlyResult = validateByokModelCapabilities(visionOnly);
    expect(visionOnlyResult.valid).toBe(false);
    if (!visionOnlyResult.valid) expect(visionOnlyResult.reason).toBe('missing-text');

    const neither: ByokModelPreset = { ...textOnly, supportsText: false };
    const neitherResult = validateByokModelCapabilities(neither);
    expect(neitherResult.valid).toBe(false);
    if (!neitherResult.valid) expect(neitherResult.reason).toBe('missing-both');
  });

  it('every curated preset supports text AND vision (F40)', () => {
    for (const model of [
      ...getByokModelsForProvider('openai'),
      ...getByokModelsForProvider('anthropic'),
      ...getByokModelsForProvider('google'),
      ...getByokModelsForProvider('openrouter'),
      ...getByokModelsForProvider('custom'),
    ]) {
      expect(model.supportsText && model.supportsVision).toBe(true);
      expect(validateByokModelCapabilities(model)).toEqual({ valid: true });
    }
  });

  it('maskApiKey formats OpenAI, Anthropic, Google and OpenRouter keys', () => {
    expect(maskApiKey(OPENAI_KEY)).toBe('sk-proj-••••1234');
    expect(maskApiKey('sk-AbCdEfGhIjKlMn1234')).toBe('sk-••••1234');
    expect(maskApiKey(ANTHROPIC_KEY)).toBe('sk-ant-••••9876');
    expect(maskApiKey(GOOGLE_KEY)).toBe('AIza••••ijkl');
    expect(maskApiKey(OPENROUTER_KEY)).toBe('sk-or-v1-••••9876');
    // قيمة قصيرة: بادئة وبس، مفيش أي حرف من السر.
    expect(maskApiKey('abc1234')).toBe('••••');
    expect(maskApiKey('sk-short')).toBe('sk-••••');
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey(null)).toBe('');
    for (const key of [OPENAI_KEY, ANTHROPIC_KEY, GOOGLE_KEY, OPENROUTER_KEY]) {
      expect(maskApiKey(key)).not.toContain(key);
    }
  });

  it('redactSecrets removes common key formats, Bearer tokens and supplied secrets', () => {
    const text = [
      `openai=${OPENAI_KEY}`,
      `anthropic=${ANTHROPIC_KEY}`,
      `google=${GOOGLE_KEY}`,
      `openrouter=${OPENROUTER_KEY}`,
      'Authorization: Bearer abcdef1234567890',
      'my-custom-secret-value',
    ].join(' | ');

    const redacted = redactSecrets(text, ['my-custom-secret-value']);
    for (const secret of [OPENAI_KEY, ANTHROPIC_KEY, GOOGLE_KEY, OPENROUTER_KEY, 'abcdef1234567890']) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).not.toContain('my-custom-secret-value');
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).not.toContain('sk-');
    expect(redacted).not.toContain('AIza');
    expect(redacted).not.toContain('Bearer ');
  });

  it('sanitizeErrorForLog never leaks the raw key in name/message/stack', () => {
    const err = new Error(`provider rejected key ${ANTHROPIC_KEY}`);
    err.name = 'ByokError';
    const sanitized = sanitizeErrorForLog(err, ANTHROPIC_KEY);
    expect(sanitized.message).toContain('[REDACTED]');
    expect(JSON.stringify(sanitized)).not.toContain(ANTHROPIC_KEY);

    const unknown = sanitizeErrorForLog(`raw failure ${GOOGLE_KEY}`);
    expect(unknown.message).not.toContain(GOOGLE_KEY);
    expect(unknown.name).toBe('UnknownError');
  });

  it('buildSafeRequestHeaders sends the key only in ephemeral mode', () => {
    const ephemeral = buildSafeRequestHeaders(OPENROUTER_KEY, 'ephemeral');
    expect(ephemeral.headers['x-byok-api-key']).toBe(OPENROUTER_KEY);
    expect(ephemeral.headers['x-byok-storage-mode']).toBe('ephemeral');
    expect(ephemeral.metadata.keyTransport).toBe('ephemeral-header');
    expect(ephemeral.metadata.keyLast4).toBe('9876');

    const serverSaved = buildSafeRequestHeaders(OPENROUTER_KEY, 'server-saved');
    expect(JSON.stringify(serverSaved)).not.toContain(OPENROUTER_KEY);
    expect(serverSaved.headers['x-byok-api-key']).toBeUndefined();
    expect(serverSaved.metadata.keyTransport).toBe('server-vault');

    expect(() => buildSafeRequestHeaders('', 'ephemeral')).toThrow(/مفتاح/);
  });

  it('never writes the raw key to console across save/load/error/delete', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    try {
      const { db: lifecycleDb } = createKvTestDb();
      const lifecycle = createSecureStore();

      const saved = await saveByokKey(
        { apiKey: ANTHROPIC_KEY, provider: 'anthropic', storageMode: 'ephemeral' },
        lifecycleDb,
        lifecycle.adapter,
      );
      await readByokApiKey(lifecycle.adapter, 'anthropic');
      await loadByokConfig(lifecycleDb, lifecycle.adapter);
      buildSafeRequestHeaders(ANTHROPIC_KEY, 'ephemeral');
      sanitizeErrorForLog(new Error(`boom ${ANTHROPIC_KEY}`), ANTHROPIC_KEY);
      try {
        await saveByokKey({ apiKey: `${OPENAI_KEY}\nbad` }, lifecycleDb, lifecycle.adapter);
      } catch {
        // expected
      }
      await clearByokKey(lifecycleDb, lifecycle.adapter);

      expect(saved.hasKey).toBe(true);
      const all = consoleArgs([logSpy, warnSpy, errorSpy, infoSpy]);
      for (const entry of all) {
        expect(entry).not.toContain(ANTHROPIC_KEY);
        expect(entry).not.toContain(OPENAI_KEY);
      }
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });
});

const WEIRD_RAW_SECRET = 'test-only payload ' + '9911223344556677';

/** بيتأكد إن مفيش أي جزء (٨ حروف) من السر ظهر في أي نص. */
function expectNoSecretChars(secret: string, texts: readonly string[]): void {
  const windows: string[] = [];
  if (secret.length <= 8) {
    windows.push(secret);
  } else {
    for (let i = 0; i + 8 <= secret.length; i += 1) {
      windows.push(secret.slice(i, i + 8));
    }
  }
  expect(windows.length).toBeGreaterThan(0);
  for (const text of texts) {
    for (const window of windows) {
      expect(text).not.toContain(window);
    }
  }
}

function createThrowingSecureStore(which: 'save' | 'read' | 'delete') {
  const adapter: ByokSecureStoreAdapter = {
    getItemAsync: jest.fn(async () => {
      if (which === 'read') throw new Error(`Keystore read failed for payload <<${WEIRD_RAW_SECRET}>>`);
      return null;
    }),
    setItemAsync: jest.fn(async () => {
      if (which === 'save') throw new Error(`Keystore write failed for payload <<${WEIRD_RAW_SECRET}>>`);
    }),
    deleteItemAsync: jest.fn(async () => {
      if (which === 'delete') throw new Error(`Keystore delete failed for payload <<${WEIRD_RAW_SECRET}>>`);
    }),
  };
  return adapter;
}

describe('byok-store — إصلاحات مراجعة Codex على PR #33', () => {
  let db: DatabaseAdapter;
  let kv: Map<string, string>;
  let adapter: ByokSecureStoreAdapter;
  let entries: Map<string, string>;

  beforeEach(() => {
    const dbHarness = createKvTestDb();
    db = dbHarness.db;
    kv = dbHarness.kv;
    const secureHarness = createSecureStore();
    adapter = secureHarness.adapter;
    entries = secureHarness.entries;
  });

  describe('Fix 1 — «احفظ مفتاحي على السيرفر» مش مفعّل', () => {
    it('rejects the server-saved mode in saveByokKey without writing anything', async () => {
      await expect(
        saveByokKey({ apiKey: OPENAI_KEY, storageMode: 'server-saved' }, db, adapter),
      ).rejects.toThrow(BYOK_SERVER_MODE_UNAVAILABLE_AR);

      expect(adapter.setItemAsync).not.toHaveBeenCalled();
      expect(entries.size).toBe(0);
      expect(kv.size).toBe(0);
    });

    it('rejects the server-saved mode in saveByokPreferences and keeps ephemeral', async () => {
      await expect(
        saveByokPreferences({ storageMode: 'server-saved' }, db, adapter),
      ).rejects.toThrow(BYOK_SERVER_MODE_UNAVAILABLE_AR);

      expect(kv.size).toBe(0);
      expect((await loadByokConfig(db, adapter)).storageMode).toBe('ephemeral');
    });

    it('normalizes any legacy server-saved value read from kv to ephemeral', async () => {
      await db.runAsync(
        'INSERT INTO kv (key, value) VALUES (?, ?)',
        BYOK_KV_KEY,
        JSON.stringify({ ...DEFAULT_BYOK_CONFIG, storageMode: 'server-saved' }),
      );
      expect((await loadByokConfig(db, adapter)).storageMode).toBe('ephemeral');

      const normalized = await saveByokPreferences({ now: 5 }, db, adapter);
      expect(normalized.storageMode).toBe('ephemeral');
      expect(JSON.parse(kv.get(BYOK_KV_KEY)!).storageMode).toBe('ephemeral');
    });
  });

  describe('Fix 2 — رفض المفاتيح القصيرة وممنوع تخزين آخر ٤ حروف منها', () => {
    it('exposes the minimum length and rejects short keys before writing anything', async () => {
      expect(MIN_BYOK_KEY_LENGTH).toBe(20);
      expect(BYOK_KEY_TOO_SHORT_ERROR_AR).toContain('20');

      for (const shortKey of ['Zz9Q', 'Zz9Qw8Er7Ty6']) {
        expect(shortKey.length).toBeLessThan(MIN_BYOK_KEY_LENGTH);

        await expect(saveByokKey({ apiKey: shortKey }, db, adapter)).rejects.toThrow(
          BYOK_KEY_TOO_SHORT_ERROR_AR,
        );

        let caught: unknown;
        try {
          await saveByokKey({ apiKey: shortKey }, db, adapter);
        } catch (err) {
          caught = err;
        }
        const message = (caught as Error).message;
        expectNoSecretChars(shortKey, [message]);
      }

      // مفيش كتابة في SecureStore ولا في kv.
      expect(adapter.setItemAsync).not.toHaveBeenCalled();
      expect(entries.size).toBe(0);
      expect(kv.size).toBe(0);
      expect(JSON.stringify([...kv.entries()])).not.toContain('Zz9Q');
    });

    it('never exposes the suffix of a pre-seeded short secret in SecureStore', async () => {
      const shortSecret = 'Zz9Q';
      entries.set(getByokSecretEntryKey('openai'), shortSecret);

      const loaded = await loadByokConfig(db, adapter);
      expect(loaded.provider).toBe('openai');
      expect(loaded.hasKey).toBe(false);
      expect(loaded.keyLast4).toBeNull();
      expect(JSON.stringify([...kv.entries()])).not.toContain(shortSecret);
      expect(JSON.stringify(loaded)).not.toContain(shortSecret);
      // القيمة التالفة بتتمسح بدل ما تفضل مبعوتة.
      expect(entries.has(getByokSecretEntryKey('openai'))).toBe(false);
      expect(await readByokSecret('openai', adapter)).toBeNull();
    });

    it('repairs kv that claims a short secret is a valid key', async () => {
      entries.set(getByokSecretEntryKey('openai'), 'Zz9Q');
      await db.runAsync(
        'INSERT INTO kv (key, value) VALUES (?, ?)',
        BYOK_KV_KEY,
        JSON.stringify({ ...DEFAULT_BYOK_CONFIG, hasKey: true, keyLast4: 'Zz9Q' }),
      );

      const loaded = await loadByokConfig(db, adapter);
      expect(loaded.hasKey).toBe(false);
      expect(loaded.keyLast4).toBeNull();

      const raw = kv.get(BYOK_KV_KEY)!;
      expect(raw).not.toContain('Zz9Q');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed.hasKey).toBe(false);
      expect(parsed.keyLast4).toBeNull();
    });

    it('treats a pre-seeded 12-char secret as unusable too', async () => {
      entries.set(getByokSecretEntryKey('anthropic'), 'Zz9Qw8Er7Ty6');
      await db.runAsync(
        'INSERT INTO kv (key, value) VALUES (?, ?)',
        BYOK_KV_KEY,
        JSON.stringify({
          ...DEFAULT_BYOK_CONFIG,
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          hasKey: true,
          keyLast4: '7Ty6',
        }),
      );

      const loaded = await loadByokConfig(db, adapter);
      expect(loaded.hasKey).toBe(false);
      expect(loaded.keyLast4).toBeNull();
      expect(JSON.stringify([...kv.entries()])).not.toContain('7Ty6');
      expect(await readByokSecret('anthropic', adapter)).toBeNull();
    });
  });

  describe('Fix 3 — رسائل عربية ثابتة ومنع تسريب نص خطأ SecureStore', () => {
    it('never leaks the raw SecureStore save error', async () => {
      const throwing = createThrowingSecureStore('save');
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
      try {
        let caught: unknown;
        try {
          await saveByokKey({ apiKey: OPENAI_KEY, provider: 'openai' }, db, throwing);
        } catch (err) {
          caught = err;
        }

        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).message).toBe(BYOK_SECURE_STORE_SAVE_ERROR_AR);
        expectNoSecretChars(WEIRD_RAW_SECRET, [(caught as Error).message]);
        expect(toSafeByokErrorMessage(caught)).toBe(BYOK_SECURE_STORE_SAVE_ERROR_AR);

        const logged = consoleArgs([logSpy, warnSpy, errorSpy, infoSpy]);
        expectNoSecretChars(WEIRD_RAW_SECRET, logged);
        // مفيش بيانات سرية اتكتبت في kv بسبب الفشل.
        expect(JSON.stringify([...kv.entries()])).not.toContain(OPENAI_KEY);
      } finally {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
        infoSpy.mockRestore();
      }
    });

    it('never leaks the raw SecureStore read error', async () => {
      const throwing = createThrowingSecureStore('read');
      let caught: unknown;
      try {
        await loadByokConfig(db, throwing);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe(BYOK_SECURE_STORE_READ_ERROR_AR);
      expectNoSecretChars(WEIRD_RAW_SECRET, [(caught as Error).message]);
      expect(toSafeByokErrorMessage(caught)).toBe(BYOK_SECURE_STORE_READ_ERROR_AR);
    });

    it('never leaks the raw SecureStore delete error', async () => {
      const throwing = createThrowingSecureStore('delete');
      let caught: unknown;
      try {
        await clearByokKey(db, throwing, 9);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe(BYOK_SECURE_STORE_DELETE_ERROR_AR);
      expectNoSecretChars(WEIRD_RAW_SECRET, [(caught as Error).message]);
      expect(toSafeByokErrorMessage(caught)).toBe(BYOK_SECURE_STORE_DELETE_ERROR_AR);
    });

    it('maps unknown errors to one fixed Arabic constant', () => {
      expect(toSafeByokErrorMessage(new Error(WEIRD_RAW_SECRET))).toBe(BYOK_UNKNOWN_ERROR_AR);
      expect(toSafeByokErrorMessage(WEIRD_RAW_SECRET)).toBe(BYOK_UNKNOWN_ERROR_AR);
      expect(toSafeByokErrorMessage(null)).toBe(BYOK_UNKNOWN_ERROR_AR);
      expectNoSecretChars(WEIRD_RAW_SECRET, [
        toSafeByokErrorMessage(new Error(WEIRD_RAW_SECRET)),
      ]);
    });
  });

  describe('Fix 4 — مفتاح لكل مزوّد على حدة', () => {
    it('scopes each provider entry key to a SecureStore-safe name', () => {
      for (const provider of ['openai', 'anthropic', 'google', 'openrouter', 'custom'] as const) {
        const entryKey = getByokSecretEntryKey(provider);
        expect(entryKey).toBe(`${BYOK_SECRET_ENTRY}.${provider}`);        expect(entryKey).toMatch(/^[A-Za-z0-9._-]+$/);
      }
    });

    it('does not inherit hasKey/keyLast4 when switching to a provider with no key', async () => {
      await saveByokKey(
        { apiKey: OPENAI_KEY, provider: 'openai', modelId: 'gpt-4.1', now: 1 },
        db,
        adapter,
      );

      const switched = await saveByokPreferences({ provider: 'google', now: 2 }, db, adapter);
      expect(switched.provider).toBe('google');
      expect(switched.hasKey).toBe(false);
      expect(switched.keyLast4).toBeNull();
      expect(getByokStatusLabel(switched)).toBe('مفيش مفتاح محفوظ على الجهاز.');
      expect(JSON.parse(kv.get(BYOK_KV_KEY)!).hasKey).toBe(false);
      expect(JSON.parse(kv.get(BYOK_KV_KEY)!).keyLast4).toBeNull();
      expect(await readByokSecret('google', adapter)).toBeNull();

      // مفتاح OpenAI لسه موجود في مدخله الخاص.
      expect(entries.get(getByokSecretEntryKey('openai'))).toBe(OPENAI_KEY);
    });

    it('restores the previous provider key and last4 when switching back', async () => {
      await saveByokKey({ apiKey: OPENAI_KEY, provider: 'openai', now: 1 }, db, adapter);
      await saveByokPreferences({ provider: 'google', now: 2 }, db, adapter);
      expect((await loadByokConfig(db, adapter)).hasKey).toBe(false);

      const back = await saveByokPreferences({ provider: 'openai', now: 3 }, db, adapter);
      expect(back.provider).toBe('openai');
      expect(back.hasKey).toBe(true);
      expect(back.keyLast4).toBe('1234');
      expect(await readByokSecret('openai', adapter)).toBe(OPENAI_KEY);
      expect(await loadByokConfig(db, adapter)).toMatchObject({
        provider: 'openai',
        hasKey: true,
        keyLast4: '1234',
      });
      expect(JSON.stringify([...kv.entries()])).not.toContain(OPENAI_KEY);
    });

    it('keeps two providers keys independent and clears only the active one', async () => {
      await saveByokKey({ apiKey: OPENAI_KEY, provider: 'openai', now: 1 }, db, adapter);
      await saveByokKey({ apiKey: GOOGLE_KEY, provider: 'google', now: 2 }, db, adapter);

      expect(entries.get(getByokSecretEntryKey('openai'))).toBe(OPENAI_KEY);
      expect(entries.get(getByokSecretEntryKey('google'))).toBe(GOOGLE_KEY);

      const cleared = await clearByokKey(db, adapter, 99);
      expect(cleared.provider).toBe('google');
      expect(cleared.hasKey).toBe(false);
      expect(cleared.keyLast4).toBeNull();
      expect(entries.has(getByokSecretEntryKey('google'))).toBe(false);
      // مفتاح المزوّد التاني متأثرش.
      expect(entries.get(getByokSecretEntryKey('openai'))).toBe(OPENAI_KEY);

      const back = await saveByokPreferences({ provider: 'openai' }, db, adapter);
      expect(back.hasKey).toBe(true);
      expect(back.keyLast4).toBe('1234');
      expect(await readByokSecret('openai', adapter)).toBe(OPENAI_KEY);
      expect(await readByokSecret('google', adapter)).toBeNull();
    });

    it('repairs kv for the active provider only when its own entry is missing', async () => {
      await saveByokKey({ apiKey: ANTHROPIC_KEY, provider: 'anthropic', now: 1 }, db, adapter);
      // مفتاح openai موجود لكن المزوّد النشط anthropic — مانعرضش مفتاح openai.
      entries.set(getByokSecretEntryKey('openai'), OPENAI_KEY);

      const loaded = await loadByokConfig(db, adapter);
      expect(loaded.provider).toBe('anthropic');
      expect(loaded.hasKey).toBe(true);
      expect(loaded.keyLast4).toBe('9876');

      entries.delete(getByokSecretEntryKey('anthropic'));
      const repaired = await loadByokConfig(db, adapter);
      expect(repaired.hasKey).toBe(false);
      expect(repaired.keyLast4).toBeNull();
      // مفتاح openai لسه في مكانه، بس مش بيتعرض للمزوّد anthropic.
      expect(entries.get(getByokSecretEntryKey('openai'))).toBe(OPENAI_KEY);
    });
  });
});

describe('byok-store — رابط السيرفر للمزوّد المخصّص (https فقط)', () => {
  let db: DatabaseAdapter;
  let kv: Map<string, string>;
  let adapter: ByokSecureStoreAdapter;
  let entries: Map<string, string>;

  beforeEach(() => {
    const dbHarness = createKvTestDb();
    db = dbHarness.db;
    kv = dbHarness.kv;
    const secureHarness = createSecureStore();
    adapter = secureHarness.adapter;
    entries = secureHarness.entries;
  });

  it('defaults the custom base URL to null', () => {
    expect(DEFAULT_BYOK_CONFIG.customBaseUrl).toBeNull();
    expect(JSON.parse(JSON.stringify(DEFAULT_BYOK_CONFIG)).customBaseUrl).toBeNull();
  });

  it('accepts valid https base URLs and normalizes the trailing slash', () => {
    expect(validateHttpsBaseUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1');
    expect(validateHttpsBaseUrl('  https://api.example.com/v1  ')).toBe('https://api.example.com/v1');
    expect(validateHttpsBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
    expect(validateHttpsBaseUrl('https://gateway.example:8443/openai')).toBe(
      'https://gateway.example:8443/openai',
    );
  });

  it('rejects http, missing host, credentials and garbage with the calm Arabic error', () => {
    for (const bad of [
      'http://api.example.com/v1',
      'ftp://api.example.com',
      'api.example.com',
      'https://',
      'https://user:pass@api.example.com',
      'https://api.example.com a',
      '',
    ]) {
      expect(() => validateHttpsBaseUrl(bad)).toThrow(BYOK_CUSTOM_BASE_URL_ERROR_AR);
      expect(sanitizeCustomBaseUrl(bad)).toBeNull();
    }
    expect(sanitizeCustomBaseUrl(null)).toBeNull();
    expect(sanitizeCustomBaseUrl(42)).toBeNull();
  });

  it('persists the custom base URL for the custom provider and reloads it', async () => {
    const saved = await saveByokPreferences(
      { provider: 'custom', customBaseUrl: 'https://api.my-gateway.example/v1', now: 10 },
      db,
      adapter,
    );
    expect(saved.provider).toBe('custom');
    expect(saved.customBaseUrl).toBe('https://api.my-gateway.example/v1');

    const loaded = await loadByokConfig(db, adapter);
    expect(loaded.provider).toBe('custom');
    expect(loaded.customBaseUrl).toBe('https://api.my-gateway.example/v1');

    const raw = JSON.parse(kv.get(BYOK_KV_KEY)!) as Record<string, unknown>;
    expect(raw.customBaseUrl).toBe('https://api.my-gateway.example/v1');
    // The URL is not a secret, but the raw key must still never be in kv.
    expect(JSON.stringify([...kv.entries()])).not.toContain(OPENAI_KEY);
  });

  it('stores the base URL alongside a saved custom key', async () => {
    await saveByokKey(
      {
        apiKey: OPENAI_KEY,
        provider: 'custom',
        customBaseUrl: 'https://api.my-gateway.example/v1',
        now: 11,
      },
      db,
      adapter,
    );

    const loaded = await loadByokConfig(db, adapter);
    expect(loaded.provider).toBe('custom');
    expect(loaded.hasKey).toBe(true);
    expect(loaded.customBaseUrl).toBe('https://api.my-gateway.example/v1');
    expect(entries.get(getByokSecretEntryKey('custom'))).toBe(OPENAI_KEY);
  });

  it('rejects an invalid base URL without writing the key or preferences', async () => {
    await expect(
      saveByokPreferences({ provider: 'custom', customBaseUrl: 'http://insecure.example' }, db, adapter),
    ).rejects.toThrow(BYOK_CUSTOM_BASE_URL_ERROR_AR);
    await expect(
      saveByokKey(
        { apiKey: OPENAI_KEY, provider: 'custom', customBaseUrl: 'not-a-url' },
        db,
        adapter,
      ),
    ).rejects.toThrow(BYOK_CUSTOM_BASE_URL_ERROR_AR);

    expect(kv.size).toBe(0);
    expect(adapter.setItemAsync).not.toHaveBeenCalled();
    expect(entries.size).toBe(0);
  });

  it('clears the base URL when null is passed explicitly and keeps it on provider switch', async () => {
    await saveByokPreferences(
      { provider: 'custom', customBaseUrl: 'https://api.my-gateway.example/v1' },
      db,
      adapter,
    );

    // Switching away and back keeps the stored URL (it belongs to the custom provider).
    await saveByokPreferences({ provider: 'openai' }, db, adapter);
    const back = await saveByokPreferences({ provider: 'custom' }, db, adapter);
    expect(back.customBaseUrl).toBe('https://api.my-gateway.example/v1');

    const cleared = await saveByokPreferences({ customBaseUrl: null }, db, adapter);
    expect(cleared.customBaseUrl).toBeNull();
  });

  it('sanitizes a legacy non-https base URL read from kv to null', async () => {
    await db.runAsync(
      'INSERT INTO kv (key, value) VALUES (?, ?)',
      BYOK_KV_KEY,
      JSON.stringify({
        ...DEFAULT_BYOK_CONFIG,
        provider: 'custom',
        modelId: 'custom-vision-model',
        customBaseUrl: 'http://insecure.example/v1',
      }),
    );

    const loaded = await loadByokConfig(db, adapter);
    expect(loaded.customBaseUrl).toBeNull();
  });

  it('surfaces the validation message through the safe error mapper', () => {
    let caught: unknown;
    try {
      validateHttpsBaseUrl('http://insecure.example');
    } catch (err) {
      caught = err;
    }
    expect(toSafeByokErrorMessage(caught)).toBe(BYOK_CUSTOM_BASE_URL_ERROR_AR);
  });
});
