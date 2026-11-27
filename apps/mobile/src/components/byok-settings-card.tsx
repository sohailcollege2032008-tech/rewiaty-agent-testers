import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  BYOK_MODELS_BADGE_AR,
  BYOK_PROVIDERS,
  type ByokConfig,
  type ByokModelPreset,
  type ByokProvider,
  type ByokSecureStoreAdapter,
  type ByokStorageMode,
  BYOK_SAVED_MESSAGE_AR,
  BYOK_DELETED_MESSAGE_AR,
  clearByokKey,
  getByokModel,
  getByokModelsForProvider,
  getByokStatusLabel,
  loadByokConfig,
  saveByokKey,
  saveByokPreferences,
  toSafeByokErrorMessage,
} from '@/storage/byok-store';
import type { DatabaseAdapter } from '@/storage/database';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { ThemeId } from '@/types/reader';

export const BYOK_MODE_EPHEMERAL_TEST_ID = 'byok-mode-ephemeral';
export const BYOK_MODE_SERVER_SAVED_TEST_ID = 'byok-mode-server-saved';
export const BYOK_MODE_SERVER_SAVED_BADGE_TEST_ID = 'byok-mode-server-saved-badge';
export const BYOK_MODE_SERVER_SAVED_BADGE_AR = 'قريباً';

export type ByokSettingsCardProps = {
  theme?: ThemeId;
  dir?: 'rtl' | 'ltr';
  /** حقن بديل SecureStore للاختبارات. */
  secureStore?: ByokSecureStoreAdapter;
  /** حقن قاعدة بيانات الاختبارات. */
  db?: DatabaseAdapter;
  now?: () => number;
  onConfigChange?: (config: ByokConfig) => void;
};

/**
 * «الحفظ على السيرفر» ظاهر في القايمة لكنه **مقفول**: وعد بحفظ على السيرفر
 * قبل ما `/v1/keys` يتوصل ويعمل حفظ حقيقي = وعد كاذب. البادج بيقول «قريباً»
 * والضغط عليه مبيعملش أي تغيير.
 */
const STORAGE_MODE_OPTIONS: readonly {
  id: ByokStorageMode;
  title: string;
  description: string;
  testID: string;
  disabled: boolean;
  badgeAr?: string;
}[] = [
  {
    id: 'ephemeral',
    title: 'مؤقت لكل طلب (Ephemeral)',
    description: 'المفتاح يفضل على جهازك فقط ويتبعت مؤقت وقت الشغل، ومش بيتحفظ على السيرفر.',
    testID: BYOK_MODE_EPHEMERAL_TEST_ID,
    disabled: false,
  },
  {
    id: 'server-saved',
    title: 'احفظ مفتاحي على السيرفر',
    description:
      'مشفّر على السيرفر عشان المهام تكمل في الخلفية. هيشتغل لما حفظ المفاتيح على السيرفر (`/v1/keys`) يتوصل.',
    testID: BYOK_MODE_SERVER_SAVED_TEST_ID,
    disabled: true,
    badgeAr: BYOK_MODE_SERVER_SAVED_BADGE_AR,
  },
];

