import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ByokSettingsCard } from '@/components/byok-settings-card';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/theme/layout';
import { useAppTheme } from '@/theme/use-app-theme';

export default function AiSettingsScreen() {
  const { themeId, tokens } = useAppTheme();

  return (
    <SafeAreaView
      testID="ai-settings-screen"
      style={[styles.safe, { backgroundColor: tokens.deskBg }]}
      edges={['top', 'bottom']}
    >
      <View style={[styles.header, { borderBottomColor: tokens.border }]}>
        <Pressable
          testID="ai-settings-back"
          accessibilityRole="button"
          accessibilityLabel="رجوع"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/');
            }
          }}
          style={[styles.backButton, { borderColor: tokens.border, backgroundColor: tokens.surfaceElevated }]}
        >
          <Text style={[styles.backText, { color: tokens.accent, fontFamily: TYPOGRAPHY.uiFont }]}>
            رجوع
          </Text>
        </Pressable>
        <Text
          style={[
            styles.headerTitle,
            { color: tokens.text, fontFamily: TYPOGRAPHY.displayFont, writingDirection: 'rtl' },
          ]}
        >
          إعدادات الذكاء الاصطناعي
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          style={[
            styles.pageHint,
            { color: tokens.muted, fontFamily: TYPOGRAPHY.uiFont, writingDirection: 'rtl' },
          ]}
        >
          اربط مفتاحك الخاص (BYOK) عشان روايتي تشتغل على حسابك، بموديل بيقرا النص والصور مع بعض.
        </Text>
        <ByokSettingsCard theme={themeId} />

        <View style={styles.linkGroup}>
          <Pressable
            testID="ai-settings-open-pdf-upload"
            accessibilityRole="button"
            accessibilityLabel="تحويل كتاب PDF بالذكاء الاصطناعي"
            onPress={() => router.push('/pdf-upload')}
            style={({ pressed }) => [
              styles.linkRow,
              {
                backgroundColor: tokens.surfaceElevated,
                borderColor: tokens.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.linkTitle,
                { color: tokens.text, fontFamily: TYPOGRAPHY.uiFont, writingDirection: 'rtl' },
              ]}
            >
              تحويل كتاب PDF بالذكاء الاصطناعي
            </Text>
            <Text
              style={[
                styles.linkHint,
                { color: tokens.muted, fontFamily: TYPOGRAPHY.uiFont, writingDirection: 'rtl' },
              ]}
            >
              ارفع ملف PDF وشوف التكلفة التقديرية واختار مستوى الذكاء قبل التحويل.
            </Text>
          </Pressable>

          <Pressable
            testID="ai-settings-open-about"
            accessibilityRole="button"
            accessibilityLabel="عن التطبيق وتراخيص القاموس"
            onPress={() => router.push('/about')}
            style={({ pressed }) => [
              styles.linkRow,
              {
                backgroundColor: tokens.surfaceElevated,
                borderColor: tokens.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.linkTitle,
                { color: tokens.text, fontFamily: TYPOGRAPHY.uiFont, writingDirection: 'rtl' },
              ]}
            >
              عن التطبيق وتراخيص القاموس
            </Text>
            <Text
              style={[
                styles.linkHint,
                { color: tokens.muted, fontFamily: TYPOGRAPHY.uiFont, writingDirection: 'rtl' },
              ]}
            >
              رخصة الكود وبيانات القاموس من ويكاموس العربي بموجب CC BY-SA 4.0.
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
  },
  backButton: {
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  backText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 1,
  },
  content: {
    padding: SPACING.lg,
    gap: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  pageHint: {
    fontSize: 12.5,
    lineHeight: 20,
    textAlign: 'right',
  },
  linkGroup: {
    gap: SPACING.sm,
  },
  linkRow: {
    // Every row is a real 48dp+ touch target, matching the reader's back/settings buttons.
    minHeight: 48,
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: RADIUS.card,
  },
  linkTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    textAlign: 'right',
  },
  linkHint: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
});
