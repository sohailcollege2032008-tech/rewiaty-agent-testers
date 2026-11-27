import { type ComponentRef, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RADIUS, TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { ThemeId } from '@/types/reader';

export type HighlightNoteModalProps = {
  visible: boolean;
  quote: string;
  initialNote?: string;
  theme?: ThemeId;
  dir?: 'rtl' | 'ltr';
  onSave: (note: string) => void;
  onCancel: () => void;
};

type KeyboardFrame = {
  height: number;
  screenY: number;
};

export function HighlightNoteModal({
  visible,
  quote,
  initialNote = '',
  theme,
  dir = 'rtl',
  onSave,
  onCancel,
}: HighlightNoteModalProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const palette = getAppThemeTokens(theme);
  const isRtl = dir === 'rtl';

  const [text, setText] = useState(initialNote);
  const [containerHeight, setContainerHeight] = useState(0);
  const [keyboardFrame, setKeyboardFrame] = useState<KeyboardFrame>({ height: 0, screenY: 0 });

  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const wasVisibleRef = useRef(false);
  const keyboardVisibleRef = useRef(false);
  const inputFocusedRef = useRef(false);
  const lastKeyboardHideAtRef = useRef(0);

  // Why (Codex P3): reset draft ONLY on the closed -> open transition so a parent re-render
  // passing a refreshed `initialNote` while the modal is open never wipes the reader's draft.
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setText(initialNote);
    } else if (!visible && wasVisibleRef.current) {
      keyboardVisibleRef.current = false;
      inputFocusedRef.current = false;
      lastKeyboardHideAtRef.current = 0;
      setKeyboardFrame({ height: 0, screenY: 0 });
    }
    wasVisibleRef.current = visible;
  }, [visible, initialNote]);

  // Why (P1 #56 + Codex P1): Android <Modal> runs with `adjustResize` on some configs and
  // overlaps the IME on others (`statusBarTranslucent` / edge-to-edge). Tracking both the real
  // modal container height (`onLayout`) and the keyboard frame lets us compute the exact overlap
  // against the modal window itself — lifting the card above the IME when unresized without
  // double-subtracting keyboard height when Android already shrank the modal window.
  useEffect(() => {
    if (!visible) return;
    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      keyboardVisibleRef.current = true;
      const height = Math.max(0, event?.endCoordinates?.height ?? 0);
      const screenY = Math.max(0, event?.endCoordinates?.screenY ?? 0);
      if (Platform.OS === 'android') {
        setKeyboardFrame({ height, screenY });
      }
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      keyboardVisibleRef.current = false;
      lastKeyboardHideAtRef.current = Date.now();
      setKeyboardFrame({ height: 0, screenY: 0 });
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [visible]);

  const handleContainerLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    if (nextHeight > 0) {
      setContainerHeight(nextHeight);
    }
  }, []);

  const hasUnsavedChanges = text.trim() !== initialNote.trim();

  const handleSave = useCallback(() => {
    inputFocusedRef.current = false;
    inputRef.current?.blur();
    Keyboard.dismiss();
    onSave(text.trim());
  }, [onSave, text]);

  const requestCloseWithGuard = useCallback(() => {
    if (!hasUnsavedChanges) {
      onCancel();
      return;
    }
    Alert.alert(
      'الملاحظة لسه ماتحفظتش',
      'تحب تحفظ ملاحظتك قبل ما تقفل؟',
      [
        { text: 'كمّل كتابة', style: 'cancel' },
        { text: 'تجاهل', style: 'destructive', onPress: onCancel },
        { text: 'حفظ', onPress: handleSave },
      ],
      { cancelable: true },
    );
  }, [handleSave, hasUnsavedChanges, onCancel]);

  // Why (P1 #56 + Codex P2): on Android 10 and older with `adjustResize`, `keyboardDidShow`
  // can be omitted. Checking both `keyboardVisibleRef` and `inputFocusedRef` ensures tapping the
  // backdrop or pressing Back while typing always dismisses the IME first instead of closing the
  // dialog and losing the note.
  const dismissImeIfActive = useCallback((): boolean => {
    if (keyboardVisibleRef.current || inputFocusedRef.current) {
      inputFocusedRef.current = false;
      inputRef.current?.blur();
      Keyboard.dismiss();
      return true;
    }
    return false;
  }, []);

  const handleSystemBack = useCallback(() => {
    if (dismissImeIfActive()) return;
    if (Date.now() - lastKeyboardHideAtRef.current < 250) {
      return;
    }
    requestCloseWithGuard();
  }, [dismissImeIfActive, requestCloseWithGuard]);

  const handleBackdropPress = useCallback(() => {
    if (dismissImeIfActive()) return;
    requestCloseWithGuard();
  }, [dismissImeIfActive, requestCloseWithGuard]);

  const effectiveHeight = containerHeight > 0 ? containerHeight : windowHeight;
  let androidKeyboardOverlap = 0;
  if (Platform.OS === 'android' && keyboardFrame.height > 0) {
    const windowShrink = Math.max(0, windowHeight - effectiveHeight);
    const modalAlreadyResized =
      containerHeight > 0 && windowShrink >= Math.max(40, keyboardFrame.height * 0.5);
    if (!modalAlreadyResized) {
      androidKeyboardOverlap =
        keyboardFrame.screenY > 0
          ? Math.max(0, effectiveHeight - keyboardFrame.screenY)
          : keyboardFrame.height;
    }
  }

  const topPadding = Math.max(insets.top, 16);
  const bottomPadding =
    Platform.OS === 'android'
      ? Math.max(androidKeyboardOverlap, insets.bottom) + 12
      : Math.max(insets.bottom, 16);
  // Why (Codex P1): never clamp `maxCardHeight` above the real remaining height, otherwise the
  // pinned Save/Cancel action row can still be pushed outside the visible modal window.
  const availableCardHeight = effectiveHeight - topPadding - bottomPadding - 16;
  const maxCardHeight = availableCardHeight > 0 ? availableCardHeight : undefined;

  return (
    <Modal
      testID="highlight-note-native-modal"
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleSystemBack}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        testID="highlight-note-kav"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kavFlex}
      >
        {/* Inner layout view holds safe-area & Android overlap padding so iOS KeyboardAvoidingView
            never overwrites safe-area `paddingBottom` when the keyboard is closed (Codex P3). */}
        <View
          testID="highlight-note-layout"
          onLayout={handleContainerLayout}
          style={[
            styles.root,
            {
              paddingTop: topPadding,
              paddingBottom: bottomPadding,
            },
          ]}
        >
          <Pressable
            testID="highlight-note-backdrop"
            style={[styles.backdrop, { backgroundColor: palette.scrim }]}
            onPress={handleBackdropPress}
            accessibilityLabel="إغلاق نافذة الملاحظة"
          />
          <View
            testID="highlight-note-modal"
            style={[
              styles.card,
              {
                backgroundColor: palette.sheetBg,
                borderColor: palette.border,
                ...(maxCardHeight !== undefined ? { maxHeight: maxCardHeight } : null),
              },
            ]}
          >
            <Text
              style={[
                styles.title,
                { color: palette.heading ?? palette.text, fontFamily: TYPOGRAPHY.displayFont },
              ]}
            >
              {initialNote.trim() ? 'تعديل الملاحظة' : 'إضافة ملاحظة'}
            </Text>

            <ScrollView
              style={styles.bodyScroll}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
              {quote ? (
                <Text
                  testID="highlight-note-quote"
                  style={[
                    styles.quotePreview,
                    {
                      color: palette.muted,
                      backgroundColor: palette.surface,
                      borderColor: palette.border,
                      fontFamily: TYPOGRAPHY.uiFont,
                      writingDirection: isRtl ? 'rtl' : 'ltr',
                    },
                  ]}
                  numberOfLines={3}
                >
                  {`«${quote}»`}
                </Text>
              ) : null}

              <TextInput
                ref={inputRef}
                testID="highlight-note-input"
                value={text}
                onChangeText={setText}
                onFocus={() => {
                  inputFocusedRef.current = true;
                }}
                onBlur={() => {
                  inputFocusedRef.current = false;
                }}
                placeholder="اكتب ملاحظتك هنا…"
                placeholderTextColor={palette.muted}
                multiline
                autoFocus
                style={[
                  styles.input,
                  {
                    color: palette.text,
                    backgroundColor: palette.surface,
                    borderColor: palette.border,
                    fontFamily: TYPOGRAPHY.uiFont,
                    textAlign: isRtl ? 'right' : 'left',
                  },
                ]}
                accessibilityLabel="نص الملاحظة"
              />
            </ScrollView>

            <View style={styles.actions}>
              <Pressable
                testID="highlight-note-cancel"
                onPress={requestCloseWithGuard}
                style={({ pressed }) => [
                  styles.btn,
                  styles.cancelBtn,
                  { borderColor: palette.border, backgroundColor: palette.surface },
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="إلغاء"
              >
                <Text style={[styles.btnText, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}>
                  إلغاء
                </Text>
              </Pressable>
              <Pressable
                testID="highlight-note-save"
                onPress={handleSave}
                style={({ pressed }) => [
                  styles.btn,
                  { backgroundColor: palette.ctaBg },
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="حفظ الملاحظة"
              >
                <Text
                  style={[styles.btnText, { color: palette.ctaText, fontFamily: TYPOGRAPHY.uiFont }]}
                >
                  حفظ
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kavFlex: {
    flex: 1,
  },
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    padding: 18,
    gap: 12,
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
    boxShadow: '0 14px 36px rgba(0, 0, 0, 0.28)',
  },
  bodyScroll: {
    flexShrink: 1,
  },
  bodyContent: {
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
  },
  quotePreview: {
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    textAlign: 'right',
  },
  input: {
    minHeight: 72,
    maxHeight: 160,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14.5,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  btn: {
    minWidth: 88,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: RADIUS.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    borderWidth: 1,
  },
  btnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.78,
  },
});
