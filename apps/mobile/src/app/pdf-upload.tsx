import { useRouter } from 'expo-router';

import { OFFLINE_SERVICE_BANNER_AR, PdfUploadScreen } from '@/screens/pdf-upload-screen';

/**
 * Why (L3 integration seam, review P1): PR #36 ships the PDF-upload + onboarding UI against
 * the injectable `PdfUploadService` seam, deliberately without a network client. The live
 * `RewiatyApiClient` (F42 endpoints) and `ProgressiveBookImporter` (local chapter import,
 * used by `ensureChapterImported` before the reader opens) are wired in the follow-up
 * integration PR — after #36 and #37 merge — by passing:
 *
 *   service={createRewiatyApiUploadService({ client, importer })}
 *
 * Until then the route passes the calm `unconfiguredNoticeAr` above so the user reads
 * «الخدمة السحابية لسه مش مفعّلة» instead of hitting a silently broken flow.
 */
export default function PdfUploadRoute() {
  const router = useRouter();

  return (
    <PdfUploadScreen
      unconfiguredNoticeAr={OFFLINE_SERVICE_BANNER_AR}
      onOpenReader={(bookId) => {
        router.push({ pathname: '/reader/[id]', params: { id: bookId } });
      }}
      onBack={() => {
        router.back();
      }}
    />
  );
}
