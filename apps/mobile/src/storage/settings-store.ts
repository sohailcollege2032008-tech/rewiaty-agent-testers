import {
  DEFAULT_CUSTOM_COLORS,
  DEFAULT_SETTINGS,
  THEMES,
  type CustomReaderColors,
  type IndentMode,
  type ReadingFocusMode,
  type ReadingMode,
  type ReaderSettings,
  type TashkeelMode,
  type TextAlignMode,
  type ThemeId,
} from '../../../../packages/reader-engine/src/types';
import { READER_FONT_FAMILIES } from '../../../../packages/reader-engine/src/fonts';
import { isLegacyThemeId, migrateThemeId } from '@/theme/reader-theme';
import { WCAG_AA_MIN_RATIO, contrastRatio, normalizeHexColor } from '@/theme/wcag';
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
const VALID_TASHKEEL = new Set<TashkeelMode>(['full', 'none', 'shadda-tanween']);
const VALID_DIRS = new Set<'auto' | 'rtl' | 'ltr'>(['auto', 'rtl', 'ltr']);
// F31 — lighting, auto-theme and eye-rest enums.
const VALID_BRIGHTNESS_MODES = new Set<'system' | 'custom'>(['system', 'custom']);
/**
 * F31 P1 — `autoThemeMode` is the ONE source of truth for which theme is active.
 *
 * `THEME_MANUAL_KV_KEY` predates the three-mode control and is kept only as a migration input:
 * every write below keeps it in sync, so a build that still reads the boolean cannot disagree
 * with this one.
 */
export type AutoThemeMode = 'system' | 'schedule' | 'manual' | 'ambient';
const VALID_AUTO_THEME_MODES = new Set<AutoThemeMode>([
  'system',
  'schedule',
  'manual',
  'ambient',
]);
/** F22: the two reading layouts the engine can render. */
const VALID_READING_MODES = new Set<ReadingMode>(['paginated', 'scroll']);
/** F33 — إيقاف / تركيز الفقرة / مسطرة التتبع. */
const VALID_READING_FOCUS = new Set<ReadingFocusMode>(['off', 'paragraph', 'ruler']);

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

/**
 * F32 — ألوان مخصّصة are stored, so they are read back from a file that can be corrupted (an old
 * build, a crash mid-write, someone editing the DB). A half-typed or mangled hex must never reach
 * a style: anything that is not a real `#RRGGBB` is dropped back to the default pair, and a
 * non-boolean `enabled` reads as off — the reader keeps their preset theme rather than a blank page.
 *
 * A pair that does not clear WCAG AA (4.5:1) is stored but never enabled: the picker already blocks
 * «تطبيق» under the threshold, and this is the storage layer's own guarantee for anything that
 * arrives around it (an old build, a hand-edited row, a future caller).
 */
