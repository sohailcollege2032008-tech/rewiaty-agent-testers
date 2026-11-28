import { useEffect } from 'react';
import { I18nManager, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router/stack';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import * as SplashScreen from 'expo-splash-screen';

import { getAuthenticatedApiClient, getAuthenticatedDeviceId } from '@/api/device-session';
import {
  ensurePushRegisteredIfGranted,
  installPushNotificationHandling,
  routeFromPushNotificationData,
} from '@/api/push-notifications';
import { PushQaSeamBanner } from '@/components/push-qa-seam-banner';
import { ToastOverlay } from '@/components/toast-overlay';
import {
  PUSH_QA_SEAM_ENABLED,
  parsePushQaTapUrl,
  pushRouteLabel,
  registerPushQaSeamToken,
  resolvePushQaBookId,
  setPushQaRegistration,
  setPushQaRoute,
} from '@/config/push-qa-seam';
import { useIncomingBookIntent } from '@/utils/use-incoming-book-intent';
import { getConfiguredApiBaseUrl } from '@/utils/api-base-url';

if (Platform.OS !== 'web') {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

SplashScreen.preventAutoHideAsync();

function nativePushPlatform(): 'android' | 'ios' {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

export default function RootLayout() {
  useIncomingBookIntent();
  const router = useRouter();

  useEffect(() => {
    // F38: on Web there is no Expo push; the import-free helpers make this a clean no-op.
    if (Platform.OS === 'web') return undefined;
    return installPushNotificationHandling({
      navigate: (target) => router.push(target),
    });
  }, [router]);

  useEffect(() => {
    // F38: silent boot-time registration — never prompts. The permission prompt belongs to the
    // moment a conversion starts (pdf-upload), where the user understands why it appears.
    if (Platform.OS === 'web') return;
    // F38/#92 QA seam: only a build compiled with EXPO_PUBLIC_PUSH_QA_SEAM=1 takes this branch.
    // It stubs the OS permission/token edge and the API transport, while the real
    // `registerDevicePushToken` still runs (validation + KV write).
    if (PUSH_QA_SEAM_ENABLED) {
      void registerPushQaSeamToken({ platform: nativePushPlatform() }).catch(() => {
        setPushQaRegistration('failed');
      });
      return;
    }
    const baseUrl = getConfiguredApiBaseUrl();
    if (!baseUrl) return;
    const platform = nativePushPlatform();
    void (async () => {
      try {
        const deviceId = await getAuthenticatedDeviceId(baseUrl);
        await ensurePushRegisteredIfGranted({
          apiClient: getAuthenticatedApiClient(baseUrl),
          deviceId,
          platform,
        });
      } catch {
        // Push is optional; a failed registration must never affect app startup.
      }
    })();
  }, []);

  useEffect(() => {
    // F38/#92 QA seam: accepts one QA deep link and feeds its query through the **same** payload
    // parser and router the real notification tap uses. Absent from every normal release.
    if (Platform.OS === 'web' || !PUSH_QA_SEAM_ENABLED) return undefined;

    let cancelled = false;
    const handleUrl = async (url: string | null | undefined) => {
      const payload = parsePushQaTapUrl(url);
      if (!payload || cancelled) return;
      const bookId = await resolvePushQaBookId(payload.book_id);
      if (cancelled) return;
      // `bookReady: true` because the bundled sample is on the device; the journey asserts the
      // reader actually opened it.
      const target = routeFromPushNotificationData(
        { ...payload, book_id: bookId },
        { bookReady: true, bookExists: true },
      );
      if (!target || cancelled) return;
      setPushQaRoute(pushRouteLabel(target));
      router.push(target);
    };

    const subscription = Linking.addEventListener('url', (event) => {
      void handleUrl(event.url);
    });
    void Linking.getInitialURL()
      .then(handleUrl)
      .catch(() => undefined);

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [router]);

  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, animation: 'default' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="reader/[id]" />
        <Stack.Screen name="search" />
        <Stack.Screen name="mission-control" />
        <Stack.Screen name="ai-settings" />
        <Stack.Screen name="pdf-upload" />
        <Stack.Screen name="about" />
      </Stack>
      <ToastOverlay />
      <PushQaSeamBanner />
    </GestureHandlerRootView>
  );
}
