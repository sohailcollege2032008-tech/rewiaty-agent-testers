import * as ReactNative from 'react-native';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';

import { MissionControlBadge } from '@/components/mission-control-badge';
import { MissionControlScreen, formatUsd } from '@/screens/mission-control-screen';
import {
  DEGRADED_BANNER_MESSAGE_AR,
  createMissionControlStore,
  type MissionControlAdapter,
  type MissionJob,
  type UsageEntry,
} from '@/storage/mission-control-store';

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

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
  };
});

const NOW = new Date(2026, 10, 26, 10, 30).getTime();
const NOV = '2026-11';

function makeJob(over: Partial<MissionJob> = {}): MissionJob {
  return {
    id: 'job_1',
    bookId: 'book_a',
    bookTitle: 'حجر الماء',
    kind: 'pdf-convert',
    status: 'running',
    progress: 0.42,
    detailAr: 'تحويل الصفحات',
    createdAt: NOW - 60_000,
    updatedAt: NOW - 1_000,
    ...over,
  };
}

function makeUsage(over: Partial<UsageEntry> = {}): UsageEntry {
  return {
    id: 'usage_1',
    bookId: 'book_a',
    bookTitle: 'حجر الماء',
    monthKey: NOV,
    channel: 'text',
    costUsd: 0.3,
    units: 3,
    createdAt: NOW - 5_000,
    ...over,
  };
}

const NOV_USAGE: UsageEntry[] = [
  makeUsage({ id: 'u1', channel: 'text', costUsd: 0.3, units: 3 }),
  makeUsage({ id: 'u2', channel: 'image', costUsd: 0.1, units: 1 }),
  makeUsage({
    id: 'u3',
    bookId: 'book_b',
    bookTitle: 'باب الحكايات',
    channel: 'image',
    costUsd: 0.25,
    units: 2,
  }),
];

function buildStore(
  jobs: MissionJob[],
  usage: UsageEntry[] = NOV_USAGE,
  adapterOverrides: Partial<MissionControlAdapter> = {},
) {
  const adapter: MissionControlAdapter = {
    fetchJobs: jest.fn(async () => jobs),
    pauseJob: jest.fn(async () => undefined),
    resumeJob: jest.fn(async () => undefined),
    fetchUsage: jest.fn(async () => usage),
    ...adapterOverrides,
  };
  const store = createMissionControlStore(adapter, {
    initialJobs: jobs,
    initialUsage: usage,
    now: () => NOW,
  });
  return { adapter, store };
}

