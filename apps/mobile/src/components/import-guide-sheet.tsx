import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { RADIUS, TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { ThemeId } from '@/types/reader';

export type ImportGuideSheetProps = {
  visible: boolean;
  initialShowHelp?: boolean;
  theme?: ThemeId;
  onPickFile: () => void;
  onClose: () => void;
};

type GuideStep = {
  number: string;
  title: string;
  detail: string;
  renderIcon: (color: string) => React.ReactNode;
};

const GUIDE_STEPS: readonly GuideStep[] = [
  {
    number: '١',
    title: 'افتح الملف في تيليجرام',
    detail: 'ادخل على القناة أو الشات اللي فيه ملف الرواية، بصيغة md أو txt أو zip أو epub',
    renderIcon: (color) => (
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
        <Path
          d="M21 3L3 10.5l6.8 2.4L19 5.8l-7.2 8.2L12 21l3.6-5.2L21 3z"
          stroke={color}
          strokeWidth={1.7}
          strokeLinejoin="round"
        />
      </Svg>
    ),
  },
  {
    number: '٢',
    title: 'اضغط ⋮ واختر «فتح بواسطة»',
    detail: 'من قائمة الملف اختار «فتح بواسطة» أو «مشاركة»',
    renderIcon: (color) => (
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
        <Circle cx={12} cy={5} r={1.6} fill={color} />
        <Circle cx={12} cy={12} r={1.6} fill={color} />
        <Circle cx={12} cy={19} r={1.6} fill={color} />
      </Svg>
    ),
  },
  {
    number: '٣',
    title: 'اختر «روايتي»',
    detail: 'هيتحفظ الكتاب في مكتبتك ويفتح على طول من غير تعقيد',
    renderIcon: (color) => (
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
        <Path
          d="M4.5 5.5C8.5 5.5 11.2 6.8 13 8.8C14.8 6.8 17.5 5.5 21.5 5.5V19.8C17.6 19.8 14.9 20.8 13 22.5C11.1 20.8 8.4 19.8 4.5 19.8V5.5Z"
          stroke={color}
          strokeWidth={1.7}
          strokeLinejoin="round"
        />
        <Path d="M13 8.8V22.5" stroke={color} strokeWidth={1.5} />
      </Svg>
    ),
  },
];

export function ImportGuideSheet({
  visible,
  initialShowHelp = false,
  theme,
  onPickFile,
  onClose,
}: ImportGuideSheetProps) {
  const insets = useSafeAreaInsets();
  const palette = getAppThemeTokens(theme);
  const [helpExpanded, setHelpExpanded] = useState(initialShowHelp);

  useEffect(() => {
    if (visible) {
      setHelpExpanded(initialShowHelp);
    }
  }, [visible, initialShowHelp]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.root} testID="import-guide-sheet">
        <Pressable
          testID="import-guide-backdrop"
          style={[styles.backdrop, { backgroundColor: palette.scrim }]}
          onPress={onClose}
          accessibilityLabel="إغلاق دليل الاستيراد"
        />

        <View
          testID="import-guide-sheet-panel"
          style={[
            styles.sheet,
            {
              backgroundColor: palette.sheetBg,
              borderColor: palette.border,
              paddingBottom: Math.max(insets.bottom, 20) + 16,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: palette.muted }]} />

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            <View style={styles.titleRow}>
              <Text
                style={[
                  styles.title,
                  { color: palette.text, fontFamily: TYPOGRAPHY.displayFont },
                ]}
              >
                أسهل طريقة تستورد بيها رواية
              </Text>
              <Pressable
                testID="import-guide-close-button"
                onPress={onClose}
                style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="إغلاق دليل الاستيراد"
              >
                <View
                  style={[
                    styles.closeBtnVisual,
                    { borderColor: palette.border, backgroundColor: palette.surface },
                  ]}
                >
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path
                      d="M6 6l12 12M18 6L6 18"
                      stroke={palette.text}
                      strokeWidth={1.8}
                      strokeLinecap="round"
                    />
                  </Svg>
                </View>
              </Pressable>
            </View>

            <Pressable
              testID="import-guide-pick-button"
              onPress={onPickFile}
              hitSlop={4}
              style={({ pressed }) => [
                styles.pickBtn,
                { backgroundColor: palette.ctaBg },
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="اختار ملف من الموبايل"
            >
              <Text
                style={[
                  styles.pickBtnText,
                  { color: palette.ctaText, fontFamily: TYPOGRAPHY.uiFont },
                ]}
              >
                اختار ملف من الموبايل
              </Text>
            </Pressable>

            <Text
              style={[
                styles.flowBanner,
                {
                  color: palette.accent,
                  backgroundColor: palette.accentSoft,
                  fontFamily: TYPOGRAPHY.uiFont,
                },
              ]}
            >
              افتح الملف في تيليجرام ← ⋮ ← فتح بواسطة ← روايتي
            </Text>

            <View style={styles.stepsList}>
              {GUIDE_STEPS.map((step) => (
                <View
                  key={step.number}
                  style={[
                    styles.stepCard,
                    {
                      backgroundColor: palette.surface,
                      borderColor: palette.border,
                    },
                  ]}
                >
                  <View style={[styles.iconBadge, { backgroundColor: palette.accentSoft }]}>
                    {step.renderIcon(palette.accent)}
                  </View>
                  <View style={styles.stepCopy}>
                    <Text
                      style={[
                        styles.stepTitle,
                        { color: palette.text, fontFamily: TYPOGRAPHY.uiFont },
                      ]}
                    >
                      {`${step.number}. ${step.title}`}
                    </Text>
                    <Text
                      style={[
                        styles.stepDetail,
                        { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                      ]}
                    >
                      {step.detail}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <Pressable
              testID="import-guide-help-link"
              onPress={() => setHelpExpanded((prev) => !prev)}
              hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
              style={({ pressed }) => [styles.helpLinkBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="إزاي أجيب روايات؟"
            >
              <Text
                style={[
                  styles.helpLinkText,
                  { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont },
                ]}
              >
                إزاي أجيب روايات؟
              </Text>
            </Pressable>

            {helpExpanded ? (
              <View
                testID="import-guide-help-box"
                style={[
                  styles.helpBox,
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.helpBoxText,
                    { color: palette.text, fontFamily: TYPOGRAPHY.uiFont },
                  ]}
                >
                  التطبيق بيقرا ملفات النص الجاهزة بصيغة md أو txt، وكمان أرشيف zip وكتاب epub، من جهازك. تقدر تبعت الملف لنفسك أو تنزّله من قنوات الكتب على تيليجرام أو تنقله من الكمبيوتر، وبعدها تفتحه في «روايتي» من غير بحث في الفولدرات.
                </Text>
              </View>
            ) : null}
          </ScrollView>
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
    maxHeight: '84%',
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
    marginBottom: 14,
  },
  body: {
    gap: 12,
    paddingBottom: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'right',
  },
  closeBtn: {
    width: 48,
    height: 48,
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  closeBtnVisual: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flowBanner: {
    fontSize: 12.5,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: RADIUS.button,
    overflow: 'hidden',
  },
  stepsList: {
    gap: 8,
  },
  stepCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: RADIUS.card,
    borderWidth: 1,
  },
  iconBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepCopy: {
    flex: 1,
    gap: 2,
  },
  stepTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    textAlign: 'right',
  },
  stepDetail: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  pickBtn: {
    marginTop: 4,
    minHeight: 48,
    borderRadius: RADIUS.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  pickBtnText: {
    fontSize: 14.5,
    fontWeight: '700',
  },
  helpLinkBtn: {
    alignSelf: 'center',
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  helpLinkText: {
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  helpBox: {
    padding: 12,
    borderRadius: RADIUS.card,
    borderWidth: 1,
  },
  helpBoxText: {
    fontSize: 12.5,
    lineHeight: 20,
    textAlign: 'right',
  },
  pressed: {
    opacity: 0.78,
  },
});
