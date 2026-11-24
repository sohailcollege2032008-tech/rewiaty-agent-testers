# R2: المحرك — صفحتين جنب بعض بالعرض (تابلت) + الحفاظ على المكان مع اللف

إنت منفّذ (نفّذ بنفسك ومتفوّضش). ردودك بالعربي. الفرع `feat/r2-spread` من `main`. اشتغل في `packages/reader-engine` بس.

## اقرا الأول
- `.factory/ARCHITECTURE.md` (قسم المحرك)، و`packages/reader-engine/src/` كله، خصوصاً الـ paginator وprogressive mount وvirtualization.
- `.factory/design/warraq/tablet/` (index.html وtokens.json): شكل الكتاب المفتوح. فيه `landscape.columns=2`، و`spreadGutterPx=108`، و`maxLineMeasureCh=54`، والكعب والظل في النص.

## المطلوب
1. Setting جديد اختياري في `ReaderSettings`: `spread?: 'auto' | 'single'`، والافتراضي `'auto'`. **عدّل في `types.ts` الإضافة دي بس.** فيه شغل تاني بيعدّل الثيمات في نفس الملف.
2. **وضع الصفحتين:** لو `spread==='auto'` والـ viewport عرضه ≥ 900px وأعرض من طوله، كل «شاشة» بتعرض صفحتين.
   - الـ RTL: الصفحة الأولى **على اليمين**، وفي اللاتيني LTR الأولى على الشمال.
   - في النص gutter فيه ظل الكعب، والـ tokens من التصميم تتعمل CSS variables.
   - next/prev بيقلّبوا spread كامل.
   - رسالة `position` بتفضل تبعت page وpageCount **بالصفحات**، وكمان `spread: true|false`.
   - بداية الفصل الجديد تبدأ على الصفحة اليمين في RTL.
3. **اللف والـ resize:** لما المقاس يتغيّر (rotation)، أعد الـ layout وارجع لنفس الـ anchor (`blockId` + `charOffset`) بنفس الطريقة اللي الإعدادات بتعمل بيها anchor restore.
4. الأداء: بوابة الأداء الموجودة (ready ≤ 1500ms) لازم تفضل عادية في وضع الصفحتين، وممنوع ترخّي الحد.

## اختبارات Playwright (لازم)
- viewport ‏1366×1024: وضع الصفحتين شغال، والصفحة 1 على اليمين في كتاب عربي، وnext بيروح للصفحتين 3-4.
- كتاب إنجليزي: الصفحة الأولى على الشمال.
- resize من 1366×1024 لـ 1024×1366 وبالعكس: نفس الـ blockId باين قبل وبعد.
- `spread:'single'` على 1366: صفحة واحدة.
- مفيش سطر مقطوع بين العمودين، ومفيش تشكيل بيتقص (نفس اختبارات الحواف الموجودة على الـ spread).

## الخلصان
- `bash gates.sh` تقول ALL GATES PASSED.
- سكرينشوت لـ `dev.html` على 1366×1024 بالعربي في `.factory/evidence/r2/spread-ar.png`.
- PR على `main` بعنوان `feat(engine): two-page landscape spread + rotation anchor restore (R2)`.
- **متقفلش الدور** وفيه أمر شغال (npm ci وgates وPlaywright في الـ foreground).
- ردك الأخير: لينك الـ PR، ونتيجة الـ gates، وزمن ready في وضع الصفحتين.
