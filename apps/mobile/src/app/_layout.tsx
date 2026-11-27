import { useEffect } from 'react';
import { I18nManager, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';

import { ToastOverlay } from '@/components/toast-overlay';
import { useIncomingBookIntent } from '@/utils/use-incoming-book-intent';

if (Platform.OS !== 'web') {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useIncomingBookIntent();

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
      </Stack>
      <ToastOverlay />
    </GestureHandlerRootView>
  );
}
