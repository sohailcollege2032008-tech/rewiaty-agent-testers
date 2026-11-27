import { fireEvent, render, waitFor } from '@testing-library/react-native';

import {
  BYOK_MODE_SERVER_SAVED_BADGE_AR,
  BYOK_MODE_SERVER_SAVED_BADGE_TEST_ID,
  ByokSettingsCard,
} from '@/components/byok-settings-card';
import {
  BYOK_CUSTOM_BASE_URL_ERROR_AR,
  BYOK_CUSTOM_BASE_URL_REQUIRED_ERROR_AR,
  BYOK_KEY_TOO_SHORT_ERROR_AR,
  BYOK_KV_KEY,
  BYOK_SECURE_STORE_SAVE_ERROR_AR,
  LEGACY_CUSTOM_MODEL_ID,
  getByokSecretEntryKey,
  type ByokSecureStoreAdapter,
} from '@/storage/byok-store';
import type { DatabaseAdapter } from '@/storage/database';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const API_KEY = 'sk-ant-api03-UiOpAsDfGhJkLzXcVbNm1234';
const TEST_TIMEOUT = 90_000;

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

function collectConsoleArgs(spies: jest.SpyInstance[]): string[] {
  const seen: string[] = [];
  for (const spy of spies) {
    for (const call of spy.mock.calls) {
      for (const arg of call) {
        if (typeof arg === 'string') seen.push(arg);
        else {
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

describe('ByokSettingsCard — واجهة إعدادات المفتاح', () => {
  let db: DatabaseAdapter;
  let kv: Map<string, string>;
  let adapter: ByokSecureStoreAdapter;
  let entries: Map<string, string>;
  let spies: jest.SpyInstance[];

  beforeEach(() => {
    const dbHarness = createKvTestDb();
    db = dbHarness.db;
    kv = dbHarness.kv;
    const secureHarness = createSecureStore();
    adapter = secureHarness.adapter;
    entries = secureHarness.entries;
    spies = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
      jest.spyOn(console, 'info').mockImplementation(() => undefined),
    ];
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
  });

  async function renderCard() {
    const view = await render(<ByokSettingsCard db={db} secureStore={adapter} now={() => 777} />);
    await waitFor(() => expect(view.getByTestId('byok-status-badge')).toBeTruthy());
    return view;
  }

  it(
    'renders empty status, ephemeral mode selected, and only vision-capable models',
    async () => {
      const view = await renderCard();

      expect(view.getByTestId('byok-status-badge')).toHaveTextContent(/مفيش مفتاح محفوظ/);
      expect(view.getByTestId('byok-mode-ephemeral').props.accessibilityState).toMatchObject({
        checked: true,
      });
      expect(view.getByTestId('byok-mode-server-saved').props.accessibilityState).toMatchObject({
        checked: false,
      });

      // بادج «نص + صور» ظاهر جوه الكارت
      const rendered = JSON.stringify(view.toJSON());
      expect(rendered).toContain('نص + صور');
      expect(rendered).not.toContain(API_KEY);
    },
    TEST_TIMEOUT,
  );

  it(
    'saves the key into SecureStore and never exposes it in kv or console',
    async () => {
      const view = await renderCard();

      await fireEvent.changeText(view.getByTestId('byok-key-input'), API_KEY);
      // المفتاح متخفي افتراضياً وممكن يظهر.
      expect(view.getByTestId('byok-key-input').props.secureTextEntry).toBe(true);
      await fireEvent.press(view.getByTestId('byok-toggle-visibility'));
      expect(view.getByTestId('byok-key-input').props.secureTextEntry).toBe(false);

      await fireEvent.press(view.getByTestId('byok-save-button'));

      await waitFor(() => expect(view.getByTestId('byok-status-badge')).toHaveTextContent(/1234/));

      expect(adapter.setItemAsync).toHaveBeenCalledWith(getByokSecretEntryKey('openai'), API_KEY);
      expect(entries.get(getByokSecretEntryKey('openai'))).toBe(API_KEY);
      expect(view.getByTestId('byok-status-badge')).toHaveTextContent(/مفتاح محفوظ/);
      expect(view.getByTestId('byok-feedback')).toHaveTextContent(/المفتاح محفوظ/);
      expect(view.getByTestId('byok-masked-key')).toHaveTextContent(/••••1234/);

      // مفيش مفتاح خام في kv
      expect(JSON.stringify([...kv.entries()])).not.toContain(API_KEY);
      const parsed = JSON.parse(kv.get(BYOK_KV_KEY)!) as Record<string, unknown>;
      expect(parsed.hasKey).toBe(true);
      expect(parsed.keyLast4).toBe('1234');
      expect(Object.keys(parsed)).not.toContain('apiKey');

      // ولا في أي سطر console
      for (const entry of collectConsoleArgs(spies)) {
        expect(entry).not.toContain(API_KEY);
        expect(entry).not.toContain('UiOpAsDfGhJk');
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'keeps the server option visible but disabled with a «قريباً» badge and a no-op press',
    async () => {
      const view = await renderCard();

      const serverOption = view.getByTestId('byok-mode-server-saved');
      expect(serverOption.props.accessibilityState).toMatchObject({
        disabled: true,
        selected: false,
        checked: false,
      });
      expect(view.getByTestId('byok-mode-ephemeral').props.accessibilityState).toMatchObject({
        disabled: false,
        selected: true,
        checked: true,
      });
      expect(view.getByTestId(BYOK_MODE_SERVER_SAVED_BADGE_TEST_ID)).toHaveTextContent(
        BYOK_MODE_SERVER_SAVED_BADGE_AR,
      );

      await fireEvent.press(serverOption);

      // لسه الوضع المؤقت، والضغط مبيعملش أي كتابة.
      expect(view.getByTestId('byok-mode-ephemeral').props.accessibilityState).toMatchObject({
        checked: true,
      });
      expect(view.getByTestId('byok-mode-server-saved').props.accessibilityState).toMatchObject({
        checked: false,
      });
      expect(kv.size).toBe(0);
      expect(view.queryByTestId('byok-feedback')).toBeNull();
    },
    TEST_TIMEOUT,
  );

  it(
    'requires an inline confirmation before deleting the key',
    async () => {
      const view = await renderCard();

      await fireEvent.changeText(view.getByTestId('byok-key-input'), API_KEY);
      await fireEvent.press(view.getByTestId('byok-save-button'));
      await waitFor(() => expect(view.getByTestId('byok-status-badge')).toHaveTextContent(/1234/));

      await fireEvent.press(view.getByTestId('byok-delete-button'));
      expect(view.getByTestId('byok-delete-confirm')).toBeTruthy();
      // الإلغاء بيسيب المفتاح زي ما هو.
      await fireEvent.press(view.getByTestId('byok-delete-cancel-button'));
      expect(view.queryByTestId('byok-delete-confirm')).toBeNull();
      expect(adapter.deleteItemAsync).not.toHaveBeenCalled();

      await fireEvent.press(view.getByTestId('byok-delete-button'));
      await fireEvent.press(view.getByTestId('byok-delete-confirm-button'));

      await waitFor(() =>
        expect(view.getByTestId('byok-status-badge')).toHaveTextContent(/مفيش مفتاح/),
      );
      expect(adapter.deleteItemAsync).toHaveBeenCalledWith(getByokSecretEntryKey('openai'));
      expect(entries.has(getByokSecretEntryKey('openai'))).toBe(false);
      expect(view.getByTestId('byok-feedback')).toHaveTextContent(/اتحذف/);
    },
    TEST_TIMEOUT,
  );

  it(
    'switching provider shows that provider models and badges them as نص + صور',
    async () => {
      const view = await renderCard();

      await fireEvent.press(view.getByTestId('byok-provider-google'));

      await waitFor(() => expect(view.getByTestId('byok-model-gemini-2.5-pro')).toBeTruthy());
      expect(view.queryByTestId('byok-model-gpt-4.1')).toBeNull();
      expect(view.getByTestId('byok-model-gemini-2.5-pro').props.accessibilityLabel).toContain(
        'نص + صور',
      );
    },
    TEST_TIMEOUT,
  );

  it(
    'rejects a 4-char key in the UI without writing it anywhere',
    async () => {
      const view = await renderCard();
      const shortKey = 'Zz9Q';

      await fireEvent.changeText(view.getByTestId('byok-key-input'), shortKey);
      await fireEvent.press(view.getByTestId('byok-save-button'));

      await waitFor(() =>
        expect(view.getByTestId('byok-error')).toHaveTextContent(BYOK_KEY_TOO_SHORT_ERROR_AR),
      );

      // المفتاح القصير ممكن يكون لسه في مربع الكتابة (مسودة المستخدم)،
      // المهم إنه مبيتخزنش ومبيظهرش في أي رسالة أو لوج.
      expect(view.getByTestId('byok-error')).not.toHaveTextContent(shortKey);
      for (const entry of collectConsoleArgs(spies)) {
        expect(entry).not.toContain(shortKey);
      }
      expect(adapter.setItemAsync).not.toHaveBeenCalled();
      expect(entries.size).toBe(0);
      expect(kv.size).toBe(0);
      expect(view.getByTestId('byok-status-badge')).toHaveTextContent(/مفيش مفتاح محفوظ/);
    },
    TEST_TIMEOUT,
  );

  it(
    'shows a fixed Arabic message when SecureStore throws and leaks no part of the raw error',
    async () => {
      const weirdSecret = 'test-only payload ' + '9911223344556677';
      const throwingAdapter: ByokSecureStoreAdapter = {
        getItemAsync: jest.fn(async () => null),
        setItemAsync: jest.fn(async () => {
          throw new Error(`Keystore write failed for payload <<${weirdSecret}>>`);
        }),
        deleteItemAsync: jest.fn(async () => undefined),
      };

      const view = await render(<ByokSettingsCard db={db} secureStore={throwingAdapter} now={() => 777} />);
      await waitFor(() => expect(view.getByTestId('byok-status-badge')).toBeTruthy());

      await fireEvent.changeText(view.getByTestId('byok-key-input'), API_KEY);
      await fireEvent.press(view.getByTestId('byok-save-button'));

      await waitFor(() =>
        expect(view.getByTestId('byok-error')).toHaveTextContent(BYOK_SECURE_STORE_SAVE_ERROR_AR),
      );

      // نص رسالة الخطأ الظاهرة + أي لوج: مفيش أي جزء من نص الخطأ الخام.
      const texts = [view.getByTestId('byok-error').props.children as string, ...collectConsoleArgs(spies)];
      const windows: string[] = [];
      for (let i = 0; i + 8 <= weirdSecret.length; i += 1) {
        windows.push(weirdSecret.slice(i, i + 8));
      }
      for (const text of texts) {
        for (const window of windows) {
          expect(text).not.toContain(window);
        }
      }
      expect(view.getByTestId('byok-error')).not.toHaveTextContent(API_KEY);
      // مفيش بيانات سرية اتخزنت.
      expect(JSON.stringify([...kv.entries()])).not.toContain(API_KEY);
    },
    TEST_TIMEOUT,
  );

  it(
    'keeps keys provider-scoped in the UI: switching shows empty, switching back restores',
    async () => {
      const view = await renderCard();

      await fireEvent.press(view.getByTestId('byok-provider-anthropic'));
      await waitFor(() => expect(view.getByTestId('byok-model-claude-sonnet-4-5')).toBeTruthy());

      await fireEvent.changeText(view.getByTestId('byok-key-input'), API_KEY);
      await fireEvent.press(view.getByTestId('byok-save-button'));
      await waitFor(() => expect(view.getByTestId('byok-status-badge')).toHaveTextContent(/1234/));
      expect(entries.get(getByokSecretEntryKey('anthropic'))).toBe(API_KEY);

      // التبديل لمزوّد مفيهوش مفتاح: مفيش وراثة.
      await fireEvent.press(view.getByTestId('byok-provider-openai'));
      await waitFor(() =>
        expect(view.getByTestId('byok-status-badge')).toHaveTextContent(/مفيش مفتاح محفوظ/),
      );
      expect(view.queryByTestId('byok-masked-key')).toBeNull();
      const currentKv = JSON.parse(kv.get(BYOK_KV_KEY)!) as Record<string, unknown>;
      expect(currentKv.provider).toBe('openai');
      expect(currentKv.hasKey).toBe(false);
      expect(currentKv.keyLast4).toBeNull();

      // الرجوع لـ Anthropic بيرجّع مفتاحه وآخر ٤ حروف.
      await fireEvent.press(view.getByTestId('byok-provider-anthropic'));
      await waitFor(() => expect(view.getByTestId('byok-status-badge')).toHaveTextContent(/1234/));
      expect(view.getByTestId('byok-masked-key')).toHaveTextContent(/••••1234/);
      expect(entries.get(getByokSecretEntryKey('anthropic'))).toBe(API_KEY);
      expect(JSON.stringify([...kv.entries()])).not.toContain(API_KEY);
    },
    TEST_TIMEOUT,
  );

  it(
    'shows the https base URL and real model-name inputs only when the custom provider is selected',
    async () => {
      const view = await renderCard();
      expect(view.queryByTestId('byok-custom-base-url-input')).toBeNull();
      expect(view.queryByTestId('byok-custom-model-input')).toBeNull();

      await fireEvent.press(view.getByTestId('byok-provider-custom'));

      await waitFor(() => expect(view.getByTestId('byok-custom-base-url-input')).toBeTruthy());
      // No fixed placeholder model row: the user types the real gateway model name.
      expect(view.getByTestId('byok-custom-model-input')).toBeTruthy();
      expect(view.queryByTestId('byok-model-custom-vision-model')).toBeNull();
      expect(view.queryByTestId('byok-model-gpt-4.1')).toBeNull();
    },
    TEST_TIMEOUT,
  );

  it(
    'saves the real model name the user typed and reloads it from kv',
    async () => {
      const view = await renderCard();

      await fireEvent.press(view.getByTestId('byok-provider-custom'));
      await waitFor(() => expect(view.getByTestId('byok-custom-model-input')).toBeTruthy());

      await fireEvent.changeText(
        view.getByTestId('byok-custom-model-input'),
        'deepseek-chat',
      );
      await fireEvent.changeText(
        view.getByTestId('byok-custom-base-url-input'),
        'https://api.my-gateway.example/v1',
      );
      await fireEvent.changeText(view.getByTestId('byok-key-input'), API_KEY);
      await fireEvent.press(view.getByTestId('byok-save-button'));

      await waitFor(() => expect(view.getByTestId('byok-feedback')).toHaveTextContent(/المفتاح محفوظ/));

      const parsed = JSON.parse(kv.get(BYOK_KV_KEY)!) as Record<string, unknown>;
      expect(parsed.provider).toBe('custom');
      expect(parsed.modelId).toBe('deepseek-chat');
      expect(parsed.customBaseUrl).toBe('https://api.my-gateway.example/v1');
      expect(parsed.modelId).not.toBe(LEGACY_CUSTOM_MODEL_ID);
    },
    TEST_TIMEOUT,
  );

  it(
    'rejects a custom key with an empty base URL and saves nothing',
    async () => {
      const view = await renderCard();

      await fireEvent.press(view.getByTestId('byok-provider-custom'));
      await waitFor(() => expect(view.getByTestId('byok-custom-base-url-input')).toBeTruthy());

      await fireEvent.changeText(view.getByTestId('byok-custom-model-input'), 'deepseek-chat');
      await fireEvent.changeText(view.getByTestId('byok-key-input'), API_KEY);
      await fireEvent.press(view.getByTestId('byok-save-button'));

      await waitFor(() =>
        expect(view.getByTestId('byok-error')).toHaveTextContent(
          BYOK_CUSTOM_BASE_URL_REQUIRED_ERROR_AR,
        ),
      );

      expect(adapter.setItemAsync).not.toHaveBeenCalled();
      expect(entries.size).toBe(0);
      expect(JSON.stringify([...kv.entries()])).not.toContain(API_KEY);
    },
    TEST_TIMEOUT,
  );

  it(
    'shows a clear update message for legacy custom model data and leaves the field empty',
    async () => {
      await db.runAsync(
        'INSERT INTO kv (key, value) VALUES (?, ?)',
        BYOK_KV_KEY,
        JSON.stringify({
          provider: 'custom',
          modelId: LEGACY_CUSTOM_MODEL_ID,
          storageMode: 'ephemeral',
          keyLast4: null,
          hasKey: false,
          updatedAt: 1,
          customBaseUrl: 'https://api.my-gateway.example/v1',
        }),
      );

      const view = await renderCard();

      await waitFor(() => expect(view.getByTestId('byok-custom-model-legacy-notice')).toBeTruthy());
      expect(view.getByTestId('byok-custom-model-input').props.value).toBe('');
    },
    TEST_TIMEOUT,
  );

  it(
    'saves a custom key together with a valid https base URL',
    async () => {
      const view = await renderCard();

      await fireEvent.press(view.getByTestId('byok-provider-custom'));
      await waitFor(() => expect(view.getByTestId('byok-custom-base-url-input')).toBeTruthy());

      await fireEvent.changeText(
        view.getByTestId('byok-custom-model-input'),
        'deepseek-chat',
      );
      await fireEvent.changeText(
        view.getByTestId('byok-custom-base-url-input'),
        'https://api.my-gateway.example/v1',
      );
      await fireEvent.changeText(view.getByTestId('byok-key-input'), API_KEY);
      await fireEvent.press(view.getByTestId('byok-save-button'));

      await waitFor(() => expect(view.getByTestId('byok-status-badge')).toHaveTextContent(/1234/));

      const parsed = JSON.parse(kv.get(BYOK_KV_KEY)!) as Record<string, unknown>;
      expect(parsed.provider).toBe('custom');
      expect(parsed.modelId).toBe('deepseek-chat');
      expect(parsed.customBaseUrl).toBe('https://api.my-gateway.example/v1');
      expect(parsed.hasKey).toBe(true);
      expect(entries.get(getByokSecretEntryKey('custom'))).toBe(API_KEY);
      expect(JSON.stringify([...kv.entries()])).not.toContain(API_KEY);
    },
    TEST_TIMEOUT,
  );

  it(
    'rejects a non-https base URL with a calm Arabic error and saves no key',
    async () => {
      const view = await renderCard();

      await fireEvent.press(view.getByTestId('byok-provider-custom'));
      await waitFor(() => expect(view.getByTestId('byok-custom-base-url-input')).toBeTruthy());

      await fireEvent.changeText(
        view.getByTestId('byok-custom-base-url-input'),
        'http://insecure.example/v1',
      );
      await fireEvent.changeText(view.getByTestId('byok-key-input'), API_KEY);
      await fireEvent.press(view.getByTestId('byok-save-button'));

      await waitFor(() =>
        expect(view.getByTestId('byok-error')).toHaveTextContent(BYOK_CUSTOM_BASE_URL_ERROR_AR),
      );

      // مفيش مفتاح اتخزن، والتفضيلات المحفوظة لسه مفيهاش مفتاح.
      expect(adapter.setItemAsync).not.toHaveBeenCalled();
      expect(entries.size).toBe(0);
      const persisted = kv.has(BYOK_KV_KEY)
        ? (JSON.parse(kv.get(BYOK_KV_KEY)!) as Record<string, unknown>)
        : null;
      expect(persisted?.hasKey ?? false).toBe(false);
      expect(JSON.stringify([...kv.entries()])).not.toContain(API_KEY);
    },
    TEST_TIMEOUT,
  );

  it(
    'updates saved custom base URL via Save without re-entering the key and clears via مسح',
    async () => {
      const view = await renderCard();

      await fireEvent.press(view.getByTestId('byok-provider-custom'));
      await waitFor(() => expect(view.getByTestId('byok-custom-base-url-input')).toBeTruthy());

      await fireEvent.changeText(view.getByTestId('byok-custom-model-input'), 'deepseek-chat');
      await fireEvent.changeText(
        view.getByTestId('byok-custom-base-url-input'),
        'https://api.first.example/v1',
      );
      await fireEvent.changeText(view.getByTestId('byok-key-input'), API_KEY);
      await fireEvent.press(view.getByTestId('byok-save-button'));
      await waitFor(() => expect(view.getByTestId('byok-feedback')).toHaveTextContent(/المفتاح محفوظ/));

      // Clear URL with the clear button and verify Save refuses empty URL without asking for key.
      await fireEvent.press(view.getByTestId('byok-custom-base-url-clear'));
      expect(view.getByTestId('byok-custom-base-url-input').props.value).toBe('');
      await fireEvent.press(view.getByTestId('byok-save-button'));
      await waitFor(() =>
        expect(view.getByTestId('byok-error')).toHaveTextContent(
          BYOK_CUSTOM_BASE_URL_REQUIRED_ERROR_AR,
        ),
      );

      // Type a valid updated URL with draftKey blank -> updates preferences and keeps saved key.
      await fireEvent.changeText(
        view.getByTestId('byok-custom-base-url-input'),
        'https://api.second.example/v1',
      );
      await fireEvent.press(view.getByTestId('byok-save-button'));
      await waitFor(() => expect(view.getByTestId('byok-feedback')).toHaveTextContent(/المفتاح محفوظ/));

      const parsed = JSON.parse(kv.get(BYOK_KV_KEY)!) as Record<string, unknown>;
      expect(parsed.customBaseUrl).toBe('https://api.second.example/v1');
      expect(parsed.hasKey).toBe(true);
      expect(entries.get(getByokSecretEntryKey('custom'))).toBe(API_KEY);
    },
    TEST_TIMEOUT,
  );
});
