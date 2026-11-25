import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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
  const palette = getAppThemeTokens(theme);
  const isRtl = dir === 'rtl';
  const [text, setText] = useState(initialNote);

  useEffect(() => {
    if (visible) {
      setText(initialNote);
    }
  }, [visible, initialNote]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable
          testID="highlight-note-backdrop"
          style={[styles.backdrop, { backgroundColor: palette.scrim }]}
          onPress={onCancel}
          accessibilityLabel="إغلاق نافذة الملاحظة"
        />
        <View
          testID="highlight-note-modal"
          style={[
            styles.card,
            {
              backgroundColor: palette.sheetBg,
              borderColor: palette.border,
              marginBottom: Math.max(insets.bottom, 16),
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

          <View style={styles.actions}>
            <Pressable
              testID="highlight-note-cancel"
              onPress={onCancel}
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
              onPress={() => onSave(text.trim())}
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
    minHeight: 96,
    maxHeight: 180,
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
    minHeight: 44,
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
