import { useEffect } from 'react';
import { I18nManager, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router/stack';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

import { getAuthenticatedApiClient, getAuthenticatedDeviceId } from '@/api/device-session';
import {
  ensurePushRegisteredIfGranted,
  installPushNotificationHandling,
} from '@/api/push-notifications';
import { ToastOverlay } from '@/components/toast-overlay';
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
    </GestureHandlerRootView>
  );
}
