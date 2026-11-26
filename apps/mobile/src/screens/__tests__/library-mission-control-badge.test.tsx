import * as ReactNative from 'react-native';
import { Dimensions } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';

import { LibraryScreen } from '@/screens/library-screen';
import { ensureSampleBookSeeded } from '@/storage/bundle';
import { listBooks } from '@/storage/database';
import { getDefaultMissionControlStore } from '@/storage/mission-control-store';
import { loadThemePreference } from '@/storage/settings-store';
import type { BookLibraryRecord } from '@/types/reader';

const mockPush = jest.fn();

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (cb: () => void) => {
      React.useEffect(() => {
        cb();
      }, [cb]);
    },
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// The global reanimated mock has no `withRepeat`; the Mission Control badge
// pulses with it while jobs are active.
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    View,
    useSharedValue: (initial: number) => {
      const ref = React.useRef({ value: initial });
      return ref.current;
    },
    useAnimatedStyle: (factory: () => Record<string, unknown>) => factory(),
    withTiming: (toValue: number) => toValue,
    withRepeat: (value: number) => value,
    cubicBezier: () => ({}),
    Easing: { bezier: () => () => 0 },
  };
});

jest.mock('@/storage/bundle', () => ({
  ensureSampleBookSeeded: jest.fn(),
  deleteBookBundle: jest.fn(),
}));

jest.mock('@/storage/database', () => ({
  listBooks: jest.fn(),
  getKv: jest.fn(async (_key: string, fallback: unknown) => fallback),
  setKv: jest.fn(async () => undefined),
}));

jest.mock('@/storage/importer', () => ({
  pickAndImportBook: jest.fn(),
}));

jest.mock('@/storage/settings-store', () => {
  const actual = jest.requireActual('@/storage/settings-store');
  return {
    ...actual,
    loadThemePreference: jest.fn(),
    selectManualTheme: jest.fn(),
  };
});

const SAMPLE_RECORD: BookLibraryRecord = {
  id: 'book_sample',
  title: 'أَوْرَاقُ الْبَحْرِ الْقَدِيمِ',
  author: 'مؤلف تجريبي',
  dir: 'rtl',
  coverSeed: 'أَوْرَاقُ الْبَحْرِ الْقَدِيمِ',
  coverColor: '#4E342E',
  progress: 0.35,
  lastOpenedAt: 2000,
  addedAt: 1000,
};

describe('LibraryScreen — Mission Control badge', () => {
  let colorSchemeSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    colorSchemeSpy = jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('light');
    Dimensions.set({
      window: { width: 390, height: 844, scale: 2, fontScale: 1 },
      screen: { width: 390, height: 844, scale: 2, fontScale: 1 },
    });
    (ensureSampleBookSeeded as jest.Mock).mockResolvedValue(true);
    (listBooks as jest.Mock).mockResolvedValue([SAMPLE_RECORD]);
    (loadThemePreference as jest.Mock).mockResolvedValue({
      settings: { theme: 'warraq' },
      hasManualTheme: false,
    });
  });

  afterEach(() => {
    colorSchemeSpy.mockRestore();
  });

  it('mounts the badge in the header, follows the shared store and opens mission control', async () => {
    const store = getDefaultMissionControlStore();
    // Demo seed: one running + one queued + one degraded job.
    expect(store.getActiveJobCount()).toBe(3);

    const { getByTestId } = await render(<LibraryScreen />);

    const header = getByTestId('library-header');
    const badge = within(header).getByTestId('mission-control-badge');
    expect(within(badge).getByTestId('mission-control-badge-count').props.children).toBe('٣');

    // A job that leaves the active set immediately calms the badge down.
    await act(async () => {
      await store.pauseJob('job_tashkeel_water');
    });
    await waitFor(() => {
      expect(
        within(getByTestId('mission-control-badge')).getByTestId('mission-control-badge-count')
          .props.children,
      ).toBe('٢');
    });

    fireEvent.press(getByTestId('mission-control-badge'));
    expect(mockPush).toHaveBeenCalledWith('/mission-control');

    await act(async () => {
      await store.resumeJob('job_tashkeel_water');
    });
  });
});
