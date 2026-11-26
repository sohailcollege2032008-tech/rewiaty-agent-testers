import type { ColorSchemeName } from 'react-native';
import type { ThemeId } from '../../../../packages/reader-engine/src/types';
import { burntPaperTheme } from './themes/burnt-paper';
import { desertSandTheme } from './themes/desert-sand';
import { espressoTheme } from './themes/espresso';
import { forestNightTheme } from './themes/forest-night';
import { morningMistTheme } from './themes/morning-mist';
import { nightInkTheme } from './themes/night-ink';
import { oledAmberTheme } from './themes/oled-amber';
import { oledCrimsonTheme } from './themes/oled-crimson';
import { parchmentTheme } from './themes/parchment';
import { sagePaperTheme } from './themes/sage-paper';
import { sepiaTheme } from './themes/sepia';
import { twilightPlumTheme } from './themes/twilight-plum';
import { warraqTheme } from './themes/warraq';
import type { AppThemeTokens, ThemeOption } from './types';

export type { AppThemeTokens, CoverSwatchPalette, ThemeCategory, ThemeOption } from './types';

/** The four quick-select themes that stay on the surface of the المظهر tab. */
export const CORE_THEME_IDS: readonly ThemeId[] = [
  'warraq',
  'sepia',
  'burnt-paper',
  'oled-crimson',
] as const;

export const THEME_REGISTRY: Record<ThemeId, AppThemeTokens> = {
  warraq: warraqTheme,
  sepia: sepiaTheme,
  'burnt-paper': burntPaperTheme,
  'oled-crimson': oledCrimsonTheme,
  // F31 — «موسوعة الثيمات»
  'night-ink': nightInkTheme,
  parchment: parchmentTheme,
  'sage-paper': sagePaperTheme,
  'desert-sand': desertSandTheme,
  'morning-mist': morningMistTheme,
  'forest-night': forestNightTheme,
  espresso: espressoTheme,
  'twilight-plum': twilightPlumTheme,
  'oled-amber': oledAmberTheme,
};

export const THEME_LIST: readonly AppThemeTokens[] = Object.values(THEME_REGISTRY);

/** Quick-select row: the four core themes only (the encyclopedia carries the rest). */
export const THEME_OPTIONS: readonly ThemeOption[] = CORE_THEME_IDS.map((id) => {
  const theme = THEME_REGISTRY[id];
  return {
    id: theme.id,
    labelAr: theme.labelAr,
    contrastLabel: theme.contrastLabel,
    isDark: theme.isDark,
    category: theme.category,
    bg: theme.bg,
    text: theme.text,
    accent: theme.accent,
  };
});

export const LEGACY_THEME_MAP: Record<string, ThemeId> = {
  'warm-paper': 'warraq',
  charcoal: 'burnt-paper',
  oled: 'oled-crimson',
  sepia: 'sepia',
};

// Why (tech): Object.hasOwn, not `in` — `in` also matches prototype keys ("toString"), which would let a
// corrupted stored id pass as a theme and crash the registry lookup.
export function migrateThemeId(raw: unknown): ThemeId | null {
  if (typeof raw !== 'string') return null;
  if (Object.hasOwn(THEME_REGISTRY, raw)) {
    return raw as ThemeId;
  }
  if (Object.hasOwn(LEGACY_THEME_MAP, raw)) {
    return LEGACY_THEME_MAP[raw]!;
  }
  return null;
}

export function isLegacyThemeId(raw: unknown): boolean {
  return typeof raw === 'string' && Object.hasOwn(LEGACY_THEME_MAP, raw) && !(Object.hasOwn(THEME_REGISTRY, raw));
}

export function isCoreThemeId(raw: unknown): boolean {
  return typeof raw === 'string' && CORE_THEME_IDS.includes(raw as ThemeId);
}

export function resolveSystemTheme(colorScheme: ColorSchemeName | null | undefined): ThemeId {
  return colorScheme === 'dark' ? 'burnt-paper' : 'warraq';
}

export function resolveAppTheme(
  savedTheme: ThemeId | string | null | undefined,
  hasManualTheme: boolean,
  colorScheme: ColorSchemeName | null | undefined,
): ThemeId {
  if (hasManualTheme) {
    const migrated = migrateThemeId(savedTheme);
    if (migrated) return migrated;
  }
  return resolveSystemTheme(colorScheme);
}

export function getAppThemeTokens(
  themeId?: ThemeId | string | null,
  fallbackColorScheme: ColorSchemeName | null | undefined = 'light',
): AppThemeTokens {
  const resolved = migrateThemeId(themeId);
  if (resolved) {
    return THEME_REGISTRY[resolved];
  }
  return THEME_REGISTRY[resolveSystemTheme(fallbackColorScheme)];
}
