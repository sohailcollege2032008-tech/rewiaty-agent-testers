import {
  DEFAULT_SETTINGS,
  THEMES,
  type IndentMode,
  type ReaderSettings,
  type TextAlignMode,
  type ThemeId,
} from '../../../../packages/reader-engine/src/types';
import { READER_FONT_FAMILIES } from '../../../../packages/reader-engine/src/fonts';
import { getKv, setKv, type DatabaseAdapter } from './database';

export const SETTINGS_KV_KEY = 'reader_settings_v1';

export { DEFAULT_SETTINGS, READER_FONT_FAMILIES };

const VALID_THEMES = new Set<ThemeId>(Object.keys(THEMES) as ThemeId[]);
const VALID_FONTS = new Set<string>(READER_FONT_FAMILIES);
const VALID_ALIGNS = new Set<TextAlignMode>(['start', 'justify']);
const VALID_INDENTS = new Set<IndentMode>(['classic', 'block']);
const VALID_DIRS = new Set<'auto' | 'rtl' | 'ltr'>(['auto', 'rtl', 'ltr']);

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function sanitizeSettingsPartial(
  partial: Partial<ReaderSettings> | null | undefined,
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
  if (partial.theme !== undefined && VALID_THEMES.has(partial.theme)) {
    next.theme = partial.theme;
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
  partial?: Partial<ReaderSettings> | null,
): ReaderSettings {
  return {
    ...base,
    ...sanitizeSettingsPartial(partial, base),
  };
}

export async function loadReaderSettings(db?: DatabaseAdapter): Promise<ReaderSettings> {
  const stored = await getKv<Partial<ReaderSettings> | null>(SETTINGS_KV_KEY, null, db);
  return mergeReaderSettings(DEFAULT_SETTINGS, stored);
}

export async function saveReaderSettings(
  settings: ReaderSettings,
  db?: DatabaseAdapter,
): Promise<ReaderSettings> {
  const sanitized = mergeReaderSettings(DEFAULT_SETTINGS, settings);
  await setKv(SETTINGS_KV_KEY, sanitized, db);
  return sanitized;
}

export async function updateReaderSettings(
  partial: Partial<ReaderSettings>,
  db?: DatabaseAdapter,
): Promise<ReaderSettings> {
  const current = await loadReaderSettings(db);
  const next = mergeReaderSettings(current, partial);
  await setKv(SETTINGS_KV_KEY, next, db);
  return next;
}

export async function resetReaderSettings(db?: DatabaseAdapter): Promise<ReaderSettings> {
  const defaults = { ...DEFAULT_SETTINGS };
  await setKv(SETTINGS_KV_KEY, defaults, db);
  return defaults;
}
