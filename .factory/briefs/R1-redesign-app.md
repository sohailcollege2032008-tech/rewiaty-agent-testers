# R1: Redesign التطبيق على «الوَرّاق» + registry للثيمات + layouts التابلت

إنت منفّذ (نفّذ بنفسك ومتفوّضش). ردودك بالعربي. الفرع `feat/r1-redesign` من `main`.

## اقرا الأول
- `.factory/design/CHOSEN.md`: القرار.
- `.factory/design/directions/a/` (index.html وtokens.json): الوَرّاق الفاتح، والشكل الكامل للمكتبة والقراية والإعدادات وأغلفة الكعب القماش.
- `.factory/design/warraq/dark-1-burnt-paper/`: الدارك الافتراضي «وَرَق مَحْروق».
- `.factory/design/warraq/dark-3-oled-crimson/`: ثيم القراية الأسود «عَتْمَة».
- `.factory/design/warraq/tablet/`: layouts التابلت، وهي المرجع للمقاسات والـ tokens.

## المطلوب
1. **registry للثيمات (data-driven)**، لأن «موسوعة ثيمات» كبيرة جاية بعدين:
   - كل ثيم = object tokens واحد (ألوان القراية + ألوان الـ chrome بتاع التطبيق + `isDark`).
   - كل الشاشات بتقرا من الـ registry، من غير ألوان متكتبة جوه الكومبوننتات.
   - الثيمات دلوقتي:
     - `warraq` (فاتح، **افتراضي**).
     - `sepia` (اظبط ألوانه على عيلة الوَرّاق).
     - `burnt-paper` (دارك، **الافتراضي بالليل**).
     - `oled-crimson`.
   - الـ ids القديمة متخزّنة عند المستخدمين في kv `reader_settings_v1`. اعمل migration: `warm-paper`←`warraq`، و`charcoal`←`burnt-paper`، و`oled`←`oled-crimson`، و`sepia` يفضل زي ما هو، ومعاها اختبار.
   - `ThemeId` و`THEMES` في `packages/reader-engine/src/types.ts` يتحدّثوا. **عدّل في الـ types دي الثيمات بس.** فيه شغل تاني بيزوّد `spread` في نفس الملف، فمتلمسش أي حاجة تانية.
   - ثيم التطبيق بيمشي مع `useColorScheme` (فاتح←`warraq`، وغامق←`burnt-paper`)، **إلا لو** المستخدم اختار ثيم بنفسه من الإعدادات.
2. **تطبيق الشكل على كل الشاشات:**
   - المكتبة: «قراية حالية» فوق، و«رفّ الكتب» grid، وأغلفة الكعب القماش في `book-cover.tsx` زي التصميم.
   - القراية: الـ HUD، والشريطة القرمزي، والفوتر.
   - شيت الإعدادات، وشاشات الحالة الفاضية والـ loading والـ error.
   - طابق الخطوط والمسافات والألوان من `index.html` بتاع التصميم.
3. **التابلت** (`useWindowDimensions`، والتابلت = أقصر ضلع ≥ 600dp):
   - المكتبة grid بأعمدة أكتر.
   - القراية بعرض سطر مريح (`maxReadingWidth` من tokens التابلت).
   - الإعدادات بتبقى **panel جانبي** بالعرض بدل الـ bottom sheet، والطول يفضل sheet.
   - في القراية بالعرض على التابلت، ابعت للمحرك `settings.spread = 'auto'` (المحرك بيتعمل في شغل تاني بالتوازي اسمه R2). لو الـ type لسه مش موجود عندك، ابعته كـ field اختياري ومتكسرش الـ typecheck.
4. **متشيلش ولا تغيّر أي testID موجود** (رحلات Maestro معتمدة عليه). ولو زوّدت شاشات، زوّد testIDs.

## الخلصان
- `bash gates.sh` تقول ALL GATES PASSED، وjest فيه اختبار للـ migration، واختبار لاختيار الثيم حسب الـ color scheme، واختبار للـ layout على عرض تابلت.
- سكرينشوتس من `expo export --platform web` أو من Playwright لو ينفع: المكتبة والقراية بالفاتح والدارك، وموبايل وتابلت. حطها في `.factory/evidence/r1/`.
- PR على `main` بعنوان `feat(mobile): Warraq redesign + theme registry + tablet layouts (R1)`.
- **متقفلش الدور** وفيه أمر شغال. شغّل `npm ci` و`gates.sh` في الـ foreground، ومتكتبش «بستنى…» وتقفل.
- ردك الأخير: لينك الـ PR، ونتيجة الـ gates، ومسار السكرينشوتس.
