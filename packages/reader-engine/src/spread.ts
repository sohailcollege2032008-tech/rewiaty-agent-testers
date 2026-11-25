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
 * Warraq theme → spine tokens. `warraq` and `sepia` are paper-light,
 * `burnt-paper` is the warm dark and `oled-crimson` the true-black OLED family.
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
