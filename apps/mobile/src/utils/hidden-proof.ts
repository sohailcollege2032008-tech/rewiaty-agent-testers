import type { TextStyle, ViewStyle } from 'react-native';

/**
 * Why (tech): the engine's honest proof («a figure painted», «the 3% grain is on») has to reach the
 * accessibility tree so an on-device Maestro journey can assert it — but a reader must never see a
 * debug label in the middle of the novel. A translucent 8px Text sitting at `top: 40%` did show up
 * as a grey line on device (RC3), so the proof now lives in a 1×1 clipped, fully transparent box at
 * the bottom edge: no visible dimensions, no paint, still a real Text node in the a11y tree.
 *
 * Keep these numbers in sync with `hiddenProof.test` — that test is the guarantee a future styling
 * tweak cannot make a proof visible again.
 */
export const HIDDEN_PROOF_HOST_STYLE: ViewStyle = {
  position: 'absolute',
  start: 0,
  bottom: 0,
  width: 1,
  height: 1,
  overflow: 'hidden',
  opacity: 0,
};

export const HIDDEN_PROOF_TEXT_STYLE: TextStyle = {
  color: 'transparent',
  fontSize: 1,
  lineHeight: 1,
};
