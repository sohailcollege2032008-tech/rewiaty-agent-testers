import {
  DEFAULT_SETTINGS,
  THEMES,
  type IndentMode,
  type ReaderSettings,
  type TextAlignMode,
  type ThemeId,
} from '../../../../packages/reader-engine/src/types';
import { READER_FONT_FAMILIES } from '../../../../packages/reader-engine/src/fonts';
import { isLegacyThemeId, migrateThemeId } from '@/theme/reader-theme';
import { getKv, setKv, type DatabaseAdapter } from './database';

export const SETTINGS_KV_KEY = 'reader_settings_v1';
export const THEME_MANUAL_KV_KEY = 'reader_theme_manual_v1';
export const FONT_DEFAULT_MIGRATED_KV_KEY = 'reader_font_default_v2_migrated';

export type SettingsTabId = 'font' | 'layout' | 'theme';

export { DEFAULT_SETTINGS, READER_FONT_FAMILIES };

const VALID_THEMES = new Set<ThemeId>(Object.keys(THEMES) as ThemeId[]);
const VALID_FONTS = new Set<string>(READER_FONT_FAMILIES);
const VALID_ALIGNS = new Set<TextAlignMode>(['start', 'justify']);
const VALID_INDENTS = new Set<IndentMode>(['classic', 'block']);
const VALID_DIRS = new Set<'auto' | 'rtl' | 'ltr'>(['auto', 'rtl', 'ltr']);

