import { hashString } from '@rewiaty/book-format';

import { warraqTheme } from '@/theme/themes/warraq';
import type { CoverSwatchPalette } from '@/theme/types';

export type CoverPatternVariant = 'diamonds' | 'octagon' | 'arch' | 'lattice';

export type CoverPalette = {
  bg: string;
  accent: string;
  text: string;
  spine: string;
  border: string;
  pattern: CoverPatternVariant;
};

const PATTERN_VARIANTS: readonly CoverPatternVariant[] = [
  'diamonds',
  'octagon',
  'arch',
  'lattice',
];

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function expandHex(hex: string): string {
  const clean = hex.slice(1);
  if (clean.length === 3) {
    return `#${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`;
  }
  return `#${clean}`;
}

function isLightHex(hex: string): boolean {
  const full = expandHex(hex);
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62;
}

export function resolveCoverPalette(
  title: string,
  explicitCoverColor?: string | null,
  themePalettes: readonly CoverSwatchPalette[] = warraqTheme.coverPalettes,
): CoverPalette {
  const palettes = themePalettes.length > 0 ? themePalettes : warraqTheme.coverPalettes;
  const hashHex = hashString(title || 'Rewiaty');
  const paletteIdx = parseInt(hashHex.slice(0, 8), 16) % palettes.length;
  const patternIdx = parseInt(hashHex.slice(8, 16), 16) % PATTERN_VARIANTS.length;
  const pattern = PATTERN_VARIANTS[patternIdx] ?? 'diamonds';

  const trimmed = explicitCoverColor?.trim();
  if (trimmed && HEX_COLOR_RE.test(trimmed)) {
    const light = isLightHex(trimmed);
    return {
      bg: trimmed,
      accent: light ? '#5C4033' : '#DEC8A4',
      text: light ? '#1F1B18' : '#FFFFFF',
      spine: light ? 'rgba(0, 0, 0, 0.18)' : 'rgba(0, 0, 0, 0.36)',
      border: light ? 'rgba(0, 0, 0, 0.24)' : 'rgba(222, 200, 164, 0.35)',
      pattern,
    };
  }

  const chosen = palettes[paletteIdx] ?? palettes[0]!;
  return {
    bg: chosen.bg,
    accent: chosen.line,
    text: chosen.ink,
    spine: chosen.spine,
    border: chosen.line,
    pattern,
  };
}
