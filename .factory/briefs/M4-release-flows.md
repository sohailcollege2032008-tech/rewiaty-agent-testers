# M4 — Release APK + رحلات Maestro على GitHub Actions (الريبو البابليك)

إنت منفّذ (نفّذ بنفسك ومتفوّضش). اكتب ردودك بالعربي.

## السياق
- ريبو الكود (private): `~/.t3/projects/rewiaty`. اشتغل على فرع `feat/m4-release` من `main`.
- ريبو الاختبارات (public): `~/workspace/rewiaty-agent-testers` (`sohailcollege2032008-tech/rewiaty-agent-testers`). فيه `.github/workflows/agent-testers.yml` بيشغّل emulator بـ KVM (`reactivecircus/android-emulator-runner`)، وبيشفّر الـ APK بـ `openssl ... -pass env:ARTIFACT_PASSPHRASE` (الـ secret موجود في الريبو). **قلّد نفس الطريقة.**
- **قرار سهيل:** كل الاختبارات على الأجهزة بتتعمل في الريبو البابليك على GitHub Actions. **ممنوع Redroid و`app-flow` في المشروع ده.**
- **ممنوع** أي كود مصدري من روايتي يروح الريبو البابليك. اللي بيروح هناك: الـ APK متشفّر، وملفات Maestro yaml، وملفات sample md للاختبار بس.

## المطلوب
1. **`scripts/build-apk.sh`** في ريبو الكود:
   - `npm ci`، ثم build للـ engine والـ assets، ثم `cd apps/mobile && npx expo prebuild -p android --clean --no-install`.
   - بعدها `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,x86_64`، والـ signing هو الـ debug keystore الافتراضي بتاع prebuild (ده للاختبار).
   - الناتج: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.
   - شغّله بـ `mobile-run bash scripts/build-apk.sh`. الـ build واحد في المرة، فلو فيه طابور هيستنى لحد 30 دقيقة، وده طبيعي. شغّله foreground ومتقفلش الدور وهو شغال.
2. **رحلات Maestro الخمسة** (`apps/mobile/.maestro/<id>.yaml`) حسب `.factory/flows.yaml`:
   - الرحلات: `first-launch-sample`، و`import-md`، و`resume-position`، و`settings-live`، و`open-with-telegram`.
   - استخدم الـ testIDs الموجودة، وزوّد testIDs لو ناقصة، **من غير ما تغيّر الشكل** (فيه redesign جاي).
   - **import-md:** الملف بيتعمله push على الجهاز في خطوة الـ workflow قبل Maestro (`adb push` لـ `/sdcard/Download`)، والـ picker يتساق من Maestro.
   - **open-with-telegram:** خطوة الـ workflow بتعمل `adb push`، وبعدها `adb shell am start -a android.intent.action.VIEW -t text/markdown -d <uri>` (جرّب `content://` من `MediaStore` أو `file://`، أي واحد ينفع مع intent filter بتاع التطبيق). بعد كده Maestro يتأكد إن الكتاب اتفتح.
   - **first-launch-sample:** لازم سكرينشوت لصفحة فيها تشكيل.
   - **settings-live:** تأكيد إن خط Amiri اتحمّل فعلاً تحت الـ CSP. هات `adb logcat` للـ chromium/console، واتأكد إن مفيش `Refused to load` أو CSP violation.
3. **workflow جديد في الريبو البابليك** `.github/workflows/rewiaty-flows.yml`:
   - `workflow_dispatch` بـ input واحد اسمه `apk_url` (رابط الـ release asset المتشفّر).
   - بيفك التشفير، ويشغّل emulator API 34 x86_64، ويعمل install، ويشغّل الخمس رحلات (واحدة واحدة، والـ data تتمسح بين الرحلات اللي محتاجة أول تشغيل).
   - بيرفع artifact فيه JUnit والسكرينشوتس والفيديو و`logcat.txt`، والـ exit code بيبقى code بتاع Maestro.
   - ملفات Maestro والـ samples بتتنسخ للريبو البابليك في `rewiaty/flows/` و`rewiaty/samples/` (`samples/sample-ar.md` و`samples/edge-cases.md` بس).
4. **`scripts/ci-flows.sh <flow-id|all>`** في ريبو الكود:
   - بيشفّر `app-release.apk`، ويرفعه كـ release asset في الريبو البابليك بـ tag اسمه `apk-<sha256 أول 12>` (لو موجود يتخطى).
   - بعدها `gh workflow run rewiaty-flows.yml -f apk_url=...`، وبعدين `gh run watch --exit-status`.
   - بينزّل الـ artifact في `.factory/evidence/<sha12>/`، وده ignored في git ما عدا `summary.md` بنتايج كل رحلة.
   - الـ exit code بيبقى 0 لو كل الرحلات عدّت بس.
   - املا `run:` لكل رحلة في `.factory/flows.yaml` بـ `bash scripts/ci-flows.sh <id>`.
   - (اختياري لو بيوفّر وقت) تشغيلة واحدة للـ all والـ summary بيتقسم.
5. **README قصير** في `docs/TESTING.md`: إزاي تعمل build، وإزاي تشغّل الرحلات، وفين النتايج.

## الخلصان
- `gates.sh` تعدّي، والخمس رحلات تعدّي على الـ release APK على GitHub Actions، وفيه لينك الـ run ونتيجة كل رحلة في `.factory/evidence/<sha12>/summary.md`.
- ابعت PR على ريبو الكود، وcommit وpush على الريبو البابليك.
- **متقفلش الدور** وفيه build أو run شغال. لو رحلة فشلت بسبب باج حقيقي في التطبيق (مش في الـ flow)، اكتبه في رد آخر بالتفاصيل والسكرينشوت ومتصلحش الـ UI.
- ردك الأخير: لينك الـ PR، ولينك الـ Actions run، وجدول الخمس رحلات (PASS/FAIL)، والـ sha256 بتاع الـ APK، وأي باجات اتلاقت.
