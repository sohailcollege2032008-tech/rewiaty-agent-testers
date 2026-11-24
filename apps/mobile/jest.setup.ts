jest.mock('expo-keep-awake', () => ({
  useKeepAwake: jest.fn(),
  activateKeepAwakeAsync: jest.fn(),
  deactivateKeepAwake: jest.fn(),
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
  };
});

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
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
