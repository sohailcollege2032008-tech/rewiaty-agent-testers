import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { BookmarkRibbon } from '@/components/bookmark-ribbon';
import {
  RIBBON_MAX_PULL,
  RIBBON_MAX_PUSH,
  RIBBON_PULL_THRESHOLD,
  RIBBON_RELEASE_THRESHOLD,
  clampRibbonOffset,
  resolveRibbonCommit,
  ribbonCrossesThreshold,
} from '@/utils/bookmark-ribbon';

// The shared setup mock freezes shared values and never registers a gesture, which is enough to
// render but cannot exercise a drag. This suite captures the pan config the component registers,
// drives it by hand, and keeps shared values live across events like the real ones.
const mockPanConfig: Record<string, (event: RibbonPanEvent) => void> = {};
const mockSharedSets: unknown[] = [];
const mockWithSpring = jest.fn((value: unknown, _config?: unknown) => value);

type RibbonPanEvent = {
  translationY: number;
  canceled?: boolean;
};

jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  usePanGesture: (config: Record<string, (event: RibbonPanEvent) => void>) => {
    Object.assign(mockPanConfig, config);
    return {};
  },
  useTapGesture: () => ({}),
  useSimultaneousGestures: () => ({}),
}));

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View: RNView } = require('react-native');
  return {
    __esModule: true,
    default: { View: RNView, createAnimatedComponent: (component: unknown) => component },
    View: RNView,
    Easing: { bezier: () => () => 0 },
    useSharedValue: (initial: unknown) => {
      const ref = React.useRef(null);
      if (ref.current === null) {
        let value = initial;
        ref.current = {
          get: () => value,
          set: (next: unknown) => {
            value = next;
            mockSharedSets.push(next);
          },
        };
      }
      return ref.current;
    },
    useAnimatedStyle: (factory: () => Record<string, unknown>) => factory(),
    useReducedMotion: () => false,
    withTiming: (value: unknown) => value,
    withSpring: (value: unknown, config: unknown) => mockWithSpring(value, config),
  };
});

const impactAsync = Haptics.impactAsync as jest.Mock;

async function renderRibbon(overrides: { isBookmarked?: boolean; onToggle?: jest.Mock } = {}) {
  const onToggle = overrides.onToggle ?? jest.fn();
  const utils = await render(
    <BookmarkRibbon
      isBookmarked={overrides.isBookmarked ?? false}
      color="#8b1e3f"
      onToggle={onToggle}
      hitSlop={10}
      style={{ position: 'absolute', top: 40, width: 34, height: 52 }}
    />,
  );
  return { ...utils, onToggle };
}

/** Activate, move to the given translation(s), then release. Mirrors the native event order. */
async function drag(
  translations: number[],
  options: { canceled?: boolean; activateAt?: number } = {},
) {
  await act(async () => {
    mockPanConfig.onBegin?.({ translationY: 0 });
    mockPanConfig.onActivate?.({ translationY: options.activateAt ?? translations[0] ?? 0 });
    for (const translationY of translations) {
      mockPanConfig.onUpdate?.({ translationY });
    }
    mockPanConfig.onDeactivate?.({
      translationY: translations.at(-1) ?? 0,
      canceled: options.canceled ?? false,
    });
    mockPanConfig.onFinalize?.({
      translationY: translations.at(-1) ?? 0,
      canceled: options.canceled ?? false,
    });
  });
}

beforeEach(() => {
  mockSharedSets.length = 0;
  impactAsync.mockClear();
  mockWithSpring.mockClear();
});

afterEach(async () => {
  await cleanup();
});

describe('bookmark ribbon drag arithmetic (F24)', () => {
  it('clamps the ribbon to a bounded travel and rejects non-finite input', () => {
    expect(clampRibbonOffset(0)).toBe(0);
    expect(clampRibbonOffset(60)).toBe(60);
    expect(clampRibbonOffset(RIBBON_MAX_PULL + 50)).toBe(RIBBON_MAX_PULL);
    expect(clampRibbonOffset(-40)).toBe(-40);
    expect(clampRibbonOffset(-RIBBON_MAX_PUSH - 50)).toBe(-RIBBON_MAX_PUSH);
    expect(clampRibbonOffset(Number.NaN)).toBe(0);
  });

  it('commits a save only for a downward release past the threshold', () => {
    expect(resolveRibbonCommit({ translationY: RIBBON_PULL_THRESHOLD, isBookmarked: false })).toBe(
      'add',
    );
    expect(
      resolveRibbonCommit({ translationY: RIBBON_PULL_THRESHOLD - 1, isBookmarked: false }),
    ).toBe('none');
    // The ribbon is already extended: pulling down must not toggle it off.
    expect(resolveRibbonCommit({ translationY: RIBBON_PULL_THRESHOLD, isBookmarked: true })).toBe(
      'none',
    );
  });

  it('commits a removal only for an upward release on the extended ribbon', () => {
    expect(
      resolveRibbonCommit({ translationY: -RIBBON_RELEASE_THRESHOLD, isBookmarked: true }),
    ).toBe('remove');
    expect(
      resolveRibbonCommit({ translationY: -RIBBON_RELEASE_THRESHOLD + 1, isBookmarked: true }),
    ).toBe('none');
    // Collapsed ribbon: an upward drag means nothing.
    expect(
      resolveRibbonCommit({ translationY: -RIBBON_RELEASE_THRESHOLD, isBookmarked: false }),
    ).toBe('none');
  });

  it('never commits a cancelled gesture, however far it travelled', () => {
    expect(
      resolveRibbonCommit({ translationY: 200, isBookmarked: false, canceled: true }),
    ).toBe('none');
    expect(
      resolveRibbonCommit({ translationY: -200, isBookmarked: true, canceled: true }),
    ).toBe('none');
  });

  it('reports the crossing point for the haptic tick', () => {
    expect(ribbonCrossesThreshold({ translationY: 44, isBookmarked: false })).toBe(true);
    expect(ribbonCrossesThreshold({ translationY: 20, isBookmarked: false })).toBe(false);
  });
});

