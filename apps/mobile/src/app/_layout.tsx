import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';

import { useIncomingBookIntent } from '@/utils/use-incoming-book-intent';

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
      </Stack>
    </GestureHandlerRootView>
  );
}
