import type { ColorSchemeName } from 'react-native';
import type { ThemeId } from '../../../../packages/reader-engine/src/types';
import { burntPaperTheme } from './themes/burnt-paper';
import { oledCrimsonTheme } from './themes/oled-crimson';
import { sepiaTheme } from './themes/sepia';
import { warraqTheme } from './themes/warraq';
import type { AppThemeTokens, ThemeOption } from './types';

export type { AppThemeTokens, CoverSwatchPalette, ThemeOption } from './types';

export const THEME_REGISTRY: Record<ThemeId, AppThemeTokens> = {
  warraq: warraqTheme,
  sepia: sepiaTheme,
  'burnt-paper': burntPaperTheme,
  'oled-crimson': oledCrimsonTheme,
};

export const THEME_LIST: readonly AppThemeTokens[] = Object.values(THEME_REGISTRY);

export const THEME_OPTIONS: readonly ThemeOption[] = THEME_LIST.map((theme) => ({
  id: theme.id,
  labelAr: theme.labelAr,
  contrastLabel: theme.contrastLabel,
  isDark: theme.isDark,
  bg: theme.bg,
  text: theme.text,
  accent: theme.accent,
}));

export const LEGACY_THEME_MAP: Record<string, ThemeId> = {
  'warm-paper': 'warraq',
  charcoal: 'burnt-paper',
  oled: 'oled-crimson',
  sepia: 'sepia',
};

export function migrateThemeId(raw: unknown): ThemeId | null {
  if (typeof raw !== 'string') return null;
  if (raw in THEME_REGISTRY) {
    return raw as ThemeId;
  }
  if (raw in LEGACY_THEME_MAP) {
    return LEGACY_THEME_MAP[raw]!;
  }
  return null;
}

export function isLegacyThemeId(raw: unknown): boolean {
  return typeof raw === 'string' && raw in LEGACY_THEME_MAP && !(raw in THEME_REGISTRY);
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
