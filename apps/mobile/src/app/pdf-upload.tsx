import { useMemo } from 'react';
import { useRouter } from 'expo-router';

import { createRewiatyApiUploadService, RewiatyApiClient } from '@/api';
import { OFFLINE_SERVICE_BANNER_AR, PdfUploadScreen } from '@/screens/pdf-upload-screen';

/**
 * The cloud API origin comes from the build environment. An empty value is the
 * supported "offline build" case: the screen keeps the calm
 * «الخدمة السحابية لسه مش مفعّلة» notice instead of failing on the first tap.
 */
export function getConfiguredApiBaseUrl(
  raw: string | undefined = process.env.EXPO_PUBLIC_API_BASE_URL,
): string {
  return typeof raw === 'string' ? raw.trim() : '';
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
    return createRewiatyApiUploadService({ client: new RewiatyApiClient({ baseUrl }) });
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
    />
  );
}
