import { type DatabaseAdapter } from '@/storage/database';
import { DEFAULT_CUSTOM_COLORS } from '../../../../../packages/reader-engine/src/types';
import {
  DEFAULT_SETTINGS,
  FONT_DEFAULT_MIGRATED_KV_KEY,
  SETTINGS_KV_KEY,
  THEME_MANUAL_KV_KEY,
  getSectionResetPartial,
  loadReaderSettings,
  loadThemePreference,
  resetReaderSettings,
  resetSection,
  sanitizeCustomColors,
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
        tashkeel: 'shadda-tanween',
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
    expect(updated.tashkeel).toBe('shadda-tanween');
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

  it('persists the tashkeel mode, ignores unknown values, and resets it with the font tab (F18)', async () => {
    // «كامل» is the reading default: the file's own text, nothing hidden.
    expect(DEFAULT_SETTINGS.tashkeel).toBe('full');
    expect((await loadReaderSettings(db)).tashkeel).toBe('full');

    const hidden = await updateReaderSettings({ tashkeel: 'none' }, db);
    expect(hidden.tashkeel).toBe('none');
    expect((await loadReaderSettings(db)).tashkeel).toBe('none');

    const intermediate = await updateReaderSettings({ tashkeel: 'shadda-tanween' }, db);
    expect(intermediate.tashkeel).toBe('shadda-tanween');
    expect((await loadReaderSettings(db)).tashkeel).toBe('shadda-tanween');

    // A value this build does not know (an older/newer app, a hand-edited row) must not
    // clobber the reader's choice…
    const ignored = await updateReaderSettings(
      { tashkeel: 'harakat' } as unknown as Partial<typeof DEFAULT_SETTINGS>,
      db,
    );
    expect(ignored.tashkeel).toBe('shadda-tanween');

    // …and when it is the only stored value it falls back to «كامل» instead of breaking.
    const staleDb = createKvTestDb();
    await staleDb.runAsync(
      'INSERT INTO kv (key, value) VALUES (?, ?)',
      SETTINGS_KV_KEY,
      JSON.stringify({ tashkeel: 'harakat' }),
    );
    expect((await loadReaderSettings(staleDb)).tashkeel).toBe('full');

    // The control lives in the font tab, so that reset brings it back to «كامل».
    await updateReaderSettings({ tashkeel: 'none', fontSize: 27 }, db);
    const afterFontReset = await resetSection('font', db);
    expect(afterFontReset.tashkeel).toBe('full');
    expect(afterFontReset.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });

  it('persists scroll reading mode and its progress bar, ignores unknown modes, and resets both with the layout tab (F22)', async () => {
    // The classic paginated layout is the default, with the progress bar ready for scroll.
    expect(DEFAULT_SETTINGS.readingMode).toBe('paginated');
    expect(DEFAULT_SETTINGS.showScrollProgressBar).toBe(true);

    const scroll = await updateReaderSettings(
      { readingMode: 'scroll', showScrollProgressBar: false },
      db,
    );
    expect(scroll.readingMode).toBe('scroll');
    expect(scroll.showScrollProgressBar).toBe(false);
    const reloaded = await loadReaderSettings(db);
    expect(reloaded.readingMode).toBe('scroll');
    expect(reloaded.showScrollProgressBar).toBe(false);

    // A mode this build does not know must not replace the reader's choice…
    const ignored = await updateReaderSettings(
      { readingMode: 'infinite' } as unknown as Partial<typeof DEFAULT_SETTINGS>,
      db,
    );
    expect(ignored.readingMode).toBe('scroll');

    // …and a stored value alone falls back to the paginated default.
    const staleDb = createKvTestDb();
    await staleDb.runAsync(
      'INSERT INTO kv (key, value) VALUES (?, ?)',
      SETTINGS_KV_KEY,
      JSON.stringify({ readingMode: 'infinite' }),
    );
    expect((await loadReaderSettings(staleDb)).readingMode).toBe('paginated');

    // Both controls live in the layout tab, so its reset restores them.
    const afterLayoutReset = await resetSection('layout', db);
    expect(afterLayoutReset.readingMode).toBe('paginated');
    expect(afterLayoutReset.showScrollProgressBar).toBe(true);
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

  it('persists the custom pair canonically — uppercase, hashed, and reloaded as chosen (F32)', async () => {
    // A reader who types lowercase (or forgets the hash) still gets one stored spelling.
    const saved = await updateReaderSettings(
      { customColors: { enabled: true, bg: '101820', text: 'f2e8d5' } },
      db,
    );
    expect(saved.customColors).toEqual({ enabled: true, bg: '#101820', text: '#F2E8D5' });

    const reloaded = await loadReaderSettings(db);
    expect(reloaded.customColors).toEqual({ enabled: true, bg: '#101820', text: '#F2E8D5' });

    const rawRow = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM kv WHERE key = ?',
      SETTINGS_KV_KEY,
    );
    expect(JSON.parse(rawRow!.value).customColors.bg).toBe('#101820');
  });

  it('keeps the stored pair but turns custom colours off when «إلغاء التخصيص» is pressed (F32)', async () => {
    await updateReaderSettings({ customColors: { enabled: true, bg: '#101820', text: '#F2E8D5' } }, db);

    const disabled = await updateReaderSettings({ customColors: { enabled: false, bg: '#101820', text: '#F2E8D5' } }, db);
    // Disabling is not a deletion — the picker reopens on the same pair.
    expect(disabled.customColors).toEqual({ enabled: false, bg: '#101820', text: '#F2E8D5' });
    expect((await loadReaderSettings(db)).customColors?.enabled).toBe(false);
  });

  it('refuses to enable a pair below WCAG AA, even when the stored row says enabled (F32)', async () => {
    // The picker blocks «تطبيق» under 4.5:1; the storage layer is the second gate for anything
    // that did not come through the picker (old build, hand-edited row).
    expect(sanitizeCustomColors({ enabled: true, bg: '#A0A0A0', text: '#8E8E8E' })).toEqual({
      enabled: false,
      bg: '#A0A0A0',
      text: '#8E8E8E',
    });

    const saved = await updateReaderSettings(
      { customColors: { enabled: true, bg: '#A0A0A0', text: '#8E8E8E' } },
      db,
    );
    expect(saved.customColors).toEqual({ enabled: false, bg: '#A0A0A0', text: '#8E8E8E' });
    expect((await loadReaderSettings(db)).customColors?.enabled).toBe(false);

    // A pair that clears AA (white on #757575 = 4.61:1) is enabled normally.
    const borderlineOk = await updateReaderSettings(
      { customColors: { enabled: true, bg: '#757575', text: '#FFFFFF' } },
      db,
    );
    expect(borderlineOk.customColors).toEqual({
      enabled: true,
      bg: '#757575',
      text: '#FFFFFF',
    });
  });

  it('drops a mangled hex back to the default pair with custom colours off (F32)', async () => {
    // A corrupt row (old build, crash mid-write, hand-edited DB) must never paint a blank page.
    expect(sanitizeCustomColors({ enabled: true, bg: '#12', text: '#F2E8D5' })).toEqual({
      enabled: false,
      bg: DEFAULT_CUSTOM_COLORS.bg,
      text: '#F2E8D5',
    });
    expect(sanitizeCustomColors({ enabled: 'yes', bg: '#101820', text: '#F2E8D5' })).toEqual({
      enabled: false,
      bg: '#101820',
      text: '#F2E8D5',
    });
    expect(sanitizeCustomColors('nonsense')).toBeUndefined();

    const corruptDb = createKvTestDb();
    await corruptDb.runAsync(
      'INSERT INTO kv (key, value) VALUES (?, ?)',
      SETTINGS_KV_KEY,
      JSON.stringify({ customColors: { enabled: true, bg: 'not-a-colour', text: '#F2E8D5' } }),
    );
    const loaded = await loadReaderSettings(corruptDb);
    expect(loaded.customColors).toEqual({
      enabled: false,
      bg: DEFAULT_CUSTOM_COLORS.bg,
      text: '#F2E8D5',
    });
  });

  it('resetting «المظهر» drops the custom pair as well as the theme (F32)', async () => {
    expect(getSectionResetPartial('theme', 'burnt-paper')).toEqual({
      theme: 'burnt-paper',
      customColors: { ...DEFAULT_CUSTOM_COLORS, enabled: false },
    });

    await updateReaderSettings(
      { theme: 'sepia', fontSize: 25, customColors: { enabled: true, bg: '#101820', text: '#F2E8D5' } },
      db,
    );
    const afterThemeReset = await resetSection('theme', db, 'burnt-paper');
    expect(afterThemeReset.theme).toBe('burnt-paper');
    expect(afterThemeReset.customColors).toEqual({ ...DEFAULT_CUSTOM_COLORS, enabled: false });
    // Other tabs are untouched by a theme reset.
    expect(afterThemeReset.fontSize).toBe(25);
  });

  it('resets back to DEFAULT_SETTINGS', async () => {
    await saveReaderSettings({ ...DEFAULT_SETTINGS, theme: 'oled-crimson', fontSize: 30 }, db);
    const reset = await resetReaderSettings(db);
    expect(reset).toEqual(DEFAULT_SETTINGS);
    expect(await loadReaderSettings(db)).toEqual(DEFAULT_SETTINGS);
  });
});
