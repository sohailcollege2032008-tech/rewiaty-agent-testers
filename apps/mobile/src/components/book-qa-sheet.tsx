import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { BookQaCitation } from '@/api/types';
import {
  STRICT_QA_GENERIC_ERROR_MESSAGE_AR,
  STRICT_QA_NO_BYOK_MESSAGE_AR,
} from '@/storage/strict-qa';
import { RADIUS, TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { ThemeId } from '@/types/reader';

/** Default quick starters: a plot recap and a spoiler-safe character list. */
export const BOOK_QA_QUICK_PROMPTS_AR = [
  'ملخص اللي قريته لحد هنا',
  'مين الشخصيات اللي ظهرت لحد دلوقتي؟',
] as const;

export const BOOK_QA_TITLE_AR = 'اسأل عن الكتاب';
export const BOOK_QA_SUBTITLE_AR = 'إجابات من النص اللي قريته بس — بدون حرق';
export const BOOK_QA_INPUT_PLACEHOLDER_AR = 'اكتب سؤالك عن اللي قريته لحد هنا…';
export const BOOK_QA_ASK_LABEL_AR = 'اسأل';
export const BOOK_QA_THINKING_AR = 'بندوّر في اللي قريته لحد هنا…';
export const BOOK_QA_SETTINGS_LABEL_AR = 'افتح إعدادات الذكاء الاصطناعي';
export const BOOK_QA_EMPTY_QUESTION_AR = 'اكتب سؤالك الأول.';
const STRICT_QA_OFFLINE_HINT_AR = 'السؤال محتاج إنترنت.';

export type BookQaAnswerView =
  | { status: 'ok'; answer: string; citations: BookQaCitation[]; costUsd: number }
  | { status: 'no_byok' | 'offline' | 'empty_context' | 'error'; messageAr: string };

export type BookQaSheetProps = {
  visible: boolean;
  /** Title of the chapter the reader is currently in — the visible cutoff. */
  chapterTitle: string;
  theme?: ThemeId | null;
  /** When false the sheet answers the tap with the calm "add your key" prompt. */
  byokConfigured?: boolean;
  offline?: boolean;
  quickPrompts?: readonly string[];
  onAsk: (question: string) => Promise<BookQaAnswerView>;
  onClose: () => void;
  onOpenSettings?: () => void;
};

function formatCostUsd(costUsd: number): string {
  const safe = Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0;
  return `$${safe.toFixed(4)}`;
}

function truncateQuote(quote: string, max = 110): string {
  const text = typeof quote === 'string' ? quote.trim() : '';
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

/**
 * F49 — «اسأل عن الكتاب (بدون حرق)».
 *
 * A calm bottom sheet that proves its own boundary: the badge names the chapter the reader has
 * reached, and the answer card shows citations from the text that was actually sent. The sheet
 * is presentational — the reader screen owns the strict-index ask and returns a view model.
 */
export function BookQaSheet({
  visible,
  chapterTitle,
  theme,
  byokConfigured = true,
  offline = false,
  quickPrompts = BOOK_QA_QUICK_PROMPTS_AR,
  onAsk,
  onClose,
  onOpenSettings,
}: BookQaSheetProps) {
  const insets = useSafeAreaInsets();
  const palette = getAppThemeTokens(theme);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<BookQaAnswerView | null>(null);

  useEffect(() => {
    if (!visible) {
      setQuestion('');
      setPending(false);
      setAnswer(null);
    }
  }, [visible]);

  const runAsk = async (raw: string) => {
    if (pending) return;
    const trimmed = raw.trim();
    if (!trimmed) {
      setAnswer({ status: 'error', messageAr: BOOK_QA_EMPTY_QUESTION_AR });
      return;
    }

    setAnswer(null);
    // A missing key is knowable before any network work — answer the tap with the static prompt.
    if (byokConfigured === false) {
      setAnswer({ status: 'no_byok', messageAr: STRICT_QA_NO_BYOK_MESSAGE_AR });
      return;
    }

    setPending(true);
    try {
      const view = await onAsk(trimmed);
      setAnswer(view);
    } catch {
      // The screen maps failures already; this is a last-resort guard (and never echoes an error).
      setAnswer({ status: 'error', messageAr: STRICT_QA_GENERIC_ERROR_MESSAGE_AR });
    } finally {
      setPending(false);
    }
  };

  const handleClose = () => {
    if (pending) return;
    onClose();
  };

  const answerMessage = answer && answer.status !== 'ok' ? answer.messageAr : null;
  const showSettingsPrompt = answer?.status === 'no_byok' && Boolean(onOpenSettings);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.root} testID="book-qa-sheet">
        <Pressable
          testID="book-qa-backdrop"
          style={[styles.backdrop, { backgroundColor: palette.scrim }]}
          onPress={handleClose}
          accessibilityLabel="إغلاق سؤال الكتاب"
        />

        <View
          style={[
            styles.sheet,
            {
              backgroundColor: palette.sheetBg,
              borderColor: palette.border,
              paddingBottom: Math.max(insets.bottom, 18) + 8,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: palette.muted }]} />

          <View style={styles.headerRow}>
            <View style={styles.titleBlock}>
              <Text
                style={[
                  styles.title,
                  { color: palette.heading ?? palette.text, fontFamily: TYPOGRAPHY.displayFont },
                ]}
              >
                {BOOK_QA_TITLE_AR}
              </Text>
              <Text
                style={[styles.subtitle, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
              >
                {BOOK_QA_SUBTITLE_AR}
              </Text>
            </View>
            <Pressable
              testID="book-qa-close"
              onPress={handleClose}
              hitSlop={12}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="إغلاق"
            >
              <Text style={[styles.closeGlyph, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
                ✕
              </Text>
            </Pressable>
          </View>

          <View
            testID="book-qa-spoiler-badge"
            style={[
              styles.badge,
              { backgroundColor: palette.accentSoft, borderColor: palette.border },
            ]}
          >
            <Text
              style={[styles.badgeText, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}
            >
              {`النطاق المسموح: حتى ${chapterTitle || 'مكانك الحالي'} — بدون حرق للأحداث الجاية`}
            </Text>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.chipsRow}>
              {quickPrompts.map((prompt, index) => (
                <Pressable
                  key={prompt}
                  testID={`book-qa-quick-${index}`}
                  onPress={() => {
                    setQuestion(prompt);
                    void runAsk(prompt);
                  }}
                  disabled={pending}
                  style={({ pressed }) => [
                    styles.chip,
                    { backgroundColor: palette.chipBg, borderColor: palette.border },
                    pressed && styles.pressed,
                    pending && styles.disabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={prompt}
                >
                  <Text
                    style={[styles.chipText, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
                  >
                    {prompt}
                  </Text>
                </Pressable>
              ))}
            </View>

            {byokConfigured === false ? (
              <View
                testID="book-qa-byok-hint"
                style={[
                  styles.messageBox,
                  { backgroundColor: palette.chipBg, borderColor: palette.border },
                ]}
              >
                <Text
                  style={[styles.messageText, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
                >
                  {STRICT_QA_NO_BYOK_MESSAGE_AR}
                </Text>
                {onOpenSettings ? (
                  <Pressable
                    testID="book-qa-byok-hint-settings"
                    onPress={onOpenSettings}
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      { borderColor: palette.accent },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={BOOK_QA_SETTINGS_LABEL_AR}
                  >
                    <Text
                      style={[
                        styles.secondaryButtonText,
                        { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont },
                      ]}
                    >
                      {BOOK_QA_SETTINGS_LABEL_AR}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <TextInput
              testID="book-qa-input"
              value={question}
              onChangeText={setQuestion}
              editable={!pending}
              placeholder={BOOK_QA_INPUT_PLACEHOLDER_AR}
              placeholderTextColor={palette.muted}
              multiline
              maxLength={2000}
              textAlign="right"
              textAlignVertical="top"
              style={[
                styles.input,
                {
                  color: palette.text,
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                  fontFamily: TYPOGRAPHY.uiFont,
                },
              ]}
              accessibilityLabel={BOOK_QA_INPUT_PLACEHOLDER_AR}
            />

            <Pressable
              testID="book-qa-ask-button"
              onPress={() => void runAsk(question)}
              disabled={pending}
              style={({ pressed }) => [
                styles.askButton,
                { backgroundColor: palette.ctaBg },
                pressed && styles.pressed,
                pending && styles.disabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={BOOK_QA_ASK_LABEL_AR}
            >
              {pending ? (
                <ActivityIndicator size="small" color={palette.ctaText} />
              ) : (
                <Text
                  style={[
                    styles.askButtonText,
                    { color: palette.ctaText, fontFamily: TYPOGRAPHY.uiFont },
                  ]}
                >
                  {BOOK_QA_ASK_LABEL_AR}
                </Text>
              )}
            </Pressable>

            {offline ? (
              <Text
                testID="book-qa-offline-hint"
                style={[styles.subtleHint, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
              >
                {STRICT_QA_OFFLINE_HINT_AR}
              </Text>
            ) : null}

            {pending ? (
              <View testID="book-qa-loading" style={styles.stateBox}>
                <Text style={[styles.stateText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
                  {BOOK_QA_THINKING_AR}
                </Text>
              </View>
            ) : null}

            {answerMessage ? (
              <View
                testID="book-qa-message"
                style={[
                  styles.messageBox,
                  { backgroundColor: palette.chipBg, borderColor: palette.border },
                ]}
              >
                <Text
                  style={[styles.messageText, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
                >
                  {answerMessage}
                </Text>
                {showSettingsPrompt ? (
                  <Pressable
                    testID="book-qa-settings-button"
                    onPress={onOpenSettings}
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      { borderColor: palette.accent },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={BOOK_QA_SETTINGS_LABEL_AR}
                  >
                    <Text
                      style={[
                        styles.secondaryButtonText,
                        { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont },
                      ]}
                    >
                      {BOOK_QA_SETTINGS_LABEL_AR}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {answer?.status === 'ok' ? (
              <View
                testID="book-qa-answer"
                style={[
                  styles.answerCard,
                  { backgroundColor: palette.surface, borderColor: palette.border },
                ]}
              >
                <Text
                  testID="book-qa-answer-text"
                  style={[styles.answerText, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
                >
                  {answer.answer}
                </Text>

                {(() => {
                  const citations = answer.citations ?? [];
                  return citations.length > 0 ? (
                    <View testID="book-qa-citations" style={styles.citations}>
                      {citations.map((citation, index) => (
                        <View
                          key={`${citation.block_id}-${index}`}
                          testID={`book-qa-citation-${index}`}
                          style={[styles.citation, { borderRightColor: palette.accent }]}
                        >
                          <Text
                            style={[
                              styles.citationQuote,
                              { color: palette.text, fontFamily: TYPOGRAPHY.uiFont },
                            ]}
                          >
                            {truncateQuote(citation.quote)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null;
                })()}

                <View style={styles.costRow}>
                  <Text
                    testID="book-qa-cost"
                    style={[styles.costBadge, { color: palette.accent, backgroundColor: palette.accentSoft }]}
                  >
                    {`التكلفة ${formatCostUsd(answer.costUsd)}`}
                  </Text>
                </View>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Local copy of the offline sentence (imported separately to keep this file free of ask logic). */
const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
    borderTopWidth: 1,
    paddingTop: 10,
    paddingHorizontal: 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    opacity: 0.45,
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 10,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.button,
  },
  closeGlyph: {
    fontSize: 16,
    fontWeight: '700',
  },
  badge: {
    borderRadius: RADIUS.button,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  badgeText: {
    fontSize: 12.5,
    lineHeight: 19,
    fontWeight: '600',
    textAlign: 'right',
  },
  body: {
    gap: 12,
    paddingBottom: 14,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: {
    fontSize: 12.5,
    lineHeight: 19,
    fontWeight: '600',
  },
  input: {
    minHeight: 76,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 23,
  },
  askButton: {
    minHeight: 48,
    borderRadius: RADIUS.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  askButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  subtleHint: {
    fontSize: 11.5,
    lineHeight: 17,
    textAlign: 'right',
  },
  stateBox: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  stateText: {
    fontSize: 13.5,
    lineHeight: 21,
    textAlign: 'center',
  },
  messageBox: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  messageText: {
    fontSize: 13.5,
    lineHeight: 21,
    textAlign: 'right',
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    borderRadius: RADIUS.button,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  secondaryButtonText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  answerCard: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  answerText: {
    fontSize: 15,
    lineHeight: 26,
    textAlign: 'right',
  },
  citations: {
    gap: 8,
  },
  citation: {
    borderRightWidth: 3,
    paddingRight: 8,
  },
  citationQuote: {
    fontSize: 12.5,
    lineHeight: 20,
    textAlign: 'right',
  },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  costBadge: {
    fontSize: 11.5,
    lineHeight: 17,
    fontWeight: '600',
    borderRadius: RADIUS.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.78,
  },
  disabled: {
    opacity: 0.5,
  },
});
