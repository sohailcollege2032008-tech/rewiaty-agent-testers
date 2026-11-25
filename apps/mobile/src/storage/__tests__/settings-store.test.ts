import { type DatabaseAdapter } from '@/storage/database';
import {
  DEFAULT_SETTINGS,
  FONT_DEFAULT_MIGRATED_KV_KEY,
  SETTINGS_KV_KEY,
  THEME_MANUAL_KV_KEY,
  loadReaderSettings,
  loadThemePreference,
  resetReaderSettings,
  resetSection,
  saveReaderSettings,
  selectManualTheme,
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

  it('returns DEFAULT_SETTINGS when kv is empty (Noto Naskh Arabic, warraq theme, Arabic lineHeight 1.95)', async () => {
    const settings = await loadReaderSettings(db);
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings.fontFamily).toBe('Noto Naskh Arabic');
    expect(settings.lineHeight).toBe(1.95);
    expect(settings.theme).toBe('warraq');
    expect(settings.marginVertical).toBeGreaterThanOrEqual(16);
  });

  it('migrates implicit pre-R5 Amiri default to Noto Naskh Arabic while preserving user-chosen fonts (A5)', async () => {
    // User changed fontSize before R5, which implicitly saved fontFamily: 'Amiri'
    await db.runAsync(
      'INSERT INTO kv (key, value) VALUES (?, ?)',
      SETTINGS_KV_KEY,
      JSON.stringify({ fontFamily: 'Amiri', fontSize: 23, theme: 'warraq' }),
    );
    const migrated = await loadReaderSettings(db);
    expect(migrated.fontFamily).toBe('Noto Naskh Arabic');
    expect(migrated.fontSize).toBe(23);

    // User who explicitly chose Readex Pro before R5 keeps Readex Pro
    const customDb = createKvTestDb();
    await customDb.runAsync(
      'INSERT INTO kv (key, value) VALUES (?, ?)',
      SETTINGS_KV_KEY,
      JSON.stringify({ fontFamily: 'Readex Pro', fontSize: 22 }),
    );
    const customLoaded = await loadReaderSettings(customDb);
    expect(customLoaded.fontFamily).toBe('Readex Pro');

    // User who explicitly picks Amiri AFTER migration keeps Amiri on subsequent loads
    await updateReaderSettings({ fontFamily: 'Amiri' }, db);
    const reloadedAfterManualAmiri = await loadReaderSettings(db);
    expect(reloadedAfterManualAmiri.fontFamily).toBe('Amiri');
    const flagRow = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM kv WHERE key = ?',
      FONT_DEFAULT_MIGRATED_KV_KEY,
    );
    expect(JSON.parse(flagRow!.value)).toBe(true);
  });

  it('migrates legacy theme IDs stored in reader_settings_v1', async () => {
    const cases = [
      { legacy: 'warm-paper', expected: 'warraq', expectedManual: false },
      { legacy: 'charcoal', expected: 'burnt-paper', expectedManual: true },
      { legacy: 'oled', expected: 'oled-crimson', expectedManual: true },
      { legacy: 'sepia', expected: 'sepia', expectedManual: true },
    ] as const;

    for (const testCase of cases) {
      const localDb = createKvTestDb();
      await localDb.runAsync(
        'INSERT INTO kv (key, value) VALUES (?, ?)',
        SETTINGS_KV_KEY,
        JSON.stringify({ fontSize: 22, theme: testCase.legacy }),
      );

      const pref = await loadThemePreference(localDb);
      expect(pref.settings.theme).toBe(testCase.expected);
      expect(pref.settings.fontSize).toBe(22);
      expect(pref.hasManualTheme).toBe(testCase.expectedManual);

      const persisted = await localDb.getFirstAsync<{ value: string }>(
        'SELECT value FROM kv WHERE key = ?',
        SETTINGS_KV_KEY,
      );
      expect(JSON.parse(persisted!.value).theme).toBe(testCase.expected);
    }
  });

  it('tracks manual theme selection and clears override on reset', async () => {
    const initial = await loadThemePreference(db);
    expect(initial.hasManualTheme).toBe(false);

    await selectManualTheme('oled-crimson', db);
    const afterManual = await loadThemePreference(db);
    expect(afterManual.settings.theme).toBe('oled-crimson');
    expect(afterManual.hasManualTheme).toBe(true);

    const manualRow = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM kv WHERE key = ?',
      THEME_MANUAL_KV_KEY,
    );
    expect(JSON.parse(manualRow!.value)).toBe(true);

    const reset = await resetReaderSettings(db);
    expect(reset).toEqual(DEFAULT_SETTINGS);
    const afterReset = await loadThemePreference(db);
    expect(afterReset.hasManualTheme).toBe(false);
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
    expect(result.fontFamily).toBe('Noto Naskh Arabic');
    expect('letterSpacing' in result).toBe(false);
  });

  it('resets only the requested tab fields in resetSection(tab) (A11)', async () => {
    await updateReaderSettings(
      {
        fontFamily: 'Readex Pro',
        fontSize: 28,
        fontWeight: 600,
        lineHeight: 2.3,
        wordSpacing: 4,
        paragraphSpacing: 16,
        textAlign: 'start',
        indentMode: 'block',
        marginHorizontal: 40,
        marginVertical: 32,
        maxReadingWidth: 80,
        dirOverride: 'ltr',
        disableAnimation: true,
        theme: 'oled-crimson',
      },
      db,
    );

    const afterFontReset = await resetSection('font', db);
    expect(afterFontReset.fontFamily).toBe(DEFAULT_SETTINGS.fontFamily);
    expect(afterFontReset.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(afterFontReset.fontWeight).toBe(DEFAULT_SETTINGS.fontWeight);
    expect(afterFontReset.lineHeight).toBe(DEFAULT_SETTINGS.lineHeight);
    expect(afterFontReset.wordSpacing).toBe(DEFAULT_SETTINGS.wordSpacing);
    expect(afterFontReset.paragraphSpacing).toBe(DEFAULT_SETTINGS.paragraphSpacing);
    // Layout & theme untouched
    expect(afterFontReset.textAlign).toBe('start');
    expect(afterFontReset.marginHorizontal).toBe(40);
    expect(afterFontReset.disableAnimation).toBe(true);
    expect(afterFontReset.theme).toBe('oled-crimson');

    const afterLayoutReset = await resetSection('layout', db);
    expect(afterLayoutReset.textAlign).toBe(DEFAULT_SETTINGS.textAlign);
    expect(afterLayoutReset.indentMode).toBe(DEFAULT_SETTINGS.indentMode);
    expect(afterLayoutReset.marginHorizontal).toBe(DEFAULT_SETTINGS.marginHorizontal);
    expect(afterLayoutReset.marginVertical).toBe(DEFAULT_SETTINGS.marginVertical);
    expect(afterLayoutReset.maxReadingWidth).toBe(DEFAULT_SETTINGS.maxReadingWidth);
    expect(afterLayoutReset.dirOverride).toBe(DEFAULT_SETTINGS.dirOverride);
    expect(afterLayoutReset.disableAnimation).toBe(DEFAULT_SETTINGS.disableAnimation);
    // Theme untouched
    expect(afterLayoutReset.theme).toBe('oled-crimson');

    // Re-customize font before resetting theme
    await updateReaderSettings({ fontSize: 26 }, db);
    const afterThemeReset = await resetSection('theme', db, 'burnt-paper');
    expect(afterThemeReset.theme).toBe('burnt-paper');
    expect(afterThemeReset.fontSize).toBe(26);
    const pref = await loadThemePreference(db);
    expect(pref.hasManualTheme).toBe(false);
  });

  it('resets back to DEFAULT_SETTINGS', async () => {
    await saveReaderSettings({ ...DEFAULT_SETTINGS, theme: 'oled-crimson', fontSize: 30 }, db);
    const reset = await resetReaderSettings(db);
    expect(reset).toEqual(DEFAULT_SETTINGS);
    expect(await loadReaderSettings(db)).toEqual(DEFAULT_SETTINGS);
  });
});