type RawStoredSettings = Partial<Omit<ReaderSettings, 'theme'>> & {
  theme?: string;
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function sanitizeSettingsPartial(
  partial: Partial<ReaderSettings> | RawStoredSettings | null | undefined,
  current: ReaderSettings = DEFAULT_SETTINGS,
): Partial<ReaderSettings> {
  if (!partial || typeof partial !== 'object') return {};
  const next: Partial<ReaderSettings> = {};

  if (typeof partial.fontFamily === 'string' && VALID_FONTS.has(partial.fontFamily)) {
    next.fontFamily = partial.fontFamily;
  }
  if (partial.fontSize !== undefined) {
    next.fontSize = Math.round(clampNumber(partial.fontSize, 14, 36, current.fontSize));
  }
  if (partial.lineHeight !== undefined) {
    const clamped = clampNumber(partial.lineHeight, 1.5, 2.6, current.lineHeight);
    next.lineHeight = Number(roundToStep(clamped, 0.05).toFixed(2));
  }
  if (partial.wordSpacing !== undefined) {
    next.wordSpacing = Math.round(clampNumber(partial.wordSpacing, -2, 16, current.wordSpacing));
  }
  if (partial.paragraphSpacing !== undefined) {
    next.paragraphSpacing = Math.round(
      clampNumber(partial.paragraphSpacing, 0, 32, current.paragraphSpacing),
    );
  }
  if (partial.fontWeight !== undefined) {
    const clamped = clampNumber(partial.fontWeight, 300, 600, current.fontWeight);
    next.fontWeight = Math.round(roundToStep(clamped, 100));
  }
  if (partial.textAlign !== undefined && VALID_ALIGNS.has(partial.textAlign)) {
    next.textAlign = partial.textAlign;
  }
  if (partial.indentMode !== undefined && VALID_INDENTS.has(partial.indentMode)) {
    next.indentMode = partial.indentMode;
  }
  if (partial.marginHorizontal !== undefined) {
    next.marginHorizontal = Math.round(
      clampNumber(partial.marginHorizontal, 8, 64, current.marginHorizontal),
    );
  }
  if (partial.marginVertical !== undefined) {
    // >= 16px protects Arabic Tashkeel from clipping
    next.marginVertical = Math.round(
      clampNumber(partial.marginVertical, 16, 64, current.marginVertical),
    );
  }
  if (partial.maxReadingWidth !== undefined) {
    next.maxReadingWidth = Math.round(
      clampNumber(partial.maxReadingWidth, 45, 85, current.maxReadingWidth),
    );
  }
  if (partial.theme !== undefined) {
    const migrated = migrateThemeId(partial.theme);
    if (migrated && VALID_THEMES.has(migrated)) {
      next.theme = migrated;
    }
  }
  if (typeof partial.disableAnimation === 'boolean') {
    next.disableAnimation = partial.disableAnimation;
  }
  if (partial.dirOverride !== undefined && VALID_DIRS.has(partial.dirOverride)) {
    next.dirOverride = partial.dirOverride;
  }

  return next;
}

export function mergeReaderSettings(
  base: ReaderSettings,
  partial?: Partial<ReaderSettings> | RawStoredSettings | null,
): ReaderSettings {
  return {
    ...base,
    ...sanitizeSettingsPartial(partial, base),
  };
}

export type ThemePreferenceState = {
  settings: ReaderSettings;
  hasManualTheme: boolean;
};

export async function loadThemePreference(db?: DatabaseAdapter): Promise<ThemePreferenceState> {
  const stored = await getKv<RawStoredSettings | null>(SETTINGS_KV_KEY, null, db);
  const manualStored = await getKv<boolean | null>(THEME_MANUAL_KV_KEY, null, db);
  const fontMigrated = await getKv<boolean>(FONT_DEFAULT_MIGRATED_KV_KEY, false, db);

  let merged = mergeReaderSettings(DEFAULT_SETTINGS, stored);
  const rawTheme = stored?.theme;
  const wasLegacyTheme = isLegacyThemeId(rawTheme);
  let shouldPersistSettings = wasLegacyTheme;

  // One-time default-font migration (R5 A5): Amiri was the previous default so anyone who changed
  // another setting got Amiri saved implicitly. Migrate that old default to Noto Naskh Arabic once,
  // while keeping any non-default font the reader explicitly chose.
  if (stored && !fontMigrated) {
    if (stored.fontFamily === 'Amiri') {
      merged = { ...merged, fontFamily: DEFAULT_SETTINGS.fontFamily };
      shouldPersistSettings = true;
    }
    await setKv(FONT_DEFAULT_MIGRATED_KV_KEY, true, db);
  }

  if (shouldPersistSettings) {
    await setKv(SETTINGS_KV_KEY, merged, db);
  }

  let hasManualTheme = manualStored === true;
  if (manualStored === null && stored && typeof rawTheme === 'string') {
    // Existing users who chose a non-default theme before automatic scheme tracking keep their choice.
    // Why (product): `warm-paper` was the old default and is stored for anyone who changed any other
    // setting, so it does not mean the reader picked it. Those readers get the new system-following
    // default (Warraq by day, Burnt Paper at night) — the behaviour Sohail chose for the app.
    if (rawTheme === 'charcoal' || rawTheme === 'oled' || rawTheme === 'sepia') {
      hasManualTheme = true;
      await setKv(THEME_MANUAL_KV_KEY, true, db);
    }
  }

  return {
    settings: merged,
    hasManualTheme,
  };
}

export async function loadReaderSettings(db?: DatabaseAdapter): Promise<ReaderSettings> {
  const { settings } = await loadThemePreference(db);
  return settings;
}

export async function saveReaderSettings(
  settings: ReaderSettings,
  db?: DatabaseAdapter,
): Promise<ReaderSettings> {
  const sanitized = mergeReaderSettings(DEFAULT_SETTINGS, settings);
  await setKv(SETTINGS_KV_KEY, sanitized, db);
  await setKv(FONT_DEFAULT_MIGRATED_KV_KEY, true, db);
  return sanitized;
}

export async function updateReaderSettings(
  partial: Partial<ReaderSettings>,
  db?: DatabaseAdapter,
): Promise<ReaderSettings> {
  const current = await loadReaderSettings(db);
  const next = mergeReaderSettings(current, partial);
  await setKv(SETTINGS_KV_KEY, next, db);
  await setKv(FONT_DEFAULT_MIGRATED_KV_KEY, true, db);
  if (partial.theme !== undefined) {
    await setKv(THEME_MANUAL_KV_KEY, true, db);
  }
  return next;
}

export async function selectManualTheme(
  theme: ThemeId,
  db?: DatabaseAdapter,
): Promise<ReaderSettings> {
  return updateReaderSettings({ theme }, db);
}

export async function clearManualThemeOverride(db?: DatabaseAdapter): Promise<void> {
  await setKv(THEME_MANUAL_KV_KEY, false, db);
}

export function getSectionResetPartial(
  tab: SettingsTabId,
  systemTheme: ThemeId = DEFAULT_SETTINGS.theme,
): Partial<ReaderSettings> {
  switch (tab) {
    case 'font':
      return {
        fontFamily: DEFAULT_SETTINGS.fontFamily,
        fontSize: DEFAULT_SETTINGS.fontSize,
        fontWeight: DEFAULT_SETTINGS.fontWeight,
        lineHeight: DEFAULT_SETTINGS.lineHeight,
        wordSpacing: DEFAULT_SETTINGS.wordSpacing,
        paragraphSpacing: DEFAULT_SETTINGS.paragraphSpacing,
      };
    case 'layout':
      return {
        textAlign: DEFAULT_SETTINGS.textAlign,
        indentMode: DEFAULT_SETTINGS.indentMode,
        marginHorizontal: DEFAULT_SETTINGS.marginHorizontal,
        marginVertical: DEFAULT_SETTINGS.marginVertical,
        maxReadingWidth: DEFAULT_SETTINGS.maxReadingWidth,
        dirOverride: DEFAULT_SETTINGS.dirOverride,
        disableAnimation: DEFAULT_SETTINGS.disableAnimation,
      };
    case 'theme':
      return {
        theme: systemTheme,
      };
  }
}

export async function resetSection(
  tab: SettingsTabId,
  db?: DatabaseAdapter,
  systemTheme: ThemeId = DEFAULT_SETTINGS.theme,
): Promise<ReaderSettings> {
  const current = await loadReaderSettings(db);
  const next = mergeReaderSettings(current, getSectionResetPartial(tab, systemTheme));
  await setKv(SETTINGS_KV_KEY, next, db);
  await setKv(FONT_DEFAULT_MIGRATED_KV_KEY, true, db);
  if (tab === 'theme') {
    await setKv(THEME_MANUAL_KV_KEY, false, db);
  }
  return next;
}

export async function resetReaderSettings(db?: DatabaseAdapter): Promise<ReaderSettings> {
  const defaults = { ...DEFAULT_SETTINGS };
  await setKv(SETTINGS_KV_KEY, defaults, db);
  await setKv(THEME_MANUAL_KV_KEY, false, db);
  await setKv(FONT_DEFAULT_MIGRATED_KV_KEY, true, db);
  return defaults;
}
