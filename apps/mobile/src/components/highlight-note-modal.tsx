import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardVisibleRef = useRef(false);
  const lastKeyboardHideAtRef = useRef(0);

  useEffect(() => {
    if (visible) {
      setText(initialNote);
    } else {
      keyboardVisibleRef.current = false;
      lastKeyboardHideAtRef.current = 0;
      setKeyboardHeight(0);
    }
  }, [visible, initialNote]);

  // Why (P1 #56): Android transparent <Modal statusBarTranslucent> does not resize with
  // adjustResize, so KeyboardAvoidingView alone leaves Save/Cancel buried under the IME on
  // compact screens and larger font scales. Tracking the real keyboard height lifts the card
  // cleanly above the keyboard on Android without double-padding iOS.
  useEffect(() => {
    if (!visible) return;
    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      keyboardVisibleRef.current = true;
      const nextHeight = event?.endCoordinates?.height ?? 0;
      if (Platform.OS === 'android') {
        setKeyboardHeight(Math.max(0, nextHeight));
      }
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      keyboardVisibleRef.current = false;
      lastKeyboardHideAtRef.current = Date.now();
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [visible]);

  const hasUnsavedChanges = text.trim() !== initialNote.trim();

  const handleSave = useCallback(() => {
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

  // Why (P1 #56): pressing Back or tapping outside while the keyboard is up is how readers
  // dismiss the keyboard — it must NEVER close the dialog and wipe their typed note.
  // Also absorb a same-gesture onRequestClose arriving right after keyboardDidHide on Android.
  const handleSystemBack = useCallback(() => {
    if (keyboardVisibleRef.current) {
      Keyboard.dismiss();
      return;
    }
    if (Date.now() - lastKeyboardHideAtRef.current < 250) {
      return;
    }
    requestCloseWithGuard();
  }, [requestCloseWithGuard]);

  const handleBackdropPress = useCallback(() => {
    if (keyboardVisibleRef.current) {
      Keyboard.dismiss();
      return;
    }
    requestCloseWithGuard();
  }, [requestCloseWithGuard]);

  const bottomPadding =
    Platform.OS === 'android'
      ? Math.max(keyboardHeight, insets.bottom) + 12
      : Math.max(insets.bottom, 16);
  const topPadding = Math.max(insets.top, 16);
  const maxCardHeight = Math.max(220, windowHeight - topPadding - bottomPadding - 16);

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
              maxHeight: maxCardHeight,
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
              testID="highlight-note-input"
              value={text}
              onChangeText={setText}
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
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    minHeight: 88,
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
