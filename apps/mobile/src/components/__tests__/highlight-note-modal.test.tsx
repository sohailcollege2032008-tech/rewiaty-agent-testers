import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, Keyboard, Platform, StyleSheet } from 'react-native';

import { HighlightNoteModal } from '../highlight-note-modal';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));

describe('HighlightNoteModal (P1 #56)', () => {
  const listeners = new Map<string, Set<(event?: unknown) => void>>();
  let addListenerSpy: jest.SpyInstance;
  let dismissSpy: jest.SpyInstance;
  let alertSpy: jest.SpyInstance;
  const originalOs = Platform.OS;

  beforeEach(() => {
    listeners.clear();
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    addListenerSpy = jest
      .spyOn(Keyboard, 'addListener')
      .mockImplementation((eventName, callback) => {
        const set = listeners.get(eventName) ?? new Set();
        set.add(callback as (event?: unknown) => void);
        listeners.set(eventName, set);
        return {
          remove: () => {
            set.delete(callback as (event?: unknown) => void);
          },
        } as ReturnType<typeof Keyboard.addListener>;
      });
    dismissSpy = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    addListenerSpy.mockRestore();
    dismissSpy.mockRestore();
    alertSpy.mockRestore();
    Object.defineProperty(Platform, 'OS', { value: originalOs, configurable: true });
  });

  const emitKeyboard = async (
    name: 'keyboardDidShow' | 'keyboardDidHide',
    height = 0,
    screenY = 0,
  ) => {
    await act(async () => {
      for (const cb of listeners.get(name) ?? []) {
        cb({ endCoordinates: { height, screenY } });
      }
    });
  };

  it('lifts unresized Android modal by exact keyboard overlap and avoids double-padding when adjustResize shrinks the modal (Codex P1)', async () => {
    const { getByTestId } = await render(
      <HighlightNoteModal
        visible
        quote="وكان البحر هادئاً"
        onSave={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    // Case 1: unresized translucent modal (container height == full window height ~1334 in jest)
    await emitKeyboard('keyboardDidShow', 320, 0);
    const unresizedLayout = StyleSheet.flatten(getByTestId('highlight-note-layout').props.style);
    expect(unresizedLayout.paddingBottom).toBeGreaterThanOrEqual(320);

    const saveStyle = StyleSheet.flatten(
      typeof getByTestId('highlight-note-save').props.style === 'function'
        ? getByTestId('highlight-note-save').props.style({ pressed: false })
        : getByTestId('highlight-note-save').props.style,
    );
    expect(saveStyle.minHeight).toBeGreaterThanOrEqual(48);

    // Case 2: Android adjustResize already shrank the Modal container to 420dp -> ZERO double-padding
    await fireEvent(getByTestId('highlight-note-layout'), 'layout', {
      nativeEvent: { layout: { width: 360, height: 420 } },
    });
    const resizedLayout = StyleSheet.flatten(getByTestId('highlight-note-layout').props.style);
    expect(resizedLayout.paddingBottom).toBe(28); // insets.bottom (16) + 12, not 332!
    const resizedCard = StyleSheet.flatten(getByTestId('highlight-note-modal').props.style);
    expect(resizedCard.maxHeight).toBeLessThanOrEqual(420 - 24 - 28 - 16);

    await emitKeyboard('keyboardDidHide');
    const collapsedLayout = StyleSheet.flatten(getByTestId('highlight-note-layout').props.style);
    expect(collapsedLayout.paddingBottom).toBe(28);
  });

  it('dismisses only the keyboard on Back/backdrop even when keyboardDidShow was omitted (Android 10, Codex P2)', async () => {
    const onCancel = jest.fn();
    const onSave = jest.fn();
    const { getByTestId } = await render(
      <HighlightNoteModal
        visible
        quote="وكان البحر هادئاً"
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    await fireEvent(getByTestId('highlight-note-input'), 'focus');
    await fireEvent.changeText(getByTestId('highlight-note-input'), 'ملاحظة مهمة جداً');

    // No keyboardDidShow emitted, yet input is focused -> backdrop tap dismisses keyboard ONLY
    await fireEvent.press(getByTestId('highlight-note-backdrop'));
    expect(dismissSpy).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(getByTestId('highlight-note-input').props.value).toBe('ملاحظة مهمة جداً');

    // Back press while keyboardDidShow IS active -> dismisses keyboard ONLY
    await emitKeyboard('keyboardDidShow', 300);
    const modal = getByTestId('highlight-note-native-modal');
    await act(async () => {
      (modal.props.onRequestClose as () => void)();
    });
    expect(dismissSpy).toHaveBeenCalledTimes(2);
    expect(onCancel).not.toHaveBeenCalled();

    // Same-gesture onRequestClose right after keyboardDidHide -> still ignored
    await emitKeyboard('keyboardDidHide');
    await act(async () => {
      (modal.props.onRequestClose as () => void)();
    });
    expect(onCancel).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('prompts before discarding unsaved note and preserves safe-area padding on iOS (Codex P3)', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const onCancel = jest.fn();
    const onSave = jest.fn();
    const { getByTestId } = await render(
      <HighlightNoteModal
        visible
        quote="وكان البحر هادئاً"
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    // Safe-area padding lives on inner layout view, not KeyboardAvoidingView
    const iosLayout = StyleSheet.flatten(getByTestId('highlight-note-layout').props.style);
    expect(iosLayout.paddingBottom).toBe(16);

    await fireEvent.changeText(getByTestId('highlight-note-input'), 'مسودة لم تُحفظ');
    await fireEvent.press(getByTestId('highlight-note-cancel'));

    expect(onCancel).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledTimes(1);

    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    const saveBtn = buttons.find((b) => b.text === 'حفظ');
    expect(saveBtn).toBeDefined();
    await act(async () => {
      saveBtn?.onPress?.();
    });
    expect(onSave).toHaveBeenCalledWith('مسودة لم تُحفظ');
  });

  it('preserves draft if initialNote changes while open, and resets on close/reopen (Codex P3)', async () => {
    const onCancel = jest.fn();
    const { getByTestId, rerender } = await render(
      <HighlightNoteModal
        visible
        quote="وكان البحر هادئاً"
        initialNote="ملاحظة قديمة"
        onSave={jest.fn()}
        onCancel={onCancel}
      />,
    );

    await fireEvent.changeText(getByTestId('highlight-note-input'), 'تعديل جاري');
    // Parent re-renders with updated initialNote while modal is still visible -> keep draft!
    await rerender(
      <HighlightNoteModal
        visible
        quote="وكان البحر هادئاً"
        initialNote="نسخة أخرى"
        onSave={jest.fn()}
        onCancel={onCancel}
      />,
    );
    expect(getByTestId('highlight-note-input').props.value).toBe('تعديل جاري');

    // Close and reopen -> resets cleanly to current initialNote
    await rerender(
      <HighlightNoteModal
        visible={false}
        quote="وكان البحر هادئاً"
        initialNote="نسخة أخرى"
        onSave={jest.fn()}
        onCancel={onCancel}
      />,
    );
    await rerender(
      <HighlightNoteModal
        visible
        quote="وكان البحر هادئاً"
        initialNote="نسخة أخرى"
        onSave={jest.fn()}
        onCancel={onCancel}
      />,
    );
    expect(getByTestId('highlight-note-input').props.value).toBe('نسخة أخرى');

    // Closing with no edits closes immediately without confirmation
    await fireEvent.press(getByTestId('highlight-note-cancel'));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
