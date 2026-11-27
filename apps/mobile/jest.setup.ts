jest.mock('expo-keep-awake', () => ({
  useKeepAwake: jest.fn(),
  activateKeepAwakeAsync: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

// F31 — screen brightness. The real module only works on a device; tests get silent no-ops with
// the same async contract so the reader's `.catch(() => undefined)` guards stay honest.
jest.mock('expo-brightness', () => ({
  getBrightnessAsync: jest.fn(async () => 0.8),
  setBrightnessAsync: jest.fn(async () => undefined),
  getSystemBrightnessAsync: jest.fn(async () => 0.8),
  restoreSystemBrightnessAsync: jest.fn(async () => undefined),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => fn(...args),
}));

jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    GestureHandlerRootView: View,
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    usePanGesture: () => ({}),
    useTapGesture: () => ({}),
    useSimultaneousGestures: () => ({}),
  };
});

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: {
      View,
      createAnimatedComponent: (c: unknown) => c,
    },
    View,
    cubicBezier: () => ({}),
    Easing: { bezier: () => () => 0 },
    useSharedValue: (init: unknown) => ({
      value: init,
      get: () => init,
      set: () => {},
    }),
    useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
    useReducedMotion: () => false,
    withTiming: (toValue: unknown) => toValue,
    withSpring: (toValue: unknown) => toValue,
  };
});

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
  importDatabaseFromAssetAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockWebView = React.forwardRef(
    (props: { testID?: string }, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({
        postMessage: jest.fn(),
      }));
      return React.createElement(View, { testID: props.testID });
    },
  );
  return {
    __esModule: true,
    default: MockWebView,
    WebView: MockWebView,
  };
});

jest.mock('react-native/Libraries/Lists/FlatList', () => {
  const React = require('react');
  const { View } = require('react-native');

  const renderSlot = (
    slot: React.ReactNode | React.ComponentType | undefined,
  ): React.ReactNode => {
    if (!slot) return null;
    if (typeof slot === 'function') {
      const Comp = slot as React.ComponentType;
      return React.createElement(Comp);
    }
    return slot;
  };

  function MockFlatList<T>(props: {
    data?: readonly T[] | null;
    renderItem?: (info: {
      item: T;
      index: number;
      separators: {
        highlight: () => void;
        unhighlight: () => void;
        updateProps: () => void;
      };
    }) => React.ReactNode;
    keyExtractor?: (item: T, index: number) => string;
    ListEmptyComponent?: React.ReactNode | React.ComponentType;
    ListHeaderComponent?: React.ReactNode | React.ComponentType;
    ListFooterComponent?: React.ReactNode | React.ComponentType;
    [key: string]: unknown;
  }) {
    const {
      data,
      renderItem,
      keyExtractor,
      ListEmptyComponent,
      ListHeaderComponent,
      ListFooterComponent,
      ...rest
    } = props;
    const items = Array.isArray(data) ? data : [];
    const noopSeparators = {
      highlight: () => {},
      unhighlight: () => {},
      updateProps: () => {},
    };

    return React.createElement(
      View,
      rest,
      renderSlot(ListHeaderComponent),
      items.length === 0
        ? renderSlot(ListEmptyComponent)
        : items.map((item, index) =>
            React.createElement(
              React.Fragment,
              { key: keyExtractor ? keyExtractor(item, index) : String(index) },
              renderItem ? renderItem({ item, index, separators: noopSeparators }) : null,
            ),
          ),
      renderSlot(ListFooterComponent),
    );
  }

  return {
    __esModule: true,
    default: MockFlatList,
  };
});

jest.mock('react-native/Libraries/Modal/Modal', () => {
  const React = require('react');
  function MockModal(props: { visible?: boolean; children?: React.ReactNode; [key: string]: unknown }) {
    if (props.visible === false) {
      return null;
    }
    return React.createElement('Modal', props, props.children);
  }
  return {
    __esModule: true,
    default: MockModal,
  };
});

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { View, ScrollView } = require('react-native');
  const MockBottomSheet = React.forwardRef(
    (
      props: {
        children?: React.ReactNode;
        backgroundStyle?: unknown;
        index?: number;
        snapPoints?: unknown[];
        [key: string]: unknown;
      },
      ref: React.Ref<{ snapToIndex: (i: number) => void; close: () => void }>,
    ) => {
      React.useImperativeHandle(ref, () => ({
        snapToIndex: jest.fn(),
        close: jest.fn(),
      }));
      if (props.index === -1) return null;
      return React.createElement(
        View,
        { testID: 'mock-bottom-sheet', style: props.backgroundStyle },
        props.children,
      );
    },
  );
  return {
    __esModule: true,
    default: MockBottomSheet,
    BottomSheetScrollView: ScrollView,
    BottomSheetView: View,
  };
});

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const makeSvgMock = (name: string) =>
    function MockSvgElement(props: { children?: React.ReactNode; [key: string]: unknown }) {
      return React.createElement(View, { accessibilityLabel: name, ...props }, props.children);
    };
  return {
    __esModule: true,
    default: makeSvgMock('Svg'),
    Svg: makeSvgMock('Svg'),
    Rect: makeSvgMock('Rect'),
    Circle: makeSvgMock('Circle'),
    Line: makeSvgMock('Line'),
    Path: makeSvgMock('Path'),
    Polygon: makeSvgMock('Polygon'),
    G: makeSvgMock('G'),
  };
});
