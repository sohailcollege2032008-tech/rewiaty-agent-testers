import { hashString } from '@rewiaty/book-format';

export type CoverPalette = {
  bg: string;
  accent: string;
  text: string;
};

const COVER_PALETTES: readonly CoverPalette[] = [
  { bg: '#4E342E', accent: '#D7CCC8', text: '#FFF8F1' },
  { bg: '#2C3E50', accent: '#B0C4DE', text: '#F8FAFC' },
  { bg: '#1B4332', accent: '#B7E4C7', text: '#F4FBF7' },
  { bg: '#5C2434', accent: '#F2C6CE', text: '#FFF5F7' },
  { bg: '#3D315B', accent: '#D4C5F9', text: '#F8F5FF' },
  { bg: '#6B4226', accent: '#EAD2AC', text: '#FFF9F0' },
  { bg: '#264653', accent: '#A8DADC', text: '#F1FAEE' },
  { bg: '#4A4E69', accent: '#E0D6EB', text: '#FAF8FC' },
];

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function resolveCoverPalette(title: string, explicitCoverColor?: string | null): CoverPalette {
  const trimmed = explicitCoverColor?.trim();
  if (trimmed && HEX_COLOR_RE.test(trimmed)) {
    return {
      bg: trimmed,
      accent: 'rgba(255, 255, 255, 0.72)',
      text: '#FFFFFF',
    };
  }

  const hashHex = hashString(title || 'Rewiaty');
  const idx = parseInt(hashHex.slice(0, 8), 16) % COVER_PALETTES.length;
  return COVER_PALETTES[idx] ?? COVER_PALETTES[0]!;
}
