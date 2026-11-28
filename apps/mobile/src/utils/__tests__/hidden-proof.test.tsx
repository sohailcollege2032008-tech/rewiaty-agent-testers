import { render } from '@testing-library/react-native';
import { HIDDEN_PROOF_STYLE, HiddenProof } from '@/utils/hidden-proof';

/**
 * RC3.1 — a proof node must be readable by Maestro and invisible to a human.
 *
 * History: the first paper-grain proof was an 8px Text at 40% of the page (a grey line on device);
 * the second was a 1×1 `opacity: 0` host around a transparent Text, which Maestro no longer judged
 * visible (device run 46130714258). These assertions pin the third contract: a childless 48×48
 * transparent View whose sentence is only an `accessibilityLabel`. If someone puts a `Text` back
 * inside it, the reader can see it again — and this test fails before that reaches a device.
 */
describe('hidden proof node (RC3.1)', () => {
  it('never paints: transparent, childless, out of the touch path', async () => {
    const utils = await render(<HiddenProof testID="reader-example-proof" label="إثبات" />);

    const node = utils.getByTestId('reader-example-proof');

    // No children at all — a Text inside is exactly what a reader could see.
    expect(node.props.children).toBeUndefined();

    expect(node.props.pointerEvents).toBe('none');
    expect(node.props.accessible).toBe(true);
    expect(node.props.accessibilityRole).toBe('text');

    const style = HIDDEN_PROOF_STYLE;
    expect(style.position).toBe('absolute');
    expect(style.backgroundColor).toBe('transparent');
    // Big enough for Maestro's visibility check, unlike the retired 1×1 host.
    expect(style.width).toBe(48);
    expect(style.height).toBe(48);
    // Never faded out with `opacity: 0` — that is what hid it from Maestro.
    expect(style.opacity).toBeUndefined();
  });

  it('carries the proof sentence as its accessibility label', async () => {
    const utils = await render(
      <HiddenProof
        testID="reader-paper-grain-proof"
        label="ملمس الورق (warraq): مفعّل ٣٪"
      />,
    );

    const node = utils.getByTestId('reader-paper-grain-proof');
    expect(node.props.accessibilityLabel).toBe('ملمس الورق (warraq): مفعّل ٣٪');
    expect(node.props.children).toBeUndefined();
  });
});
