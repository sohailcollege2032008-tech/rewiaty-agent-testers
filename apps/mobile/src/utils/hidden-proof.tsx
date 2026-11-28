import type { ViewStyle } from 'react-native';
import { View } from 'react-native';

/**
 * Why (tech): the engine's honest proof («a figure painted», «the 3% grain is on») has to reach the
 * accessibility tree so an on-device Maestro journey can assert it — but a reader must never see a
 * debug label in the middle of the novel.
 *
 * History: an 8px Text at `top: 40%` showed as a grey line on device (RC3), and the replacement —
 * a 1×1 clipped host with `opacity: 0` around a transparent Text — was no longer a *visible*
 * element for Maestro (device run 46130714258: «… is visible» false on `reader-paper-grain-proof`).
 *
 * The proof is therefore a plain, childless 48×48 transparent View: nothing is ever painted (there
 * are no children at all), it cannot intercept a touch (`pointerEvents="none"`), and the sentence
 * travels as its `accessibilityLabel`, which Android exposes as `content-desc` — exactly what
 * Maestro's `text:` matcher reads against a node found by `id:`.
 *
 * Keep these numbers in sync with `hidden-proof.test` and the reader-screen test: together they
 * guarantee a future styling tweak cannot make a proof visible, nor shrink it out of reach.
 */
export const HIDDEN_PROOF_STYLE: ViewStyle = {
  position: 'absolute',
  start: 0,
  top: '50%',
  width: 48,
  height: 48,
  backgroundColor: 'transparent',
};

export type HiddenProofProps = {
  /** The id a device journey asserts on (`reader-paper-grain-proof`, `reader-image-proof`, …). */
  testID: string;
  /** The proof sentence. Exposed to accessibility only — never rendered as text. */
  label: string;
};

/**
 * A proof node: invisible to a reader, visible to the accessibility tree.
 *
 * Deliberately renders no child: a `Text` is what made the old proofs either visible on screen or
 * too small for Maestro to call visible, so the sentence lives on `accessibilityLabel` instead.
 */
export function HiddenProof({ testID, label }: HiddenProofProps) {
  return (
    <View
      accessible
      accessibilityRole="text"
      pointerEvents="none"
      accessibilityLabel={label}
      testID={testID}
      style={HIDDEN_PROOF_STYLE}
    />
  );
}
