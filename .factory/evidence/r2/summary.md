# R2 — صفحتين جنب بعض (open-book spread) + استرجاع الـ anchor بعد اللف

الفرع: `feat/r2-spread` من `origin/main` (cf7ef46).
السكرينشوت: `.factory/evidence/r2/spread-ar.png` (مش في git — المستثنى الوحيد في الفولدر هو الملف ده).

## إيه اللي اتعمل

| ملف | التغيير |
|---|---|
| `src/types.ts` | `ReaderSettings.spread?: 'auto' \| 'single'` (الافتراضي `'auto'` في `DEFAULT_SETTINGS`)، و`spread: boolean` زيادة على رسالة `position` |
| `src/spread.ts` (جديد) | توكنز الـ spread: عرض الكعب 108px، نص 54ch، خريطة theme → CSS variables لظل الكعب/الحبر |
| `src/paginator.ts` | `metrics.pageWidth` (وحدة تقدّم الصفحة) + `metrics.spread`، `alignToSpread()` / `lastSpreadStart()` / `pageStep()`، تكافؤ صفحات كل فصل (`.chapter-pad`)، وكل حسابات الأعمدة/الترانسفورم على `pageWidth` |
| `src/styles.css` | `.spread-gutter` بظل الكعب + `.spread-headband` فوقه وتحت، `.chapter-pad` بـ `break-before: column`، وكل الألوان/الظلال CSS variables من `spread.ts` |
| `src/template.html` | عنصر `#reader-spread-gutter` |
| `dev.html` + `src/dev-panel.ts` | اختيار Spread (Auto/Single) + iframe يملأ الشاشة في الـ landscape |
| `test/spread.spec.ts` (جديد) | 7 اختبارات s1..s7 |
| `scripts/shoot-spread.mjs` (جديد) | مولّد سكرينشوت الـ evidence |
| `apps/mobile/assets/reader.html` | نسخة متزامنة من `dist/reader.html` (بيولّدها `prebuild:assets` في gates — متتبَّعة في git من قبل، فالمزامنة جزء من التسليم) |

## القواعد اللي البريف طلبها — والتحقق

1. **spread='auto'** يبقى شغّال لو `viewport ≥ 900px` و`width > height`؛ غير كده صفحة واحدة. (s1، وs5 بينقل 1366×1024 ↔ 1024×1366)
2. **RTL الصفحة الأولى على اليمين، LTR على الشمال**: الـ stage بترتيب `column` طبيعي والـ `direction` بيقلبه (s2 عربي، s3 إنجليزي).
3. **next/prev بيقلبوا spread كامل**: `pageStep()` = 2 في وضع الصفحتين (s2: من ص1 لص3-4).
4. **رسالة position**: الصفحات زي ما هي + `spread: true|false` (s1 وs5 بيتأكدوا من الفلاج).
5. **كل فصل يبدأ على الصفحة اليمين في RTL**: كل فصل بيتم pad لعدد صفحات even (s7: 3 فصول).
6. **الكعب في النص بظل**: `.spread-gutter` + توكنز CSS variables (مشاهَد في السكرينشوت).
7. **اللف/resize يرجّع نفس الـ anchor (`blockId` + `charOffset`)**: كل restore بيتظبط على بداية spread برقم زوجي (s5: 1366×1024 → 1024×1366 → رجوع، نفس `blockId`).
8. **مفيش سطر مقطوع بين العمودين ولا تشكيل مقصوص**: (s4) مفيش span بـ `letter-spacing` ولا تشكيل مقطوع.
9. **بوابة الأداء زي ما هي**: (s6) كتاب 20,000 كلمة، 1366×1024، spread: **ready = 324ms** (< 1500ms). الرقم اتقاس بنفس الاختبار في رن منفصل، والحد ما اتغيرش.

## نتيجة الـ gates (رن كامل، نفس الـ SHA)

```
==> 1/7 Typecheck              OK
==> 2/7 Unit tests (Vitest)    OK
==> 3/7 Build reader-engine     OK
==> 4/7 E2E tests (Playwright) OK — 13 tests (6 قديمة + 7 spread)
==> 5/7 Mobile assets & typecheck OK
==> 6/7 Mobile unit/component tests (Jest) OK
==> 7/7 Mobile export (Android) OK
ALL GATES PASSED
```

## ملاحظة

الـ spread بيستخدم عمودين حقيقيين بحيث عرض الصفحة = نصف عرض الـ stage، و`padding-inline` = `gutter/2`، و`column-gap` = `gutter`، فالـ stride = عرض الصفحة بالظبط والكعب واقع على منتصف الـ stage. سقف عرض الكتاب في الـ spread بـ px مش ch (`measureChToPx(...) * 2 + 108`) عشان القياس يبقى مستقل عن الخط.
