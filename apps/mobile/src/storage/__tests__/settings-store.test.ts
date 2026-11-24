import { type DatabaseAdapter } from '@/storage/database';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KV_KEY,
  loadReaderSettings,
  resetReaderSettings,
  saveReaderSettings,
  updateReaderSettings,
} from '@/storage/settings-store';

function createKvTestDb(): DatabaseAdapter {
  const kv = new Map<string, string>();
  return {
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
}

describe('settings-store', () => {
  let db: DatabaseAdapter;

  beforeEach(() => {
    db = createKvTestDb();
  });

  it('returns DEFAULT_SETTINGS when kv is empty (Arabic lineHeight 1.95)', async () => {
    const settings = await loadReaderSettings(db);
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings.fontFamily).toBe('Amiri');
    expect(settings.lineHeight).toBe(1.95);
    expect(settings.theme).toBe('warm-paper');
    expect(settings.marginVertical).toBeGreaterThanOrEqual(16);
  });

  it('persists partial updates to SQLite kv and reloads across sessions', async () => {
    const updated = await updateReaderSettings(
      {
        fontFamily: 'Readex Pro',
        fontSize: 24,
        lineHeight: 2.2,
        wordSpacing: 3,
        paragraphSpacing: 14,
        fontWeight: 500,
        textAlign: 'start',
        indentMode: 'block',
        marginHorizontal: 32,
        marginVertical: 20,
        maxReadingWidth: 75,
        theme: 'sepia',
        disableAnimation: true,
        dirOverride: 'rtl',
      },
      db,
    );

    expect(updated.fontFamily).toBe('Readex Pro');
    expect(updated.theme).toBe('sepia');
    expect(updated.disableAnimation).toBe(true);

    const reloaded = await loadReaderSettings(db);
    expect(reloaded).toEqual(updated);

    const rawRow = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM kv WHERE key = ?',
      SETTINGS_KV_KEY,
    );
    expect(rawRow).not.toBeNull();
    expect(JSON.parse(rawRow!.value).fontFamily).toBe('Readex Pro');
  });

  it('clamps out-of-range settings and never stores letterSpacing', async () => {
    const result = await updateReaderSettings(
      {
        fontSize: 99,
        lineHeight: 1.1,
        fontWeight: 900,
        marginVertical: 4,
        maxReadingWidth: 120,
        fontFamily: 'Unknown Font',
        ...({ letterSpacing: 4 } as Record<string, unknown>),
      } as Partial<typeof DEFAULT_SETTINGS>,
      db,
    );

    expect(result.fontSize).toBe(36);
    expect(result.lineHeight).toBe(1.5);
    expect(result.fontWeight).toBe(600);
    expect(result.marginVertical).toBe(16);
    expect(result.maxReadingWidth).toBe(85);
    expect(result.fontFamily).toBe('Amiri');
    expect('letterSpacing' in result).toBe(false);
  });

  it('resets back to DEFAULT_SETTINGS', async () => {
    await saveReaderSettings({ ...DEFAULT_SETTINGS, theme: 'oled', fontSize: 30 }, db);
    const reset = await resetReaderSettings(db);
    expect(reset).toEqual(DEFAULT_SETTINGS);
    expect(await loadReaderSettings(db)).toEqual(DEFAULT_SETTINGS);
  });
});
