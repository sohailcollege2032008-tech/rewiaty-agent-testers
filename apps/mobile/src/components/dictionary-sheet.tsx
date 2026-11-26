import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toArabicDigits } from '@/storage/reading-stats';
import {
  buildWiktionaryEntryUrl,
  DICTIONARY_ATTRIBUTION,
  type DictionaryEntry,
  type DictionaryLookupResult,
} from '@/storage/dictionary';
import { RADIUS, TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { ThemeId } from '@/types/reader';

export type DictionarySheetProps = {
  visible: boolean;
  word: string;
  result: DictionaryLookupResult | null;
  loading?: boolean;
  theme?: ThemeId | null;
  onClose: () => void;
};

function openExternalUrl(url: string): void {
  void Linking.openURL(url).catch(() => {
    // The URL stays visible as text even when the platform cannot open it.
  });
}

function findFirstWithPos(entries: readonly DictionaryEntry[]): string | null {
  return entries.find((entry) => entry.pos)?.pos ?? null;
}

function findFirstWithRoot(entries: readonly DictionaryEntry[]): string | null {
  return entries.find((entry) => entry.root)?.root ?? null;
}

export function DictionarySheet({
  visible,
  word,
  result,
  loading = false,
  theme,
  onClose,
}: DictionarySheetProps) {
  const insets = useSafeAreaInsets();
  const palette = getAppThemeTokens(theme);
  const isRtl = true;

  const found = result?.status === 'found' ? result : null;
  const entries = found?.entries ?? [];
  const headword = entries[0]?.word ?? word;
  const pos = findFirstWithPos(entries);
  const root = findFirstWithRoot(entries);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root} testID="dictionary-sheet">
        <Pressable
          testID="dictionary-sheet-backdrop"
          style={[styles.backdrop, { backgroundColor: palette.scrim }]}
          onPress={onClose}
          accessibilityLabel="إغلاق القاموس"
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
            <Text
              style={[styles.title, { color: palette.heading ?? palette.text, fontFamily: TYPOGRAPHY.displayFont }]}
            >
              القاموس
            </Text>
            <Pressable
              testID="dictionary-sheet-close"
              onPress={onClose}
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

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <Text
              testID="dictionary-sheet-word"
              style={[
                styles.headword,
                { color: palette.text, fontFamily: TYPOGRAPHY.displayFont, writingDirection: 'rtl' },
              ]}
            >
              {headword}
            </Text>

            {pos || root ? (
              <View style={styles.pillRow}>
                {pos ? (
                  <View
                    testID="dictionary-sheet-pos"
                    style={[styles.pill, { backgroundColor: palette.accentSoft, borderColor: palette.border }]}
                  >
                    <Text style={[styles.pillText, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}>
                      {pos}
                    </Text>
                  </View>
                ) : null}
                {root ? (
                  <View
                    testID="dictionary-sheet-root"
                    style={[styles.pill, { backgroundColor: palette.chipBg, borderColor: palette.border }]}
                  >
                    <Text style={[styles.pillText, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}>
                      {`الجذر: ${root}`}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {found && found.matchType === 'stemmed' ? (
              <Text
                testID="dictionary-sheet-stem-hint"
                style={[
                  styles.stemHint,
                  {
                    color: palette.muted,
                    backgroundColor: palette.chipBg,
                    fontFamily: TYPOGRAPHY.uiFont,
                  },
                ]}
              >
                {`عُثر عليها تحت الصيغة: ${found.matchedNorm}`}
              </Text>
            ) : null}

            {loading ? (
              <View testID="dictionary-sheet-loading" style={styles.stateBox}>
                <Text style={[styles.stateText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
                  بندوّر على الكلمة…
                </Text>
              </View>
            ) : null}

            {!loading && result === null ? (
              <View testID="dictionary-sheet-idle" style={styles.stateBox}>
                <Text style={[styles.stateText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
                  اختر كلمة من النص لتعرف معناها.
                </Text>
              </View>
            ) : null}

            {!loading && result?.status === 'not_found' ? (
              <View testID="dictionary-sheet-empty" style={styles.stateBox}>
                <Text style={[styles.stateText, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}>
                  لم نعثر على الكلمة في القاموس.
                </Text>
                {result.normalized ? (
                  <Text style={[styles.stateSubText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
                    {`صيغة البحث: ${result.normalized}`}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {!loading && result?.status === 'unavailable' ? (
              <View testID="dictionary-sheet-unavailable" style={styles.stateBox}>
                <Text style={[styles.stateText, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}>
                  {result.reasonAr}
                </Text>
              </View>
            ) : null}

            {!loading && found
              ? entries.map((entry, entryIndex) => {
                  const entryUrls = buildWiktionaryEntryUrl(entry.word);
                  return (
                    <View key={`${entry.norm}-${entryIndex}`} style={styles.entryBlock}>
                      {entry.definitions.length > 0 ? (
                        entry.definitions.map((definition, defIndex) => (
                          <View key={`${entry.norm}-${entryIndex}-${defIndex}`} style={styles.definitionRow}>
                            <Text
                              style={[
                                styles.definitionNumber,
                                { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont },
                              ]}
                            >
                              {`${toArabicDigits(defIndex + 1)}.`}
                            </Text>
                            <Text
                              style={[
                                styles.definitionText,
                                {
                                  color: palette.text,
                                  fontFamily: TYPOGRAPHY.uiFont,
                                  writingDirection: isRtl ? 'rtl' : 'ltr',
                                },
                              ]}
                            >
                              {definition}
                            </Text>
                          </View>
                        ))
                      ) : (
                        <Text style={[styles.stateText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
                          لا توجد معانٍ محفوظة لهذه الصيغة.
                        </Text>
                      )}

                      <View
                        testID={`dictionary-sheet-entry-source-${entryIndex}`}
                        style={styles.entrySourceRow}
                      >
                        <Pressable
                          testID={`dictionary-sheet-entry-page-link-${entryIndex}`}
                          onPress={() => openExternalUrl(entryUrls.pageUrl)}
                          accessibilityRole="link"
                          accessibilityLabel={`صفحة ${entry.word} في ويكاموس العربي`}
                          hitSlop={8}
                        >
                          <Text
                            style={[
                              styles.entrySourceText,
                              { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont },
                            ]}
                          >
                            {`ويكاموس: ${entry.word}`}
                          </Text>
                        </Pressable>
                        <Text style={[styles.entrySourceSeparator, { color: palette.muted }]}>·</Text>
                        <Pressable
                          testID={`dictionary-sheet-entry-history-link-${entryIndex}`}
                          onPress={() => openExternalUrl(entryUrls.historyUrl)}
                          accessibilityRole="link"
                          accessibilityLabel={`تاريخ تعديلات صفحة ${entry.word}`}
                          hitSlop={8}
                        >
                          <Text
                            style={[
                              styles.entrySourceText,
                              { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                            ]}
                          >
                            مساهمو الصفحة
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })
              : null}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: palette.border }]} testID="dictionary-sheet-attribution">
            <Text style={[styles.footerText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
              {DICTIONARY_ATTRIBUTION.noticeAr}
            </Text>
            <Text style={[styles.footerLinks, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
              {`ar.wiktionary.org · ${DICTIONARY_ATTRIBUTION.licenseUrl.replace('https://', '')}`}
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    maxHeight: '82%',
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
    marginBottom: 6,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    opacity: 0.75,
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
  body: {
    gap: 12,
    paddingBottom: 14,
  },
  headword: {
    fontSize: 28,
    lineHeight: 40,
    fontWeight: '700',
    textAlign: 'right',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-start',
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  stemHint: {
    fontSize: 12,
    lineHeight: 20,
    textAlign: 'right',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.button,
    overflow: 'hidden',
  },
  stateBox: {
    paddingVertical: 14,
    gap: 6,
    alignItems: 'center',
  },
  stateText: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  stateSubText: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  entryBlock: {
    gap: 8,
  },
  entrySourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    marginTop: 2,
    opacity: 0.85,
  },
  entrySourceText: {
    fontSize: 11.5,
    lineHeight: 18,
    textDecorationLine: 'underline',
  },
  entrySourceSeparator: {
    fontSize: 11,
    lineHeight: 18,
  },
  definitionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  definitionNumber: {
    fontSize: 13.5,
    lineHeight: 24,
    fontWeight: '700',
    minWidth: 22,
    textAlign: 'right',
  },
  definitionText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 25,
    textAlign: 'right',
  },
  footer: {
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 3,
  },
  footerText: {
    fontSize: 11.5,
    lineHeight: 18,
    textAlign: 'right',
  },
  footerLinks: {
    fontSize: 10.5,
    lineHeight: 16,
    textAlign: 'right',
    opacity: 0.9,
  },
});
