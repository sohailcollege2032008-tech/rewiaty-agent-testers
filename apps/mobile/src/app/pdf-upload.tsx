import { useMemo } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';

import {
  createRewiatyApiUploadService,
  getAuthenticatedApiClient,
  getAuthenticatedDeviceId,
  registerDevicePushToken,
} from '@/api';
import { OFFLINE_SERVICE_BANNER_AR, PdfUploadScreen } from '@/screens/pdf-upload-screen';
import { getConfiguredApiBaseUrl } from '@/utils/api-base-url';

export { getConfiguredApiBaseUrl };

function nativePushPlatform(): 'android' | 'ios' {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

/**
 * PDF upload + F42 onboarding route.
 *
 * Why (L3 integration): the screen owns only UI state and depends on the injectable
 * `PdfUploadService` seam. This route is where that seam becomes real: the live
 * `RewiatyApiClient` handles presign → PUT → complete → estimate → job, and
 * `ensureChapterImported` runs the `ProgressiveBookImporter` before the reader opens.
 */
export default function PdfUploadRoute() {
  const router = useRouter();
  const baseUrl = getConfiguredApiBaseUrl();

  const service = useMemo(() => {
    if (!baseUrl) return undefined;
    // Why (review P1): the live client must authenticate the device and send a Bearer JWT on
    // presign/estimate/job calls; the shared factory keeps one device identity for the app.
    return createRewiatyApiUploadService({ client: getAuthenticatedApiClient(baseUrl) });
  }, [baseUrl]);

  return (
    <PdfUploadScreen
      {...(service ? { service } : { unconfiguredNoticeAr: OFFLINE_SERVICE_BANNER_AR })}
      onOpenReader={(bookId) => {
        router.push({ pathname: '/reader/[id]', params: { id: bookId } });
      }}
      onBack={() => {
        router.back();
      }}
      {...(baseUrl && Platform.OS !== 'web'
        ? {
            // F38: ask for push permission in the same gesture that starts a long conversion.
            // Fire-and-forget — the screen never awaits this, so a denial cannot block the job.
            onRequestPushNotifications: () => {
              void (async () => {
                try {
                  const deviceId = await getAuthenticatedDeviceId(baseUrl);
                  await registerDevicePushToken({
                    apiClient: getAuthenticatedApiClient(baseUrl),
                    deviceId,
                    platform: nativePushPlatform(),
                  });
                } catch {
                  // Push is optional; the conversion continues regardless.
                }
              })();
            },
          }
        : {})}
    />
  );
}
