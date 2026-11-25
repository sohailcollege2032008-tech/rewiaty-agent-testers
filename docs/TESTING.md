# الاختبار على الأجهزة (روايتي)

**قرار سهيل:** الـ build والاختبار على الأجهزة بيتعملوا الاتنين على GitHub Actions في الريبو البابليك `sohailcollege2032008-tech/rewiaty-agent-testers` (دقايق ببلاش)، **مش على السيرفر**، ومش على Redroid.

```bash
git commit ...                      # الـ CI بيبني الـ HEAD المتعمله commit
bash scripts/ci-flows.sh all        # أو flow واحد: first-launch-sample | import-md | resume-position | settings-live | open-with-telegram | drag-page-direction | scrubber-direction | footnote-popover | rotate-position | keep-awake | long-book-open
```

- `keep-awake` بيظبط `screen_off_timeout` على 30 ثانية (و`stay_on_while_plugged_in` مقفول) في `scripts/run_rewiaty_flows.sh` في الريبو البابليك قبل ما يشغّل الرحلة، الرحلة بتقعد 45 ثانية idle، وبعدها بيسجّل `dumpsys power` في اللوج كدليل (`mWakefulness=Awake`) وكمان بيتأكد إن مدة الرحلة ≥ 45 ثانية. وفيه control: شاشة المكتبة (من غير القارئ) بتنام فعلًا بعد 40 ثانية بنفس الإعداد.
- `long-book-open` بيولّد `samples/long-ar.md` بـ `samples/gen-long.mjs` على الـ runner ويدفعه لـ `/sdcard/Download`، وبيدخّله للتطبيق بـ `ACTION_VIEW` على `content://` (مش من file picker — F2 عن فتح الكتاب مش عن المستندات)، وبعد ما القارئ يرسم فعلًا بيعمل `force-stop` وبعدها بيفتح الكتاب من المكتبة ويقيس أول صفحة في 2 ثانية. **الـ 2 ثانية هدف منتج ومش بوابة في CI**: الرحلة في `MEASURE_ONLY_FLOWS` في `scripts/ci-flows.sh`، يعني بتشتغل في كل sweep والرقم اللي قاسته (مدة `assertCondition` اللي تايمآوتها `2000` من `logs/long-book-open-commands.json`) بيتكتب في `summary.md` — بس فشلها مش بيخلي الرن أحمر، لأن حمولة runner الـ emulator بتتحرك بالثواني بين الرنات (نفس البيلد قاس 2.1 ثانية و2.4 ثانية و0.34 ثانية). اللي بيتحاسب عليه: لازم يكون فيه قياس مسجّل؛ غياب الأثر خالص = MISSING = أحمر. تسريع الفتح (cache لـ `parseBook` في `readBookBundle`) تذكرة لوحدها.
- `rotate-position` بيعتبر الرحلة فاشلة لو التطبيق ما لفّش فعلًا: بياخد نص العدّاد قبل اللف (`صفحة N من ~M`)، وبعد `setOrientation: LANDSCAPE_LEFT` النص لازم يتغير — لأن نفس النص على عرض مختلف = عدد صفحات مختلف، وأي شاشة مقفولة على `portrait` بترجّع نفس النص بالظبط. الرحلة دي **موقوفة على قرار منتج** (اللف ممكن يبقى للتابلت بس) وعشان كده هي في `BLOCKED_FLOWS` في `scripts/ci-flows.sh`: بيبلّغ عنها بس مش بيحسبها بوابة.
- **الحواشي (`footnote-popover`)** كانت بتفشل على `main`: البابور بيفتح على `pointerup`، والـ `click` اللي المتصفح بيولّده لنفس اللمسة بيتحسب على الـ backdrop اللي بقى ظاهر، فيقفلها في نفس الإيماءة — أي مرجع فوق البانيل (أعلى ~55% من الشاشة) كان بيتقفل فورًا. بعد R5 (#21) الفشل بقى مختلف وقاسي أكتر: المحرك بيعمل `setPointerCapture` على الـ root، فكل أحداث الـ pointer بترجع للـ root والـ `e.target` في `pointerup` بقى `div#reader-root` مش الـ `<a data-fn>`، يعني الحاشية ما بتفتحش خالص (مقيس بلمس حقيقي: `pointerdown target=a.fn-ref` ← `pointerup target=div#reader-root`). الإصلاح في المحرك: `gesture.downTarget` بيتسجّل وقت `pointerdown` وبيتقري وقت الـ release، و`footnoteOpenPointerId` بيتسجّل وقت الفتح، و`pointerdown` جديد على الـ backdrop بيمسحه (إيماءة جديدة = قفل حقيقي)، والـ `click` اللي نفس الـ `pointerId` بيتم تجاهله — من غير أي timer. ودوسة على المرجع بتتحول سحب (`gesture.dragging`) بتقلّب الصفحة ومش بتفتح الحاشية.
- الاختبار `packages/reader-engine/test/footnote-popover.spec.ts` بيدوس بلمس حقيقي (`touchscreen.tap` في context فيه `hasTouch`) على مرجع عند 38% من الشاشة، ويتأكد إن الـ popover فضل مفتوح بعد 400ms وإن الصفحة ما اتقلبتش وإن دوسة مقصودة على الـ backdrop لسه بتقفله؛ وكمان اهتزازة 6px (أقل من `DRAG_START_PX` = 10) لسه دوسة، وسحب 35% بيبدأ على المرجع بيقلّب الصفحة ومش بيفتح الـ sheet. A/B على الشجرة المدموجة بعد #21: محرك `origin/main` فشل عند `expect(backdrop).toBeVisible()`، والمصلَح 3/3 عدّى.
- **قاعدة في الرحلات كلها بعد R5:** التقليب بحركة صباع مش بدوسة على الحرف. `tapOn: point "15%,50%"` بقى مبيعملش حاجة (R5 شال تقليب الحواف)، فالرحلة كانت بتقف مكانها وبتفشل على `^1$` وهو على الصفحة اللي بعدها (run 45688359714، وقفت على صفحة 21 من 26 في أول الفصل الرابع). الشكل المعتمد: `swipe start: "20%,50%" end: "80%,50%" duration: 500` — في RTL ده لقدام — والبحث عن عنصر بيبقى `repeat times: 5 while notVisible` بدل افتراض رقم صفحة ثابت. الدوسات اللي لسه `point` في الرحلات هي `50%,50%` (إظهار الـ HUD) و`50%,15%` (قفل شيت الإعدادات) و`50%,35%` (قفل الحاشية) — ولا واحدة فيهم بتقلّب.

السكربت بيعمل كده:
1. بيعمل push للكود على فرع `src/<sha12>` في الريبو البابليك.
2. بيشغّل workflow ‏`rewiaty-flows.yml`، وده بيبني الـ release APK بـ `scripts/build-apk.sh` (من غير `mobile-run`) وبعدين بيشغّل الرحلات على emulator ‏API 34 x86_64 (`all` = التسعة، أو رحلة واحدة بـ `FLOW`).
3. بينزّل النتايج في `.factory/evidence/<sha12>/`، والرابط `latest` بيشاور عليه:
   - `summary.md` (ده الوحيد اللي بيدخل git)، و`junit/`، و`screenshots/`، و`video/`، و`logs/`.
   - و`apk/app.apk` (ده الـ artifact اللي `proof` بيحسب الـ sha256 بتاعه).

الرحلات في `apps/mobile/.maestro/`، والـ workflow بيقراها من نفس نسخة الكود، فمفيش حاجة تتزامن بإيدك.

بيلد محلي للطوارئ بس: `mobile-run bash scripts/build-apk.sh` (عليه طابور مشترك مع مشاريع تانية).
