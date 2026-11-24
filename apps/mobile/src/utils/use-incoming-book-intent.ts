import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';

import { importBookFromUri, isBookImportUri } from '@/storage/intent-import';

export function useIncomingBookIntent() {
  const router = useRouter();
  const activeUriRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const processUrl = async (url: string | null | undefined) => {
      if (!mounted || !isBookImportUri(url)) return;
      if (activeUriRef.current === url) return;
      activeUriRef.current = url;

      try {
        const record = await importBookFromUri(url);
        if (!mounted) return;
        router.push({ pathname: '/reader/[id]', params: { id: record.id } });
      } catch (err) {
        if (!mounted) return;
        Alert.alert(
          'تعذّر فتح الكتاب',
          err instanceof Error ? err.message : 'حدث خطأ أثناء استيراد الملف.',
        );
      } finally {
        if (activeUriRef.current === url) {
          activeUriRef.current = null;
        }
      }
    };

    void Linking.getInitialURL().then((initialUrl) => {
      void processUrl(initialUrl);
    });

    const subscription = Linking.addEventListener('url', (event) => {
      void processUrl(event.url);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [router]);
}