describe('bookmark ribbon gesture wiring (F24)', () => {
  it('follows the finger during the drag and springs back to rest on release', async () => {
    const { onToggle } = await renderRibbon();

    await act(async () => {
      mockPanConfig.onBegin?.({ translationY: 0 });
      mockPanConfig.onActivate?.({ translationY: 12 });
      mockPanConfig.onUpdate?.({ translationY: 60 });
    });
    // The live shared value (not a rerender) carries the finger position.
    expect(mockSharedSets).toContain(60);

    await act(async () => {
      mockPanConfig.onDeactivate?.({ translationY: 60, canceled: false });
      mockPanConfig.onFinalize?.({ translationY: 60, canceled: false });
    });

    expect(mockWithSpring).toHaveBeenCalledWith(0, expect.anything());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('saves on a downward release past the threshold and ticks the haptic once', async () => {
    const { onToggle } = await renderRibbon();

    await drag([16, 50, 80, 90]);

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(impactAsync).toHaveBeenCalledTimes(1);
  });

  it('commits nothing on a short drag, and does not tick', async () => {
    const { onToggle } = await renderRibbon();

    await drag([12, 30]);

    expect(onToggle).not.toHaveBeenCalled();
    expect(impactAsync).not.toHaveBeenCalled();
    expect(mockWithSpring).toHaveBeenCalledWith(0, expect.anything());
  });

  it('commits nothing when the gesture is cancelled, even after crossing the threshold', async () => {
    const { onToggle } = await renderRibbon();

    await drag([16, 60], { canceled: true });

    expect(onToggle).not.toHaveBeenCalled();
    expect(mockWithSpring).toHaveBeenCalledWith(0, expect.anything());
  });

  it('removes the bookmark on an upward release of the extended ribbon', async () => {
    const { onToggle } = await renderRibbon({ isBookmarked: true });

    await drag([-12, -40, -60]);

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(impactAsync).toHaveBeenCalledTimes(1);
  });

  it('ignores an upward drag while the ribbon is collapsed', async () => {
    const { onToggle } = await renderRibbon({ isBookmarked: false });

    await drag([-12, -60]);

    expect(onToggle).not.toHaveBeenCalled();
    expect(impactAsync).not.toHaveBeenCalled();
  });

  it('ignores a downward drag while the ribbon is extended', async () => {
    const { onToggle } = await renderRibbon({ isBookmarked: true });

    await drag([12, 60]);

    expect(onToggle).not.toHaveBeenCalled();
    expect(impactAsync).not.toHaveBeenCalled();
  });

  it('plays the haptic at most once per gesture', async () => {
    await renderRibbon();

    await drag([16, 50, 70, 90, 95]);
    expect(impactAsync).toHaveBeenCalledTimes(1);

    await drag([16, 60]);
    expect(impactAsync).toHaveBeenCalledTimes(2);
  });

  it('keeps the tap toggle and the accessibility contract', async () => {
    const { getByTestId, onToggle, rerender } = await renderRibbon();

    const ribbon = getByTestId('reader-bookmark-ribbon');
    expect(ribbon.props.accessibilityRole).toBe('button');
    expect(ribbon.props.accessibilityLabel).toBe('حفظ علامة مرجعية');
    expect(ribbon.props.accessibilityState).toEqual({ selected: false });
    expect(ribbon.props.accessibilityHint).toBeTruthy();

    fireEvent.press(ribbon);
    expect(onToggle).toHaveBeenCalledTimes(1);

    await rerender(
      <BookmarkRibbon
        isBookmarked
        color="#8b1e3f"
        onToggle={onToggle}
        hitSlop={10}
        style={{ position: 'absolute', top: 40, width: 34, height: 52 }}
      />,
    );
    expect(getByTestId('reader-bookmark-ribbon').props.accessibilityLabel).toBe(
      'إزالة العلامة المرجعية',
    );
    expect(getByTestId('reader-bookmark-ribbon').props.accessibilityState).toEqual({
      selected: true,
    });
  });
});
