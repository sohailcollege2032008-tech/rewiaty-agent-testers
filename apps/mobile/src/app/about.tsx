import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AboutAttributionCard } from '@/components/about-attribution-card';
import { RADIUS, TYPOGRAPHY } from '@/theme/layout';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * The app source carries the Expo template's MIT notice in
 * `apps/mobile/LICENSE`; the repository root has no separate license file yet,
 * so the About screen must not claim one. Dictionary content is licensed
 * separately, by its authors, under CC BY-SA 4.0.
 */
const APP_CODE_LICENSE = 'MIT (إشعار قالب Expo في apps/mobile/LICENSE)';
const DICTIONARY_CONTENT_LICENSE = 'CC BY-SA 4.0 (مساهمو ويكاموس العربي)';

const APP_FACTS: readonly { label: string; value: string }[] = [
  { label: 'التطبيق', value: 'روايتي — قارئ الروايات العربية' },
  { label: 'رخصة الكود المصدري', value: APP_CODE_LICENSE },
  { label: 'رخصة بيانات القاموس', value: DICTIONARY_CONTENT_LICENSE },
  { label: 'المنصّة', value: 'Android · iOS · الويب' },
  { label: 'القراءة', value: 'تعمل بالكامل دون إنترنت بعد استيراد الكتاب' },
];

export default function AboutScreen() {
  const insets = useSafeAreaInsets();
  const { tokens } = useAppTheme();

  return (
    <ScrollView
      testID="about-screen"
      style={{ backgroundColor: tokens.bg }}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: Math.max(insets.top, 20) + 8,
          paddingBottom: Math.max(insets.bottom, 24) + 8,
        },
      ]}
    >
      <Text
        style={[styles.title, { color: tokens.heading ?? tokens.text, fontFamily: TYPOGRAPHY.displayFont }]}
      >
        عن التطبيق
      </Text>
      <Text style={[styles.subtitle, { color: tokens.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
        روايتي قارئ عربي هادئ للروايات، مبني ليشتغل على جهازك دون حساب أو اتصال دائم.
      </Text>

      <View style={[styles.factsCard, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
        {APP_FACTS.map((fact) => (
          <View key={fact.label} style={styles.factRow}>
            <Text style={[styles.factLabel, { color: tokens.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
              {fact.label}
            </Text>
            <Text style={[styles.factValue, { color: tokens.text, fontFamily: TYPOGRAPHY.uiFont }]}>
              {fact.value}
            </Text>
          </View>
        ))}
      </View>

      <AboutAttributionCard theme={tokens.id} />

      <Text
        testID="about-license-footnote"
        style={[styles.footnote, { color: tokens.muted, fontFamily: TYPOGRAPHY.uiFont }]}
      >
        الكود المصدري يتبع رخصة المشروع كما هي في apps/mobile/LICENSE، وهو إشعار MIT الخاص بقالب
        Expo (ولا يوجد ملف رخصة مستقل في جذر المستودع بعد). بيانات القاموس منفصلة عن رخصة الكود:
        المداخل مُستخلصة من ويكاموس العربي ومُنظّفة من ترميز الويكي ومُفهرسة للبحث السريع دون
        إنترنت، ويبقى محتواها مرخّصاً بموجب CC BY-SA 4.0 لمساهمي ويكاموس العربي.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    gap: 14,
  },
  title: {
    fontSize: 26,
    lineHeight: 36,
    fontWeight: '700',
    textAlign: 'right',
  },
  subtitle: {
    fontSize: 13.5,
    lineHeight: 23,
    textAlign: 'right',
  },
  factsCard: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  factLabel: {
    fontSize: 12,
    lineHeight: 20,
    fontWeight: '600',
    textAlign: 'right',
  },
  factValue: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 20,
    textAlign: 'right',
  },
  footnote: {
    fontSize: 11.5,
    lineHeight: 20,
    textAlign: 'right',
  },
});
