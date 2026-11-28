import { HIDDEN_PROOF_HOST_STYLE, HIDDEN_PROOF_TEXT_STYLE } from '@/utils/hidden-proof';

/**
 * RC3 — a proof line must be readable by Maestro and invisible to a human.
 *
 * The old paper-grain proof was an 8px Text sitting at 40% of the page; on device its transparent
 * colour still showed as a grey line over the novel. These assertions pin the replacement: a 1×1
 * clipped, fully transparent host and a 1px transparent label. If someone widens it, raises its
 * opacity or colours the text again, this test fails before the reader ever sees it.
 */
describe('hidden proof styles (RC3)', () => {
  it('never gives the proof host a visible dimension', () => {
    expect(HIDDEN_PROOF_HOST_STYLE.width).toBe(1);
    expect(HIDDEN_PROOF_HOST_STYLE.height).toBe(1);
    expect(HIDDEN_PROOF_HOST_STYLE.overflow).toBe('hidden');
    expect(HIDDEN_PROOF_HOST_STYLE.opacity).toBe(0);
    expect(HIDDEN_PROOF_HOST_STYLE.position).toBe('absolute');
  });

  it('keeps the proof text transparent and at most 1px', () => {
    expect(HIDDEN_PROOF_TEXT_STYLE.color).toBe('transparent');
    expect(HIDDEN_PROOF_TEXT_STYLE.fontSize).toBeLessThanOrEqual(1);
    expect(HIDDEN_PROOF_TEXT_STYLE.lineHeight).toBeLessThanOrEqual(1);
  });
});
