import type { ThemeId } from '../../../../packages/reader-engine/src/types';
import { contrastRatio } from '../../../../packages/reader-engine/src/types';
import { CORE_THEME_IDS, THEME_REGISTRY } from './reader-theme';
import type { AppThemeTokens, ThemeCategory } from './types';

/**
 * F31 — «موسوعة الثيمات» (the Theme Encyclopedia).
 *
 * The four core themes stay the quick-select row in the settings sheet; the encyclopedia is the
 * larger shelf above the registry that the reader browses by mood. «حِبْر اللَّيْل» leads it
 * (Sohail, 2026-11-25) and the rest sweep light → warm → dark → OLED.
 */

export type ThemeFilterId = 'all' | ThemeCategory;

export const THEME_CATEGORIES: readonly { id: ThemeFilterId; labelAr: string }[] = [
  { id: 'all', labelAr: 'الكل' },
  { id: 'light', labelAr: 'فاتح' },
  { id: 'warm', labelAr: 'دافئ' },
  { id: 'dark', labelAr: 'داكن' },
  { id: 'oled', labelAr: 'OLED' },
];

export const THEME_CATEGORY_LABELS: Record<ThemeCategory, string> = {
  light: 'فاتح',
  warm: 'دافئ',
  dark: 'داكن',
  oled: 'OLED',
};

/** The nine curated encyclopedia themes — «حِبْر اللَّيْل» first. */
export const ENCYCLOPEDIA_THEME_IDS: readonly ThemeId[] = [
  'night-ink',
  'parchment',
  'sage-paper',
  'desert-sand',
  'morning-mist',
  'forest-night',
  'espresso',
  'twilight-plum',
  'oled-amber',
] as const;

/** The shelf the modal renders for «الكل»: the encyclopedia first, then the four core themes. */
export const ALL_THEME_IDS: readonly ThemeId[] = [
  ...ENCYCLOPEDIA_THEME_IDS,
  ...CORE_THEME_IDS,
] as const;

/** One sample line per card, fully voweled so the reader judges the theme on Arabic text. */
export const THEME_SAMPLE_TEXT = 'وَعَلَى أَطْرَافِ الْحِكَايَةِ يَقِفُ الْقَارِئُ لَحْظَةً…';

export const THEME_TAGLINES: Record<ThemeId, string> = {
  warraq: 'الورق الدافئ الأصلي: بيج عاجي وحبر بنّي.',
  sepia: 'سيبيا كلاسيكية من ورق الكتب القديمة.',
  'burnt-paper': 'بني إسبرسو دافئ تحت مصباح قراءة ليلي.',
  'oled-crimson': 'سواد حقيقي لشاشات OLED بنص عاجي خافت.',
  'night-ink': 'كحلي ليلي هادئ بشريطة قرمزية باهتة.',
  parchment: 'رَقّ مخطوط فاتح بلمسة ذهبية قديمة.',
  'sage-paper': 'أخضر مريمي هادئ يريح العين نهارًا.',
  'desert-sand': 'رمل صحراوي دافئ بخيط كهرماني.',
  'morning-mist': 'رمادي أزرق بارد كضباب الصباح.',
  'forest-night': 'أخضر صنوبري غامق لليل هادئ.',
  espresso: 'بني قهوة داكن بدفء خفيف.',
  'twilight-plum': 'بنفسجي شفق خافت بنص ليلكي.',
  'oled-amber': 'أسود OLED كامل مع كهرمان دافئ.',
};

export function isEncyclopediaThemeId(themeId: ThemeId | string | null | undefined): boolean {
  return (
    typeof themeId === 'string' && ENCYCLOPEDIA_THEME_IDS.includes(themeId as ThemeId)
  );
}

/** WCAG contrast of a theme's reading text on its own background (1..21). */
export function themeContrastRatio(theme: AppThemeTokens): number {
  return contrastRatio(theme.text, theme.bg);
}

export function countThemesByCategory(): Record<ThemeCategory, number> {
  const counts: Record<ThemeCategory, number> = { light: 0, warm: 0, dark: 0, oled: 0 };
  for (const id of ALL_THEME_IDS) {
    counts[THEME_REGISTRY[id].category] += 1;
  }
  return counts;
}

/** Themes for a filter tab, in shelf order. */
export function listThemesForFilter(filter: ThemeFilterId): readonly AppThemeTokens[] {
  const ids = filter === 'all' ? ALL_THEME_IDS : ALL_THEME_IDS.filter(
    (id) => THEME_REGISTRY[id].category === filter,
  );
  return ids.map((id) => THEME_REGISTRY[id]);
}
