import { StyleSheet, View } from 'react-native';

export type LightingOverlayProps = {
  /** 0..0.7 — a plain black veil over the page. */
  dimmer: number;
  /** 0..0.6 — an amber blue-light filter (rendered at `warmth * 0.45` opacity of amber). */
  warmth: number;
};

/** The amber used for the warmth layer: rgba(255, 166, 66, α). */
export const WARMTH_AMBER = '255, 166, 66';
/** How much of `warmth` becomes alpha — 60% warmth is a clear amber cast, never orange soda. */
export const WARMTH_ALPHA_FACTOR = 0.45;

export function dimmerLayerColor(dimmer: number): string {
  if (!(dimmer > 0)) return 'transparent';
  return `rgba(0, 0, 0, ${Math.min(0.7, dimmer)})`;
}

export function warmthLayerColor(warmth: number): string {
  if (!(warmth > 0)) return 'transparent';
  return `rgba(${WARMTH_AMBER}, ${Math.min(0.6, warmth) * WARMTH_ALPHA_FACTOR})`;
}

/**
 * F31 — التعتيم ودفء الشاشة.
 *
 * Why (performance): a CSS/SVG `filter` (or `backdropFilter`) over a WebView re-rasterises the whole
 * page on every frame — measured jank on low-end Android. Two plain, non-interactive `View` layers
 * cost one composited quad each, and `pointerEvents="none"` keeps every tap and swipe reaching the
 * page underneath.
 */
export function LightingOverlay({ dimmer, warmth }: LightingOverlayProps) {
  return (
    <>
      <View
        testID="reader-dimmer-overlay"
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.layer, { backgroundColor: dimmerLayerColor(dimmer) }]}
      />
      <View
        testID="reader-warmth-overlay"
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.layer, { backgroundColor: warmthLayerColor(warmth) }]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  layer: {
    // Above the WebView, below the HUD (zIndex 20) and the sheets (35).
    zIndex: 8,
  },
});
