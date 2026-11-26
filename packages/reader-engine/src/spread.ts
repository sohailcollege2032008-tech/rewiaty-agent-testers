import type { ThemeId } from './types.js';

/**
 * Two-page open-book spread (R2).
 *
 * The values below come from the design source of truth:
 * `.factory/design/warraq/tablet/tokens.json` →
 *   viewports.landscape = { width: 1366, height: 1024, columns: 2,
 *                           spreadGutterPx: 108, maxLineMeasureCh: 54 }
 * and the matching spine tokens of each theme (light / dark-burnt / dark-ink / dark-oled).
 *
 * They are mirrored here as CSS custom properties by the paginator so the stylesheet
 * never hard-codes a design number.
 */

/** Minimum viewport width for a readable spread (below this the columns get too narrow). */
export const SPREAD_MIN_VIEWPORT_PX = 900;

/** Width of the centre gutter (the "spine crease") in px — tokens.landscape.spreadGutterPx. */
export const SPREAD_GUTTER_PX = 108;

/** Max characters per column on a spread — tokens.landscape.maxLineMeasureCh. */
export const SPREAD_MAX_MEASURE_CH = 54;

export type SpineTokens = {
  /** darkest line exactly at the fold */
  crease: string;
  /** shadow bleeding onto the paper */
  inner: string;
  /** the far, softer falloff */
  mid: string;
  /** highlight / light catching the paper next to the fold */
  sheen: string;
  /** the paper edge of the whole book */
  pageEdge: string;
};

/**
 * Warraq theme → spine tokens. `warraq`, `sepia`, `parchment`, `sage-paper`, `desert-sand` and
 * `morning-mist` are paper-light; the rest are night papers (see `isDarkThemeId`).
 */
const SPINE_BY_THEME: Record<ThemeId, SpineTokens> = {
  warraq: {
    crease: 'rgba(54, 42, 28, 0.24)',
    inner: 'rgba(54, 42, 28, 0.11)',
    mid: 'rgba(54, 42, 28, 0.045)',
    sheen: 'rgba(255, 253, 248, 0.52)',
    pageEdge: 'rgba(110, 96, 78, 0.3)',
  },
  sepia: {
    crease: 'rgba(62, 44, 24, 0.26)',
    inner: 'rgba(62, 44, 24, 0.12)',
    mid: 'rgba(62, 44, 24, 0.05)',
    sheen: 'rgba(255, 248, 232, 0.46)',
    pageEdge: 'rgba(115, 95, 75, 0.3)',
  },
  'burnt-paper': {
    crease: 'rgba(0, 0, 0, 0.72)',
    inner: 'rgba(0, 0, 0, 0.42)',
    mid: 'rgba(0, 0, 0, 0.16)',
    sheen: 'rgba(255, 238, 220, 0.035)',
    pageEdge: 'rgba(222, 207, 192, 0.2)',
  },
  'oled-crimson': {
    crease: 'rgba(210, 198, 185, 0.16)',
    inner: 'rgba(210, 198, 185, 0.035)',
    mid: 'rgba(0, 0, 0, 0)',
    sheen: 'rgba(255, 255, 255, 0.02)',
    pageEdge: 'rgba(185, 178, 167, 0.15)',
  },
  // F31 — حِبْر اللَّيْل: spine shadow from `tokens.palette.spineShadow`.
  'night-ink': {
    crease: 'rgba(4, 7, 13, 0.68)',
    inner: 'rgba(4, 7, 13, 0.4)',
    mid: 'rgba(4, 7, 13, 0.16)',
    sheen: 'rgba(212, 216, 223, 0.04)',
    pageEdge: 'rgba(212, 216, 223, 0.16)',
  },
  parchment: {
    crease: 'rgba(66, 52, 30, 0.22)',
    inner: 'rgba(66, 52, 30, 0.1)',
    mid: 'rgba(66, 52, 30, 0.04)',
    sheen: 'rgba(255, 253, 245, 0.5)',
    pageEdge: 'rgba(126, 108, 76, 0.26)',
  },
  'sage-paper': {
    crease: 'rgba(40, 54, 34, 0.22)',
    inner: 'rgba(40, 54, 34, 0.1)',
    mid: 'rgba(40, 54, 34, 0.04)',
    sheen: 'rgba(249, 252, 245, 0.48)',
    pageEdge: 'rgba(96, 112, 88, 0.26)',
  },
  'desert-sand': {
    crease: 'rgba(76, 54, 28, 0.24)',
    inner: 'rgba(76, 54, 28, 0.11)',
    mid: 'rgba(76, 54, 28, 0.045)',
    sheen: 'rgba(255, 248, 232, 0.46)',
    pageEdge: 'rgba(140, 108, 66, 0.28)',
  },
  'morning-mist': {
    crease: 'rgba(40, 54, 66, 0.2)',
    inner: 'rgba(40, 54, 66, 0.09)',
    mid: 'rgba(40, 54, 66, 0.035)',
    sheen: 'rgba(252, 254, 255, 0.5)',
    pageEdge: 'rgba(96, 118, 136, 0.24)',
  },
  'forest-night': {
    crease: 'rgba(2, 8, 5, 0.7)',
    inner: 'rgba(2, 8, 5, 0.4)',
    mid: 'rgba(2, 8, 5, 0.15)',
    sheen: 'rgba(214, 228, 218, 0.035)',
    pageEdge: 'rgba(214, 228, 218, 0.16)',
  },
  espresso: {
    crease: 'rgba(8, 4, 2, 0.72)',
    inner: 'rgba(8, 4, 2, 0.42)',
    mid: 'rgba(8, 4, 2, 0.16)',
    sheen: 'rgba(228, 211, 195, 0.035)',
    pageEdge: 'rgba(228, 211, 195, 0.18)',
  },
  'twilight-plum': {
    crease: 'rgba(6, 3, 10, 0.7)',
    inner: 'rgba(6, 3, 10, 0.4)',
    mid: 'rgba(6, 3, 10, 0.15)',
    sheen: 'rgba(221, 210, 230, 0.035)',
    pageEdge: 'rgba(221, 210, 230, 0.16)',
  },
  'oled-amber': {
    crease: 'rgba(216, 205, 187, 0.14)',
    inner: 'rgba(216, 205, 187, 0.03)',
    mid: 'rgba(0, 0, 0, 0)',
    sheen: 'rgba(255, 255, 255, 0.02)',
    pageEdge: 'rgba(205, 190, 165, 0.14)',
  },
};

export function spineTokensFor(theme: ThemeId): SpineTokens {
  return Object.hasOwn(SPINE_BY_THEME, theme) ? SPINE_BY_THEME[theme] : SPINE_BY_THEME.warraq;
}

/**
 * `ch` is roughly half an em for the Arabic book faces, so a measure of N characters
 * is about N * 0.5 * fontSize px. Used only to cap how wide the open book may grow.
 */
export function measureChToPx(ch: number, fontSize: number): number {
  return Math.round(Math.max(24, Math.min(SPREAD_MAX_MEASURE_CH, ch)) * fontSize * 0.5);
}