export function sanitizeCustomColors(raw: unknown): CustomReaderColors | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const candidate = raw as Partial<CustomReaderColors>;
  const bg = typeof candidate.bg === 'string' ? normalizeHexColor(candidate.bg) : null;
  const text = typeof candidate.text === 'string' ? normalizeHexColor(candidate.text) : null;
  const corrupt = bg === null || text === null;
  const readable =
    bg !== null && text !== null && contrastRatio(text, bg) >= WCAG_AA_MIN_RATIO;
  return {
    enabled: corrupt || !readable ? false : candidate.enabled === true,
    bg: bg ?? DEFAULT_CUSTOM_COLORS.bg,
    text: text ?? DEFAULT_CUSTOM_COLORS.text,
  };
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
  if (partial.tashkeel !== undefined && VALID_TASHKEEL.has(partial.tashkeel)) {
    next.tashkeel = partial.tashkeel;
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
  if (partial.customColors !== undefined) {
    const custom = sanitizeCustomColors(partial.customColors);
    if (custom) {
      next.customColors = custom;
    }
  }
  // F22: scroll mode and its top progress bar. An unknown mode is dropped (never coerced),
  // so a stale stored value falls back to the `DEFAULT_SETTINGS` layout.
  if (partial.readingMode !== undefined && VALID_READING_MODES.has(partial.readingMode)) {
    next.readingMode = partial.readingMode;
  }
  if (typeof partial.showScrollProgressBar === 'boolean') {
    next.showScrollProgressBar = partial.showScrollProgressBar;
  }
  // F33 — an unknown focus mode is dropped, never coerced: a mangled stored value must not
  // suddenly dim the reader's page.
  if (partial.readingFocus !== undefined && VALID_READING_FOCUS.has(partial.readingFocus)) {
    next.readingFocus = partial.readingFocus;
  }

  // F31 — الإضاءة وراحة العين.
  if (partial.dimmer !== undefined) {
    const clamped = clampNumber(partial.dimmer, 0, 0.7, current.dimmer ?? 0);
    next.dimmer = Number(roundToStep(clamped, 0.05).toFixed(2));
  }
  if (partial.warmth !== undefined) {
    const clamped = clampNumber(partial.warmth, 0, 0.6, current.warmth ?? 0);
    next.warmth = Number(roundToStep(clamped, 0.05).toFixed(2));
  }
  if (partial.brightnessMode !== undefined && VALID_BRIGHTNESS_MODES.has(partial.brightnessMode)) {
    next.brightnessMode = partial.brightnessMode;
  }
  if (partial.brightness !== undefined) {
    const clamped = clampNumber(partial.brightness, 0.05, 1, current.brightness ?? 0.8);
    next.brightness = Number(roundToStep(clamped, 0.05).toFixed(2));
  }
  if (typeof partial.edgeBrightnessSwipe === 'boolean') {
    next.edgeBrightnessSwipe = partial.edgeBrightnessSwipe;
  }
  if (partial.autoThemeMode !== undefined && VALID_AUTO_THEME_MODES.has(partial.autoThemeMode)) {
    next.autoThemeMode = partial.autoThemeMode;
  }
  if (partial.dayTheme !== undefined) {
    const migrated = migrateThemeId(partial.dayTheme);
    if (migrated) next.dayTheme = migrated;
  }
  if (partial.nightTheme !== undefined) {
    const migrated = migrateThemeId(partial.nightTheme);
    if (migrated) next.nightTheme = migrated;
  }
  if (partial.nightStartHour !== undefined) {
    next.nightStartHour = Math.round(
      clampNumber(partial.nightStartHour, 0, 23, current.nightStartHour ?? 19),
    );
  }
  if (partial.nightEndHour !== undefined) {
    next.nightEndHour = Math.round(
      clampNumber(partial.nightEndHour, 0, 23, current.nightEndHour ?? 6),
    );
  }
  if (typeof partial.eyeRestReminder === 'boolean') {
    next.eyeRestReminder = partial.eyeRestReminder;
  }
  if (partial.eyeRestIntervalMinutes !== undefined) {
    next.eyeRestIntervalMinutes = Math.round(
      clampNumber(partial.eyeRestIntervalMinutes, 15, 120, current.eyeRestIntervalMinutes ?? 45),
    );
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

  // Pre-F31 rows carry no `autoThemeMode`, only the `hasManualTheme` boolean. Use it as the
  // migration input exactly once, then never again: from here on the mode decides.
  let hasManualTheme = manualStored === true;
  if (manualStored === null && stored && typeof rawTheme === 'string') {
    // Existing users who chose a non-default theme before automatic scheme tracking keep their choice.
    // Why (product): `warm-paper` was the old default and is stored for anyone who changed any other
    // setting, so it does not mean the reader picked it. Those readers get the new system-following
    // default (Warraq by day, Burnt Paper at night) — the behaviour Sohail chose for the app.
    if (rawTheme === 'charcoal' || rawTheme === 'oled' || rawTheme === 'sepia') {
      hasManualTheme = true;
    }
  }

  const storedMode = stored?.autoThemeMode;
  const hasStoredMode =
    typeof storedMode === 'string' && VALID_AUTO_THEME_MODES.has(storedMode as AutoThemeMode);
  const autoThemeMode: AutoThemeMode = hasStoredMode
    ? (storedMode as AutoThemeMode)
    : hasManualTheme
      ? 'manual'
      : 'system';
  if (!hasStoredMode) {
    merged = { ...merged, autoThemeMode };
    shouldPersistSettings = true;
  }
  if (shouldPersistSettings) {
    await setKv(SETTINGS_KV_KEY, merged, db);
  }

  const isManual = autoThemeMode === 'manual';
  // Keep the legacy boolean in sync so an older build reading it cannot resurrect a manual theme
  // after the reader switched back to «حسب الجهاز» (Codex F31 review P1).
  if (manualStored !== isManual) {
    await setKv(THEME_MANUAL_KV_KEY, isManual, db);
  }

  return {
    settings: merged,
    hasManualTheme: isManual,
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
  // P1: the legacy boolean mirrors the mode, so switching back to «حسب الجهاز» clears it on disk
  // even when no new theme was picked, and switching to «يدوي» sets it without a new theme.
  await setKv(THEME_MANUAL_KV_KEY, (sanitized.autoThemeMode ?? 'system') === 'manual', db);
  return sanitized;
}

export async function updateReaderSettings(
  partial: Partial<ReaderSettings>,
  db?: DatabaseAdapter,
): Promise<ReaderSettings> {
  const current = await loadReaderSettings(db);
  const withMode: Partial<ReaderSettings> =
    partial.theme !== undefined && partial.autoThemeMode === undefined
      ? { ...partial, autoThemeMode: 'manual' }
      : partial;
  const next = mergeReaderSettings(current, withMode);
  await setKv(SETTINGS_KV_KEY, next, db);
  await setKv(FONT_DEFAULT_MIGRATED_KV_KEY, true, db);
  await setKv(THEME_MANUAL_KV_KEY, (next.autoThemeMode ?? 'system') === 'manual', db);
  return next;
}

export async function selectManualTheme(
  theme: ThemeId,
  db?: DatabaseAdapter,
): Promise<ReaderSettings> {
  return updateReaderSettings({ theme, autoThemeMode: 'manual' }, db);
}

export async function clearManualThemeOverride(db?: DatabaseAdapter): Promise<void> {
  await setKv(THEME_MANUAL_KV_KEY, false, db);
  await updateReaderSettings({ autoThemeMode: 'system' }, db);
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
        // F18: «التشكيل» lives in the font tab, so its reset returns to «كامل».
        tashkeel: DEFAULT_SETTINGS.tashkeel,
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
        // F22: «وضع القراءة» and its progress bar are layout choices.
        readingMode: DEFAULT_SETTINGS.readingMode,
        showScrollProgressBar: DEFAULT_SETTINGS.showScrollProgressBar,
        // F33: the focus control lives in «تنسيق الصفحة» too.
        readingFocus: DEFAULT_SETTINGS.readingFocus,
      };
    case 'theme':
      // F31: «المظهر» owns the lighting/auto-theme/eye-rest comfort settings too, so «افتراضي»
      // must put all of them back — otherwise a reader is stuck with 60% warmth forever.
      return {
        theme: systemTheme,
        dimmer: DEFAULT_SETTINGS.dimmer,
        warmth: DEFAULT_SETTINGS.warmth,
        brightnessMode: DEFAULT_SETTINGS.brightnessMode,
        brightness: DEFAULT_SETTINGS.brightness,
        edgeBrightnessSwipe: DEFAULT_SETTINGS.edgeBrightnessSwipe,
        autoThemeMode: DEFAULT_SETTINGS.autoThemeMode,
        dayTheme: DEFAULT_SETTINGS.dayTheme,
        nightTheme: DEFAULT_SETTINGS.nightTheme,
        nightStartHour: DEFAULT_SETTINGS.nightStartHour,
        nightEndHour: DEFAULT_SETTINGS.nightEndHour,
        eyeRestReminder: DEFAULT_SETTINGS.eyeRestReminder,
        eyeRestIntervalMinutes: DEFAULT_SETTINGS.eyeRestIntervalMinutes,
        // F32: resetting «المظهر» also drops the custom pair, so the preset is what paints.
        customColors: { ...DEFAULT_CUSTOM_COLORS, enabled: false },
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
