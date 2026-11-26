import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  DICTIONARY_ATTRIBUTION,
  DICTIONARY_DUMP_DATE,
  DICTIONARY_ENTRY_COUNT,
} from '@/storage/dictionary';
import { RADIUS, TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { ThemeId } from '@/types/reader';

export type AboutAttributionCardProps = {
  theme?: ThemeId | null;
  dumpDate?: string;
  entryCount?: number;
};

const WIKTIONARY_URL = 'https://ar.wiktionary.org';
const LICENSE_URL = DICTIONARY_ATTRIBUTION.licenseUrl;

function openExternalUrl(url: string): void {
  void Linking.openURL(url).catch(() => {
    // The URL stays visible as text even when the platform cannot open it.
  });
}

export function AboutAttributionCard({
  theme,
  dumpDate = DICTIONARY_DUMP_DATE,
  entryCount = DICTIONARY_ENTRY_COUNT,
}: AboutAttributionCardProps) {
  const palette = getAppThemeTokens(theme);

  return (
    <View
      testID="about-attribution-card"
      style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
    >
      <Text
        style={[
          styles.cardTitle,
          { color: palette.heading ?? palette.text, fontFamily: TYPOGRAPHY.displayFont },
        ]}
      >
        القاموس: ويكاموس العربي
      </Text>

      <Text style={[styles.bodyText, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}>
        {DICTIONARY_ATTRIBUTION.noticeAr}
      </Text>

      <Text
        testID="about-attribution-processing"
        style={[styles.bodyText, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
      >
        بيانات القاموس مقدَّمة من مساهمي ويكاموس العربي (Arabic Wiktionary contributors). المداخل
        مُستخلصة من ويكاموس العربي ومُنظّفة من ترميز الويكي ومُفهرسة للبحث السريع دون إنترنت، ومحتوى
        القاموس يبقى مرخّصاً بموجب المشاع الإبداعي نَسب المُصنَّف ـ مشاركة بمثل 4.0 دولي (CC BY-SA
        4.0) بشروطه دون تغيير.
      </Text>

      <Text style={[styles.metaText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
        لكل مدخل في شاشة القاموس رابط إلى صفحته الأصلية في ويكاموس العربي وتاريخ مساهميه.
      </Text>

      <View style={[styles.licenseBadge, { backgroundColor: palette.accentSoft, borderColor: palette.border }]}>
        <Text style={[styles.licenseBadgeText, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}>
          {DICTIONARY_ATTRIBUTION.license}
        </Text>
      </View>

      <Pressable
        testID="about-license-link"
        onPress={() => openExternalUrl(LICENSE_URL)}
        accessibilityRole="link"
        accessibilityLabel="رخصة CC BY-SA 4.0"
        style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
      >
        <Text style={[styles.linkText, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}>
          {LICENSE_URL}
        </Text>
      </Pressable>

      <Pressable
        testID="about-wiktionary-link"
        onPress={() => openExternalUrl(WIKTIONARY_URL)}
        accessibilityRole="link"
        accessibilityLabel="ويكاموس العربي"
        style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
      >
        <Text style={[styles.linkText, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}>
          {WIKTIONARY_URL}
        </Text>
      </Pressable>

      <Text
        testID="about-dictionary-meta"
        style={[styles.metaText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
      >
        {`نسخة القاموس: ${dumpDate} · ${entryCount} مدخل`}
      </Text>

      <Text style={[styles.metaText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
        القاموس يعمل بالكامل دون إنترنت، وبياناته تأتي من تفريغ رسمي لويكاموس العربي.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  cardTitle: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
    textAlign: 'right',
  },
  bodyText: {
    fontSize: 13,
    lineHeight: 22,
    textAlign: 'right',
  },
  licenseBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  licenseBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  linkRow: {
    minHeight: 32,
    justifyContent: 'center',
  },
  linkText: {
    fontSize: 12.5,
    textAlign: 'left',
    textDecorationLine: 'underline',
    writingDirection: 'ltr',
  },
  metaText: {
    fontSize: 11.5,
    lineHeight: 19,
    textAlign: 'right',
  },
  pressed: {
    opacity: 0.75,
  },
});