export function ByokSettingsCard({
  theme,
  dir = 'rtl',
  secureStore,
  db,
  now,
  onConfigChange,
}: ByokSettingsCardProps) {
  const palette = getAppThemeTokens(theme);
  const isRtl = dir === 'rtl';

  const [config, setConfig] = useState<ByokConfig | null>(null);
  const [draftKey, setDraftKey] = useState('');
  const [draftBaseUrl, setDraftBaseUrl] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const commit = useCallback(
    (next: ByokConfig) => {
      setConfig(next);
      setDraftBaseUrl(next.customBaseUrl ?? '');
      onConfigChange?.(next);
    },
    [onConfigChange],
  );

  useEffect(() => {
    let cancelled = false;
    void loadByokConfig(db, secureStore)
      .then((loaded) => {
        if (!cancelled) {
          setConfig(loaded);
          setDraftBaseUrl(loaded.customBaseUrl ?? '');
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toSafeByokErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [db, secureStore]);

  const provider = config?.provider ?? 'openai';
  const storageMode = config?.storageMode ?? 'ephemeral';
  const models = useMemo<readonly ByokModelPreset[]>(
    () => getByokModelsForProvider(provider),
    [provider],
  );
  const hasKey = config?.hasKey === true;
  const trimmedBaseUrl = draftBaseUrl.trim();

  const applyPreferences = useCallback(
    async (partial: {
      provider?: ByokProvider;
      modelId?: string;
      storageMode?: ByokStorageMode;
    }) => {
      // الوضع السيرفري مقفول لحد ما `/v1/keys` يتوصل — الضغط عليه مبيعملش أي حاجة.
      if (partial.storageMode === 'server-saved') {
        return;
      }
      setBusy(true);
      setError('');
      setFeedback('');
      try {
        // رابط السيرفر يتخزن مع المزوّد المخصّص بس ولو المستخدم كتبه فعلاً؛
        // الفاضي مش خطأ، والغلط بيترجع برسالة عربية هادية.
        const next = await saveByokPreferences(
          {
            ...partial,
            ...(provider === 'custom' && trimmedBaseUrl
              ? { customBaseUrl: trimmedBaseUrl }
              : {}),
            now: now ? now() : undefined,
          },
          db,
          secureStore,
        );
        commit(next);
      } catch (err: unknown) {
        setError(toSafeByokErrorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [commit, db, now, provider, secureStore, trimmedBaseUrl],
  );

  const handleSave = useCallback(async () => {
    const trimmed = draftKey.trim();
    if (!trimmed) {
      setError('اكتب مفتاح الـ API الأول.');
      return;
    }
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const saved = await saveByokKey(
        {
          apiKey: trimmed,
          provider,
          modelId: config?.modelId,
          storageMode,
          // للمزوّد المخصّص: رابط HTTPS إلزامي (أو null لو المستخدم سابه فاضي).
          customBaseUrl: provider === 'custom' ? (trimmedBaseUrl || null) : undefined,
          now: now ? now() : undefined,
        },
        db,
        secureStore,
      );
      commit(saved);
      setDraftKey('');
      setShowKey(false);
      setFeedback(BYOK_SAVED_MESSAGE_AR);
    } catch (err: unknown) {
      setError(toSafeByokErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [commit, config?.modelId, db, draftKey, now, provider, secureStore, storageMode, trimmedBaseUrl]);

  const handleDelete = useCallback(async () => {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const next = await clearByokKey(db, secureStore, now ? now() : Date.now());
      commit(next);
      setConfirmingDelete(false);
      setDraftKey('');
      setShowKey(false);
      setFeedback(BYOK_DELETED_MESSAGE_AR);
    } catch (err: unknown) {
      setError(toSafeByokErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [commit, db, now, secureStore]);

  const selectedModel = config ? getByokModel(config.modelId) : null;
  const statusLabel = getByokStatusLabel(config);

  return (
    <View
      testID="byok-settings-card"
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <Text
        style={[
          styles.title,
          {
            color: palette.text,
            fontFamily: TYPOGRAPHY.displayFont,
            writingDirection: isRtl ? 'rtl' : 'ltr',
          },
        ]}
      >
        مفتاح الذكاء الاصطناعي
      </Text>
      <Text
        style={[
          styles.subtitle,
          { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont, writingDirection: isRtl ? 'rtl' : 'ltr' },
        ]}
      >
        مفتاحك بيفضل معاك على جهازك. بنستخدمه وقت تشغيل الـ AI بس، ومش بيتحفظ على السيرفر.
      </Text>

      <View
        testID="byok-status-badge"
        style={[
          styles.statusBadge,
          {
            backgroundColor: hasKey ? palette.accentSoft : palette.chipBg,
            borderColor: palette.chipBorder,
          },
        ]}
      >
        <Text
          style={[
            styles.statusText,
            { color: hasKey ? palette.accent : palette.muted, fontFamily: TYPOGRAPHY.uiFont },
          ]}
        >
          {statusLabel}
        </Text>
      </View>

      <View style={styles.section}>
        <Text
          style={[
            styles.sectionTitle,
            { color: palette.text, fontFamily: TYPOGRAPHY.uiFont, writingDirection: isRtl ? 'rtl' : 'ltr' },
          ]}
        >
          المزوّد
        </Text>
        <View style={styles.pillRow}>
          {BYOK_PROVIDERS.map((item) => {
            const selected = item.id === provider;
            return (
              <Pressable
                key={item.id}
                testID={`byok-provider-${item.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={item.labelAr}
                disabled={busy}
                onPress={() => void applyPreferences({ provider: item.id })}
                style={[
                  styles.pill,
                  {
                    backgroundColor: selected ? palette.chipActiveBg : palette.chipBg,
                    borderColor: selected ? palette.accent : palette.chipBorder,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.pillText,
                    { color: selected ? palette.accent : palette.text, fontFamily: TYPOGRAPHY.uiFont },
                  ]}
                >
                  {item.labelAr}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text
          style={[
            styles.sectionTitle,
            { color: palette.text, fontFamily: TYPOGRAPHY.uiFont, writingDirection: isRtl ? 'rtl' : 'ltr' },
          ]}
        >
          الموديل
        </Text>
        <View style={styles.modelList}>
          {models.map((model) => {
            const selected = model.id === config?.modelId;
            return (
              <Pressable
                key={model.id}
                testID={`byok-model-${model.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${model.labelAr} — نص + صور`}
                disabled={busy}
                onPress={() => void applyPreferences({ modelId: model.id })}
                style={[
                  styles.modelRow,
                  {
                    backgroundColor: selected ? palette.chipActiveBg : palette.surfaceElevated,
                    borderColor: selected ? palette.accent : palette.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.modelLabel,
                    { color: selected ? palette.accent : palette.text, fontFamily: TYPOGRAPHY.uiFont },
                  ]}
                  numberOfLines={1}
                >
                  {model.labelAr}
                </Text>
                <View style={[styles.modelBadge, { backgroundColor: palette.accentSoft }]}>
                  <Text style={[styles.modelBadgeText, { color: palette.accent }]}>
                    {BYOK_MODELS_BADGE_AR}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {provider === 'custom' ? (
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              {
                color: palette.text,
                fontFamily: TYPOGRAPHY.uiFont,
                writingDirection: isRtl ? 'rtl' : 'ltr',
              },
            ]}
          >
            رابط السيرفر (base_url)
          </Text>
          <View
            style={[
              styles.inputRow,
              { borderColor: palette.border, backgroundColor: palette.surfaceElevated },
            ]}
          >
            <TextInput
              testID="byok-custom-base-url-input"
              accessibilityLabel="رابط سيرفر المزوّد المخصّص"
              value={draftBaseUrl}
              onChangeText={setDraftBaseUrl}
              placeholder="https://api.example.com/v1"
              placeholderTextColor={palette.muted}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              keyboardType="url"
              editable={!busy}
              style={[styles.input, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
            />
          </View>
          <Text
            style={[
              styles.hint,
              {
                color: palette.muted,
                fontFamily: TYPOGRAPHY.uiFont,
                writingDirection: isRtl ? 'rtl' : 'ltr',
              },
            ]}
          >
            لازم يبدأ بـ https:// — مثال: https://api.example.com/v1
          </Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text
          style={[
            styles.sectionTitle,
            { color: palette.text, fontFamily: TYPOGRAPHY.uiFont, writingDirection: isRtl ? 'rtl' : 'ltr' },
          ]}
        >
          مفتاح الـ API
        </Text>

        {hasKey && config?.keyLast4 ? (
          <Text
            testID="byok-masked-key"
            style={[
              styles.maskedKey,
              { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont, writingDirection: isRtl ? 'rtl' : 'ltr' },
            ]}
          >
            {`المحفوظ على الجهاز: ••••${config.keyLast4}`}
          </Text>
        ) : null}

        <View style={[styles.inputRow, { borderColor: palette.border, backgroundColor: palette.surfaceElevated }]}>
          <TextInput
            testID="byok-key-input"
            accessibilityLabel="مفتاح الـ API"
            value={draftKey}
            onChangeText={setDraftKey}
            placeholder="sk-..."
            placeholderTextColor={palette.muted}
            secureTextEntry={!showKey}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            textContentType="password"
            editable={!busy}
            style={[styles.input, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
          />
          <Pressable
            testID="byok-toggle-visibility"
            accessibilityRole="button"
            accessibilityLabel={showKey ? 'إخفاء المفتاح' : 'إظهار المفتاح'}
            onPress={() => setShowKey((prev) => !prev)}
            style={styles.visibilityButton}
          >
            <Text style={[styles.visibilityText, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}>
              {showKey ? 'إخفاء' : 'إظهار'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.buttonRow}>
          <Pressable
            testID="byok-save-button"
            accessibilityRole="button"
            accessibilityLabel="حفظ المفتاح"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => void handleSave()}
            style={[
              styles.primaryButton,
              { backgroundColor: palette.ctaBg, opacity: busy ? 0.6 : 1 },
            ]}
          >
            <Text style={[styles.primaryButtonText, { color: palette.ctaText }]}>حفظ المفتاح</Text>
          </Pressable>

          <Pressable
            testID="byok-delete-button"
            accessibilityRole="button"
            accessibilityLabel="حذف المفتاح"
            accessibilityState={{ disabled: busy || !hasKey }}
            disabled={busy || !hasKey}
            onPress={() => setConfirmingDelete(true)}
            style={[
              styles.secondaryButton,
              { borderColor: palette.border, opacity: busy || !hasKey ? 0.5 : 1 },
            ]}
          >
            <Text style={[styles.secondaryButtonText, { color: palette.danger }]}>حذف المفتاح</Text>
          </Pressable>
        </View>

        {confirmingDelete ? (
          <View testID="byok-delete-confirm" style={[styles.confirmBox, { borderColor: palette.border }]}>
            <Text
              style={[
                styles.confirmText,
                { color: palette.text, fontFamily: TYPOGRAPHY.uiFont, writingDirection: isRtl ? 'rtl' : 'ltr' },
              ]}
            >
              متأكد إنك عايز تحذف المفتاح من جهازك؟
            </Text>
            <View style={styles.confirmRow}>
              <Pressable
                testID="byok-delete-confirm-button"
                accessibilityRole="button"
                accessibilityLabel="تأكيد حذف المفتاح"
                disabled={busy}
                onPress={() => void handleDelete()}
                style={[styles.confirmButton, { backgroundColor: palette.danger }]}
              >
                <Text style={[styles.confirmButtonText, { color: palette.onAccent }]}>أيوه، احذفه</Text>
              </Pressable>
              <Pressable
                testID="byok-delete-cancel-button"
                accessibilityRole="button"
                accessibilityLabel="إلغاء الحذف"
                onPress={() => setConfirmingDelete(false)}
                style={[styles.confirmButton, { backgroundColor: palette.chipBg }]}
              >
                <Text style={[styles.confirmButtonText, { color: palette.text }]}>إلغاء</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text
          style={[
            styles.sectionTitle,
            { color: palette.text, fontFamily: TYPOGRAPHY.uiFont, writingDirection: isRtl ? 'rtl' : 'ltr' },
          ]}
        >
          طريقة حفظ المفتاح
        </Text>
        <View style={styles.modeList}>
          {STORAGE_MODE_OPTIONS.map((option) => {
            const selected = option.id === storageMode && !option.disabled;
            const optionDisabled = busy || option.disabled;
            return (
              <Pressable
                key={option.id}
                testID={option.testID}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: option.disabled, selected }}
                accessibilityLabel={option.badgeAr ? `${option.title} — ${option.badgeAr}` : option.title}
                disabled={optionDisabled}
                onPress={() => {
                  // وضع السيرفر مقفول: الضغط مبيعملش أي تغيير.
                  if (option.disabled) return;
                  void applyPreferences({ storageMode: option.id });
                }}
                style={[
                  styles.modeCard,
                  {
                    backgroundColor: selected ? palette.chipActiveBg : palette.surfaceElevated,
                    borderColor: selected ? palette.accent : palette.border,
                    opacity: option.disabled ? 0.6 : 1,
                  },
                ]}
              >
                <View style={[styles.radio, { borderColor: selected ? palette.accent : palette.border }]}>
                  {selected ? <View style={[styles.radioDot, { backgroundColor: palette.accent }]} /> : null}
                </View>
                <View style={styles.modeTextWrap}>
                  <View style={styles.modeTitleRow}>
                    <Text
                      style={[
                        styles.modeTitle,
                        { color: selected ? palette.accent : palette.text, fontFamily: TYPOGRAPHY.uiFont },
                      ]}
                    >
                      {option.title}
                    </Text>
                    {option.badgeAr ? (
                      <View
                        testID={BYOK_MODE_SERVER_SAVED_BADGE_TEST_ID}
                        style={[styles.modeBadge, { backgroundColor: palette.chipBg, borderColor: palette.chipBorder }]}
                      >
                        <Text style={[styles.modeBadgeText, { color: palette.muted }]}>{option.badgeAr}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text
                    style={[
                      styles.modeDescription,
                      {
                        color: palette.muted,
                        fontFamily: TYPOGRAPHY.uiFont,
                        writingDirection: isRtl ? 'rtl' : 'ltr',
                      },
                    ]}
                  >
                    {option.description}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {feedback ? (
        <Text
          testID="byok-feedback"
          style={[styles.feedback, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}
        >
          {feedback}
        </Text>
      ) : null}

      {error ? (
        <Text
          testID="byok-error"
          style={[
            styles.error,
            { color: palette.danger, fontFamily: TYPOGRAPHY.uiFont, writingDirection: isRtl ? 'rtl' : 'ltr' },
          ]}
        >
          {error}
        </Text>
      ) : null}

      {selectedModel && !hasKey ? (
        <Text
          style={[
            styles.hint,
            { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont, writingDirection: isRtl ? 'rtl' : 'ltr' },
          ]}
        >
          {`لسه محتاج تحفظ مفتاح ${selectedModel.labelAr} عشان الـ AI يشتغل.`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.sheet,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
  },
  subtitle: {
    fontSize: 12.5,
    lineHeight: 20,
    textAlign: 'right',
    opacity: 0.9,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  section: {
    gap: SPACING.sm,
  },
  sectionTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    textAlign: 'right',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  pill: {
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  pillText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  modelList: {
    gap: SPACING.xs,
  },
  modelRow: {
    borderRadius: RADIUS.button,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  modelLabel: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  modelBadge: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  modelBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  maskedKey: {
    fontSize: 12,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  inputRow: {
    borderRadius: RADIUS.button,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
    textAlign: 'left',
  },
  visibilityButton: {
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  visibilityText: {
    fontSize: 12,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  primaryButton: {
    flex: 1,
    borderRadius: RADIUS.button,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  secondaryButton: {
    flex: 1,
    borderRadius: RADIUS.button,
    borderWidth: 1,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  confirmBox: {
    borderWidth: 1,
    borderRadius: RADIUS.card,
    padding: SPACING.sm,
    gap: SPACING.sm,
  },
  confirmText: {
    fontSize: 12.5,
    textAlign: 'right',
  },
  confirmRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  confirmButton: {
    flex: 1,
    borderRadius: RADIUS.button,
    paddingVertical: 9,
    alignItems: 'center',
  },
  confirmButtonText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  modeList: {
    gap: SPACING.sm,
  },
  modeCard: {
    borderWidth: 1,
    borderRadius: RADIUS.card,
    padding: SPACING.md,
    flexDirection: 'row',
    gap: SPACING.sm,
    alignItems: 'flex-start',
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: RADIUS.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioDot: {
    width: 9,
    height: 9,
    borderRadius: RADIUS.pill,
  },
  modeTextWrap: {
    flex: 1,
    gap: 3,
  },
  modeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    justifyContent: 'space-between',
  },
  modeBadge: {
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  modeBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  modeTitle: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  modeDescription: {
    fontSize: 11.5,
    lineHeight: 18,
    textAlign: 'right',
  },
  feedback: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  error: {
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'right',
  },
  hint: {
    fontSize: 11.5,
    textAlign: 'right',
    opacity: 0.85,
  },
});
