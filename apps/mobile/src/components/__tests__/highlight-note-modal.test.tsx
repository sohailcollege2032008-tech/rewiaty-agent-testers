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

  const emitKeyboard = async (name: 'keyboardDidShow' | 'keyboardDidHide', height = 0) => {
    await act(async () => {
      for (const cb of listeners.get(name) ?? []) {
        cb({ endCoordinates: { height } });
      }
    });
  };

  it('lifts the modal container above the Android soft keyboard so Save/Cancel stay visible', async () => {
    const { getByTestId } = await render(
      <HighlightNoteModal
        visible
        quote="وكان البحر هادئاً"
        onSave={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    await emitKeyboard('keyboardDidShow', 320);

    const kavStyle = StyleSheet.flatten(getByTestId('highlight-note-kav').props.style);
    expect(kavStyle.paddingBottom).toBeGreaterThanOrEqual(320);

    const saveStyle = StyleSheet.flatten(
      typeof getByTestId('highlight-note-save').props.style === 'function'
        ? getByTestId('highlight-note-save').props.style({ pressed: false })
        : getByTestId('highlight-note-save').props.style,
    );
    expect(saveStyle.minHeight).toBeGreaterThanOrEqual(48);

    await emitKeyboard('keyboardDidHide');
    const collapsedStyle = StyleSheet.flatten(getByTestId('highlight-note-kav').props.style);
    expect(collapsedStyle.paddingBottom).toBeLessThan(100);
  });

  it('dismisses only the keyboard on Android Back/backdrop without closing or wiping the note', async () => {
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

    await fireEvent.changeText(getByTestId('highlight-note-input'), 'ملاحظة مهمة جداً');
    await emitKeyboard('keyboardDidShow', 300);

    // Back press while keyboard is open -> dismiss keyboard ONLY, keep dialog & text
    const modal = getByTestId('highlight-note-native-modal');
    await act(async () => {
      (modal.props.onRequestClose as () => void)();
    });
    expect(dismissSpy).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(getByTestId('highlight-note-input').props.value).toBe('ملاحظة مهمة جداً');

    // Backdrop tap while keyboard is still open -> dismiss keyboard ONLY
    await fireEvent.press(getByTestId('highlight-note-backdrop'));
    expect(dismissSpy).toHaveBeenCalledTimes(2);
    expect(onCancel).not.toHaveBeenCalled();

    // Same-gesture onRequestClose arriving right after keyboardDidHide -> still ignored
    await emitKeyboard('keyboardDidHide');
    await act(async () => {
      (modal.props.onRequestClose as () => void)();
    });
    expect(onCancel).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('prompts before discarding unsaved note when closing after keyboard is dismissed', async () => {
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

  it('closes immediately without confirmation when there are no unsaved changes', async () => {
    const onCancel = jest.fn();
    const { getByTestId } = await render(
      <HighlightNoteModal
        visible
        quote="وكان البحر هادئاً"
        initialNote="ملاحظة قديمة"
        onSave={jest.fn()}
        onCancel={onCancel}
      />,
    );

    await fireEvent.press(getByTestId('highlight-note-cancel'));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
