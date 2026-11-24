import { hashString } from '@rewiaty/book-format';

export type CoverPatternVariant = 'diamonds' | 'octagon' | 'arch' | 'lattice';

export type CoverPalette = {
  bg: string;
  accent: string;
  text: string;
  spine: string;
  border: string;
  pattern: CoverPatternVariant;
};

type BasePalette = {
  bg: string;
  accent: string;
  text: string;
  spine: string;
  border: string;
};

const COVER_PALETTES: readonly BasePalette[] = [
  { bg: '#4E342E', accent: '#E6D5C3', text: '#FFF8F1', spine: '#36221E', border: '#A1887F' },
  { bg: '#2C3E50', accent: '#C8D8E6', text: '#F8FAFC', spine: '#1C2833', border: '#7F9EB2' },
  { bg: '#1B4332', accent: '#B7E4C7', text: '#F4FBF7', spine: '#0F2A1F', border: '#52B788' },
  { bg: '#5C2434', accent: '#F2C6CE', text: '#FFF5F7', spine: '#3E1622', border: '#B56576' },
  { bg: '#3D315B', accent: '#D4C5F9', text: '#F8F5FF', spine: '#281F3D', border: '#8E7AB5' },
  { bg: '#6B4226', accent: '#EAD2AC', text: '#FFF9F0', spine: '#4A2C18', border: '#BC8A5F' },
  { bg: '#264653', accent: '#A8DADC', text: '#F1FAEE', spine: '#182D36', border: '#5E9CA0' },
  { bg: '#4A4E69', accent: '#E0D6EB', text: '#FAF8FC', spine: '#2F3246', border: '#9A8C98' },
];

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
): CoverPalette {
  const hashHex = hashString(title || 'Rewiaty');
  const paletteIdx = parseInt(hashHex.slice(0, 8), 16) % COVER_PALETTES.length;
  const patternIdx = parseInt(hashHex.slice(8, 16), 16) % PATTERN_VARIANTS.length;
  const pattern = PATTERN_VARIANTS[patternIdx] ?? 'diamonds';

  const trimmed = explicitCoverColor?.trim();
  if (trimmed && HEX_COLOR_RE.test(trimmed)) {
    const light = isLightHex(trimmed);
    return {
      bg: trimmed,
      accent: light ? '#5C4033' : 'rgba(255, 255, 255, 0.78)',
      text: light ? '#1F1B18' : '#FFFFFF',
      spine: light ? 'rgba(0, 0, 0, 0.18)' : 'rgba(0, 0, 0, 0.34)',
      border: light ? 'rgba(0, 0, 0, 0.24)' : 'rgba(255, 255, 255, 0.32)',
      pattern,
    };
  }

  const base = COVER_PALETTES[paletteIdx] ?? COVER_PALETTES[0]!;
  return {
    ...base,
    pattern,
  };
}
