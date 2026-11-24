# اختبار روايتي (Release APK + Maestro Flows)

كل اختبارات الأجهزة بتتعمل على **GitHub Actions** في الريبو البابليك `sohailcollege2032008-tech/rewiaty-agent-testers` على Android Emulator (API 34, x86_64, KVM). **ممنوع** استخدام Redroid أو `app-flow`.

## 1. بناء نسخة الـ Release APK
البناء بيتم محلياً عبر `mobile-run` (بيعمل `npm ci`، وبناء `reader-engine` و`assets`، و`expo prebuild`، و`assembleRelease` بـ debug keystore):

```bash
mobile-run bash scripts/build-apk.sh
```

الناتج:
`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`

## 2. تشغيل رحلات Maestro الخمسة على GitHub Actions
تقدر تشغّل كل الرحلات أو رحلة محددة:

```bash
bash scripts/ci-flows.sh all
# أو رحلة بعينها:
bash scripts/ci-flows.sh first-launch-sample
bash scripts/ci-flows.sh import-md
bash scripts/ci-flows.sh resume-position
bash scripts/ci-flows.sh settings-live
bash scripts/ci-flows.sh open-with-telegram
```

السكربت بيعمل التالي:
1. بيشفّر الـ APK بـ `ARTIFACT_PASSPHRASE` ويرفعه كـ release asset على تاج `apk-<sha256 أول 12>` في الريبو البابليك (ويتخطى الرفع لو التاج والملف موجودين).
2. بيشغّل workflow `rewiaty-flows.yml` ويتابعه بـ `gh run watch --exit-status`.
3. بينزّل النتايج في `.factory/evidence/<sha12>/`.

## 3. أماكن النتايج والأدلة
- الملخص المتسجّل في git: `.factory/evidence/<sha12>/summary.md`
- الملفات المحلية (ignored في git):
  - `junit/*.xml`: تقارير JUnit للرحلات.
  - `screenshots/<flow>/`: السكرينشوتس لكل رحلة.
  - `video/<flow>.mp4`: تسجيل الشاشة لكل رحلة.
  - `logcat.txt` و`logs/`: سجلات الـ WebView والـ CSP وفحص تحميل خط `Amiri`.

## 4. تحديث الـ flows في الريبو البابليك
ملفات Maestro (`apps/mobile/.maestro/*.yaml`) وملفات العينات (`samples/sample-ar.md`, `samples/edge-cases.md`) بتتنسخ للريبو البابليك `rewiaty-agent-testers` تحت `rewiaty/flows/` و`rewiaty/samples/` (من غير أي كود مصدري من روايتي).
