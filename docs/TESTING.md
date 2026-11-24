# الاختبار على الأجهزة (روايتي)

**قرار سهيل:** الـ build والاختبار على الأجهزة بيتعملوا الاتنين على GitHub Actions في الريبو البابليك `sohailcollege2032008-tech/rewiaty-agent-testers` (دقايق ببلاش)، **مش على السيرفر**، ومش على Redroid.

```bash
git commit ...                      # الـ CI بيبني الـ HEAD المتعمله commit
bash scripts/ci-flows.sh all        # أو flow واحد: first-launch-sample | import-md | resume-position | settings-live | open-with-telegram
```

السكربت بيعمل كده:
1. بيعمل push للكود على فرع `src/<sha12>` في الريبو البابليك.
2. بيشغّل workflow ‏`rewiaty-flows.yml`، وده بيبني الـ release APK بـ `scripts/build-apk.sh` (من غير `mobile-run`) وبعدين بيشغّل الخمس رحلات على emulator ‏API 34 x86_64.
3. بينزّل النتايج في `.factory/evidence/<sha12>/`، والرابط `latest` بيشاور عليه:
   - `summary.md` (ده الوحيد اللي بيدخل git)، و`junit/`، و`screenshots/`، و`video/`، و`logs/`.
   - و`apk/app.apk` (ده الـ artifact اللي `proof` بيحسب الـ sha256 بتاعه).

الرحلات في `apps/mobile/.maestro/`، والـ workflow بيقراها من نفس نسخة الكود، فمفيش حاجة تتزامن بإيدك.

بيلد محلي للطوارئ بس: `mobile-run bash scripts/build-apk.sh` (عليه طابور مشترك مع مشاريع تانية).