describe('MissionControlScreen', () => {
  let colorSchemeSpy: jest.SpyInstance;
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    colorSchemeSpy = jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('light');
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    colorSchemeSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it('renders the Arabic header, active count pill, job cards and progress', async () => {
    const { store } = buildStore([
      makeJob({ id: 'job_1', status: 'running', progress: 0.42 }),
      makeJob({
        id: 'job_2',
        bookTitle: 'باب الحكايات',
        kind: 'image-gen',
        status: 'queued',
        progress: 0,
      }),
      makeJob({ id: 'job_3', status: 'completed', progress: 1 }),
    ]);

    const screen = await render(<MissionControlScreen store={store} now={() => NOW} />);

    expect(screen.getByText('مركز المهام')).toBeTruthy();
    expect(screen.getByTestId('mission-control-active-pill')).toBeTruthy();
    expect(screen.getByTestId('mission-control-back-button')).toBeTruthy();

    const firstCard = screen.getByTestId('job-card-job_1');
    expect(within(firstCard).getByText('حجر الماء')).toBeTruthy();
    expect(within(firstCard).getByText(/تحويل PDF/)).toBeTruthy();
    expect(within(firstCard).getByText('جارٍ التنفيذ')).toBeTruthy();
    expect(screen.getByTestId('job-progress-job_1')).toBeTruthy();

    const secondCard = screen.getByTestId('job-card-job_2');
    expect(within(secondCard).getByText(/توليد صور/)).toBeTruthy();
    expect(within(secondCard).getByText('في قائمة الانتظار')).toBeTruthy();

    expect(screen.queryByTestId('job-card-job_3')).toBeNull();
    expect(screen.queryByTestId('mission-control-degraded-banner')).toBeNull();
  });

  it('switches a running job to paused and back through the calm pause/resume buttons', async () => {
    const { adapter, store } = buildStore([makeJob({ id: 'job_1', status: 'running' })]);
    const screen = await render(<MissionControlScreen store={store} now={() => NOW} />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('job-pause-job_1'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(adapter.pauseJob).toHaveBeenCalledWith('job_1');
      expect(screen.getByTestId('job-resume-job_1')).toBeTruthy();
    });
    expect(screen.queryByTestId('job-pause-job_1')).toBeNull();
    expect(within(screen.getByTestId('job-status-job_1')).getByText('متوقف مؤقتاً')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('job-resume-job_1'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(adapter.resumeJob).toHaveBeenCalledWith('job_1');
      expect(screen.getByTestId('job-pause-job_1')).toBeTruthy();
    });
    expect(within(screen.getByTestId('job-status-job_1')).getByText('جارٍ التنفيذ')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('degrades gracefully with the warm Arabic banner and never raises an alert', async () => {
    const { store } = buildStore(
      [makeJob({ id: 'job_1', status: 'running', progress: 0.42 })],
      NOV_USAGE,
      {
        pauseJob: jest.fn(async () => {
          throw new Error('HTTP 429 Too Many Requests: rate limit exceeded');
        }),
      },
    );

    const screen = await render(<MissionControlScreen store={store} now={() => NOW} />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('job-pause-job_1'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('mission-control-degraded-banner')).toBeTruthy();
    });

    expect(screen.getByText(DEGRADED_BANNER_MESSAGE_AR)).toBeTruthy();
    expect(within(screen.getByTestId('job-status-job_1')).getByText('في قائمة الانتظار')).toBeTruthy();
    expect(screen.queryByText(/429|rate limit|HTTP/i)).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mission-control-error-dialog')).toBeNull();
  });

  it('shows the calm empty state when nothing is running', async () => {
    const { store } = buildStore([makeJob({ id: 'job_3', status: 'completed', progress: 1 })]);
    const screen = await render(<MissionControlScreen store={store} now={() => NOW} />);

    expect(screen.getByTestId('mission-control-empty-state')).toBeTruthy();
    expect(screen.getByText('مفيش مهام جارية دلوقتي')).toBeTruthy();
  });

  it('splits monthly usage into total, text and images with a visual bar', async () => {
    const { store } = buildStore([makeJob({ id: 'job_1', status: 'running' })]);
    const screen = await render(<MissionControlScreen store={store} now={() => NOW} />);

    const summary = screen.getByTestId('usage-summary-card');
    expect(within(summary).getByText('نوفمبر ٢٠٢٦')).toBeTruthy();
    expect(within(summary).getByText('$0.65')).toBeTruthy();
    expect(within(summary).getByText('$0.30')).toBeTruthy();
    expect(within(summary).getByText('$0.35')).toBeTruthy();
    expect(within(summary).getByText('النص')).toBeTruthy();
    expect(within(summary).getByText('الصور')).toBeTruthy();
    expect(screen.getByTestId('usage-bar-text')).toBeTruthy();
    expect(screen.getByTestId('usage-bar-image')).toBeTruthy();
  });

  it('lists per-book text vs image spend', async () => {
    const { store } = buildStore([makeJob({ id: 'job_1', status: 'running' })]);
    const screen = await render(<MissionControlScreen store={store} now={() => NOW} />);

    const bookA = screen.getByTestId('usage-book-book_a');
    expect(within(bookA).getByText('حجر الماء')).toBeTruthy();
    expect(within(bookA).getByText('$0.40')).toBeTruthy();
    expect(within(bookA).getByText(/النص/)).toBeTruthy();
    expect(within(bookA).getByText(/الصور/)).toBeTruthy();

    const bookB = screen.getByTestId('usage-book-book_b');
    expect(within(bookB).getByText('باب الحكايات')).toBeTruthy();
    expect(within(bookB).getByText('$0.25')).toBeTruthy();
  });

  it('formats tiny positive amounts as less than a cent and exact zero as $0.00', () => {
    expect(formatUsd(0.003)).toBe('أقل من $0.01');
    expect(formatUsd(0.012)).toBe('$0.01');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(Number.NaN)).toBe('$0.00');
  });

  it('shows three sub-cent entries as $0.01 on the monthly total', async () => {
    const subCent = [0, 1, 2].map((index) =>
      makeUsage({ id: `sub_${index}`, channel: 'text', costUsd: 0.004, units: 1 }),
    );
    const { store } = buildStore([makeJob({ id: 'job_1', status: 'running' })], subCent);
    const screen = await render(<MissionControlScreen store={store} now={() => NOW} />);

    const summary = screen.getByTestId('usage-summary-card');
    expect(within(summary).getByTestId('usage-total').props.children).toBe('$0.01');
  });

  it('labels a single sub-cent entry as less than a cent instead of $0.00', async () => {
    const { store } = buildStore(
      [makeJob({ id: 'job_1', status: 'running' })],
      [makeUsage({ id: 'tiny', channel: 'text', costUsd: 0.003, units: 1 })],
    );
    const screen = await render(<MissionControlScreen store={store} now={() => NOW} />);

    const summary = screen.getByTestId('usage-summary-card');
    expect(within(summary).getByTestId('usage-total').props.children).toBe('أقل من $0.01');

    const bookRow = screen.getByTestId('usage-book-book_a');
    expect(within(bookRow).getAllByText('أقل من $0.01').length).toBeGreaterThan(0);
  });

  it('shows a calm usage empty state when the month has no spend', async () => {    const { store } = buildStore([makeJob({ id: 'job_1', status: 'running' })], []);
    const screen = await render(<MissionControlScreen store={store} now={() => NOW} />);

    expect(screen.getByTestId('usage-empty-state')).toBeTruthy();
    expect(screen.getByText('لسه مفيش استهلاك الشهر ده')).toBeTruthy();
  });

  it('navigates back from the header', async () => {
    const { store } = buildStore([makeJob({ id: 'job_1', status: 'running' })]);
    const screen = await render(<MissionControlScreen store={store} now={() => NOW} />);

    fireEvent.press(screen.getByTestId('mission-control-back-button'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('MissionControlBadge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the pulsing dot, count and accessible Arabic label while work is active', async () => {
    const screen = await render(<MissionControlBadge activeCount={2} />);

    const badge = screen.getByTestId('mission-control-badge');
    expect(screen.getByTestId('mission-control-pulse-dot')).toBeTruthy();
    expect(screen.getByTestId('mission-control-badge-count')).toBeTruthy();
    expect(badge.props.accessibilityLabel).toBe('مركز المهام — 2 مهام جارية');

    fireEvent.press(badge);
    expect(mockPush).toHaveBeenCalledWith('/mission-control');
  });

  it('rests calmly without a pulse dot or count when there is no active work', async () => {
    const screen = await render(<MissionControlBadge activeCount={0} />);

    const badge = screen.getByTestId('mission-control-badge');
    expect(screen.queryByTestId('mission-control-pulse-dot')).toBeNull();
    expect(screen.queryByTestId('mission-control-badge-count')).toBeNull();
    expect(badge.props.accessibilityLabel).toBe('مركز المهام');

    fireEvent.press(badge);
    expect(mockPush).toHaveBeenCalledWith('/mission-control');
  });

  it('prefers an explicit onPress over navigation', async () => {
    const onPress = jest.fn();
    const screen = await render(<MissionControlBadge activeCount={1} onPress={onPress} />);

    fireEvent.press(screen.getByTestId('mission-control-badge'));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
