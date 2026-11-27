# RC2 — إعادة تحقق P1s + Smoke للـ 7 ميزات الجديدة (2026-11-27)

> **النطاق:** إعادة تحقق من الـ P1s المقفولة (#44 / #56 / #57 / #79) + smoke لسبع ميزات (F31 / F32 / F22 / F26 / F29 / F28 / F49) على APK الـ RC2 الرسمي، مع تفريغ دليل الـ CI (gates + الرحلات الـ 22).
> **النسخة الرسمية:** `1d3cb18fc765` — *feat(reader): F31 lighting, eye comfort & Theme Encyclopedia (حِبْر اللَّيْل) (#40)*.
> **HEAD الحالي للـ worktree:** `cf1f82e97b2b` (#81) — **تغيير Maestro YAML فقط**؛ `git diff 1d3cb18 cf1f82e --stat` = ملفين، 9 أسطر. مفيش سطر كود تطبيق اتغيّر.
> **الجهاز:** Redroid 14 (`adb -s 127.0.0.1:5555`، 720×1520)، نسخة release `versionName=1.0.0`.
> **مفيش commit ومفيش push ومفيش issue/PR:** المخرج الوحيد في الريبو هو الملف ده + مجلد الأدلة `.factory/qa/evidence/rc2/`. `git status --short` = `?? .factory/qa/evidence/rc2/` + `?? .factory/qa/runs/2026-11-27-rc2-reverify-smoke.md` بس.

---

## English executive summary

**Verdict: RC2 app code is solid; the release gate is not green, and RC2 must not be called "gate-green" yet.**

- **Gates** (run `45977161586`, source snapshot `src/1d3cb18fc765`): **all green** — 8 stages, `ALL GATES PASSED`, Vitest 8 files/206 tests, Playwright 118 passed (54.8s), Jest 57 suites/767 tests.
- **Device QA** (release APK, `22a4567ef3…`, byte-identical to the run-84 artifact): **4/4 closed P1s re-verified PASS** (#44 resume across force-stop, #56 note dialog above the keyboard, #57 cold open at 180% font, #79 scroll-fill lands synchronously), and **7/7 smoke features PASS** — including the *positive* welcome-back card (forced a 5-day absence), not just a negative control.
- **Journeys:** 18/22 green at RC2; 4 red — `rotate-position` fails by design (portrait-locked, tracked as blocked), `lighting-themes` fails on a real flow gap (warmth stepper below the fold), `keep-awake` was fixed by #81 but now only passes on a fresh install (order-dependent), and `long-book-open` is still red after #81 because the new assertion reads a HUD-only id while the bars are closed.
- **Blocking findings:** F-1 (`long-book-open` asserts `reader-page-counter` with the HUD closed), F-3 (`lighting-themes` asserts `settings-warmth-value` without scrolling), F-2 (same HUD-only id in `keep-awake`, passes only via the one-time HUD hint).
- **`proof check` is structurally NOT DONE at HEAD** because gates/flows evidence is SHA-keyed to `1d3cb18` while HEAD is `cf1f82e9`; every flow not re-run at `cf1f82e9` is reported as never tried.

---

## الملخص التنفيذي بالعربي

1. **الـ gates خضراء بالكامل** على RC2: 8 مراحل (`0/7` → `7/7`)، `ALL GATES PASSED`، ومنها **118 اختبار Playwright** (فيهم `(m2)` و`(m14)` بتوع #79) و**767 اختبار Jest** في 57 suite.
2. **الـ 4 P1s اتأكدت بنفسي على الجهاز، مش من الكود:** #44 (المكان بيفضل بعد force-stop حتى لو الـ anchor في فصل فاضي)، #56 (أزرار الحفظ/الإلغاء فوق الكيبورد بالكامل)، #57 (فتح بارد بخط 36 = 180% بيطلع صفحة واحدة مضبوطة)، #79 (شريط التقدم بيتعبّى فورًا عند الدخول لوضع التمرير، مش بعد حركة).
3. **الـ 7 ميزات الجديدة كلها PASS** بالدليل البصري: F31 موسوعة 13 ثيم، F32 ألوان مخصصة بتباين حي، F22 وضع التمرير، F29 tooltip الخط الزمني، F26 الرجوع بعد القفزة، F28 كارت «فين كنا واقفين؟» (جرّبته **إيجابي** بغیاب 5 أيام مش بس سلبي)، F49 القاموس.
4. **لكن بوابة الإصدار مش خضراء:** 4 رحلات حمراء من 22. واحدة منهم مقصودة (`rotate-position` موقوفة على قرار منتج)، والتلاتة التانيين مشاكل حقيقية في الـ Maestro flows نفسها — مش في التطبيق.
5. **أهم مشكلة (F-1):** `long-book-open` بيقيس الـ 2 ثانية صح (الصفحة بتظهر أسرع من ثانيتين) وبعدين يفشل على `assertVisible id: reader-page-counter`، والعداد ده **جوه الـ HUD المقفول**. الـ hierarchy بيوري `reader-running-numbers = «صفحة 1 من 1917 · 0%»` في الفوتر، و`reader-page-counter` مش موجود خالص (0 occurrences).
6. **#81 صلّح نص التأكيد القديم (`1 / .*`) لكن ربطه بعنصر مخفي**، فـ `long-book-open` فضل أحمر لسبب جديد، و`keep-awake` بقى يعدّي بالصدفة في أول تثبيت بس (لأن تلميح الـ HUD لمرة واحدة بيفتح الشرايط).
7. **F-3:** `lighting-themes` بيفشل على `settings-warmth-value` لأن صف «دفء الشاشة» تحت الشاشة بعد صفوف F31 الجديدة؛ على الجهاز الميزة شغالة (٢٠٪ → ٣٠٪ والصفحة بتدفى فعلًا).
8. **اكتشاف بيانات (P3):** القاموس المبني فيه **15,714** مدخل، والكود فيه ثابت `DICTIONARY_ENTRY_COUNT = 15735` اللي شاشة «عن التطبيق» بتطبعه — فرق 21 مدخل.
9. **أداة الـ gate نفسها فيها إنذار كاذب:** `csp-check.txt` = `WARN/FAIL (Amiri confirmation missing: none)` لأن الـ runner بيدوّر على `[rewiaty-fonts] amiri=true` في logcat، والسطر ده `console.info` جوه الـ WebView ومش بيوصل logcat في release (0 من 2360 سطر).
10. **`proof check` = NOT DONE** على `cf1f82e9` — طبيعي بنيويًا لأن الأدلة مربوطة بـ `1d3cb18`؛ الحل إما re-run للـ gates + الـ 22 رحلة على HEAD، أو تثبيت HEAD على RC2 بعد ما F-1/F-3/F-2 يتصلحوا.

---

## 1. النسخ والـ CI

### 1.1 الـ CI runs (كلها على ريبو الـ runner `rewiaty-agent-testers`)

| Run | الرابط | الـ source snapshot | النتيجة | التوقيت (UTC) |
|---|---|---|---|---|
| Gates `45977161586` | https://github.com/sohailcollege2032008-tech/rewiaty-agent-testers/actions/runs/45977161586 | `ref: src/1d3cb18fc765` | ✅ success | 09:51:14 → 09:53:44 |
| Flows `45977168081` | https://github.com/sohailcollege2032008-tech/rewiaty-agent-testers/actions/runs/45977168081 | `ref: src/1d3cb18fc765` | ❌ failure (3 رحلات حمراء) | 09:51:17 → 10:26:19 |
| Flows `45977830684` | https://github.com/sohailcollege2032008-tech/rewiaty-agent-testers/actions/runs/45977830684 | `ref: src/cf1f82e97b2b` | ❌ failure (`long-book-open` بس) | 09:56:10 → 10:24:31 |

> **دقة مهمة:** الـ `headSha` بتاع التلاتة هو `e541e570487a` (commit الـ harness في ريبو الـ runner). الكود اللي اتبنى واتجرّب هو الـ snapshot المثبّت في السطر `Checkout Rewiaty source snapshot → ref: src/…` جوه اللوج. والـ `refs/heads/src/1d3cb18fc765` في ريبو الـ runner بيشاور على نفس الـ object `1d3cb18fc765deab4fa81140a43a0f79edad77e0` — يعني نفس شجرة الكود بالظبط، مش نسخة مشابهة.

### 1.2 الـ gates بالتفصيل (run `45977161586`)

| المرحلة | النتيجة |
|---|---|
| `0/7` Script tests (flows.yaml) | 10 passed, 0 failed |
| `1/7` Typecheck (`book-format` + `reader-engine`) | ✅ |
| `2/7` Unit tests (Vitest) | **8 files / 206 tests** passed |
| `3/7` Build reader-engine | ✅ |
| `4/7` E2E (Playwright) | **118 passed (54.8s)** — فيهم `(m2)` و`(m14)` |
| `5/7` Mobile assets | ✅ |
| `6/7` Mobile unit/component (Jest) | **57 suites / 767 tests** passed |
| `7/7` Mobile export (expo export) | ✅ `Exported: dist` |

- اللوج الكامل: `.factory/evidence/1d3cb18fc765/` (نسخة محلية `/tmp/rc2-verify/gates-artifact/gates.log`)، artifact `rewiaty-gates` (ID `15187916782`، 99,888 bytes).
- السطر الحاسم: **`ALL GATES PASSED`**.
- `(m14)` تحديدًا هو اختبار الانحدار بتاع #79: بيدفع `settings.partial.readingMode='scroll'` وبيقرأ الـ `transform` في نفس الـ turn، وبيتأكد إن `getAnimations().length === 0` وإن الـ scale ≈ الـ offset المتوقع (`packages/reader-engine/test/scroll-mode.spec.ts:958`). `(m2)` بيتأكد إن شريط التقدم والـ edge fades مش ظاهرين غير في وضع التمرير (`:231`).

### 1.3 الـ APKs

| الملف | الحجم بالبايت | SHA256 |
|---|---|---|
| Universal (run-84) | **71,606,038** | `22a4567ef3567709b44e2759260e5746c3fd10d8372cdd03022a85dfec8d7725` |
| arm64-v8a (run-84) | **42,994,550** | `6bf0ecc4d722be2ce7eae31d7f6a82ba728378145288dfd082d33b6347a00c15` |
| APK run-81 (فقط للمقارنة) | 71,606,038 | `b796307a67f1a45f644cdaf545be34f72d1f1142e2d80f6ccb8b76c26a772004` |

- **اللي على الجهاز:** سحبت الـ APK المثبّت من الجهاز نفسه (`pm path` → pull) وطلع **`22a4567ef3…` بنفس الحجم بالبايت** = نفس artifact الـ run-84 بالظبط. `versionName=1.0.0`، `versionCode=1`، `lastUpdateTime=2026-11-27 10:22:50`.
- **ملاحظة reproducibility:** نفس الحجم بالبايت و SHA مختلف بين run-81 (1d3cb18) وrun-84 (cf1f82e9) رغم إن الفرق بينهم YAML فقط → بناء الأندرويد **مش reproducible** (طوابع زمنية/تواقيع)، والـ SHA مش دليل هوية كود. الدليل الصح هو الـ `src/<sha>` snapshot.
- **الأدلة:** `.factory/evidence/1d3cb18fc765/` (status.tsv، junit، screenshots، logs، video)، و`.factory/evidence/latest -> 1d3cb18fc765` (symlink).

---

## 2. إعادة تحقق الـ P1s — 4/4 PASS

| # | العنوان | اللي اتعمل على الجهاز | النتيجة | الدليل |
|---|---|---|---|---|
| **#44** | ضياع مكان القراية لو الـ anchor في فصل فاضي | `samples/edge-cases.md` → «فصل فارغ» ص3/4 → force-stop → إعادة فتح → المكتبة 67% + «كمل القراية» → القارئ رجع **ص3/4 = 67%** | ✅ PASS | `p1-44-before-restart.png` · `p1-44-reopen.png` |
| **#56** | الكيبورد بيغطي زرار الحفظ وإغلاقه بيضيّع الملاحظة | `font_scale 1.3` + حجم خط 36 → ضغط مطوّل على كلمة → «ملاحظة» → كتابة «ملاحظة اختبار RC2» → **الحفظ والإلغاء كاملين فوق الكيبورد** → Back **بيسيب الحوار والنص** → حفظ → التظليل اتحفظ | ✅ PASS | `p1-56-note-keyboard.png` · `p1-56-after-back.png` |
| **#57** | فتح بعد force-stop بصفحة نصها مقصوص/مجمّدة | خط 36 (180%) + الفصل التاني + فتح بارد → **صفحة واحدة كاملة مضبوطة**، لا قص من الحافتين، الفوتر `صفحة 28 من 118 · 23%` | ✅ PASS | `p1-57-cold-open-200.png` |
| **#79** | `scroll-mode.spec.ts (m2)` راجع `scaleX(0)` عند الدخول لوضع التمرير | (أ) على الجهاز: الدخول لوضع التمرير من ص28 → شريط التقدم العلوي اتعمّر **فورًا** (~150–160px من 720 ≈ 21%) مش صفر، والعدّاد اتحول «الفصل X%». (ب) `(m2)` + `(m14)` عدّوا في الـ 118 Playwright | ✅ PASS | `smoke-f22-scroll.png` · `smoke-f22-scroll-scrolled.png` + لوج الـ gates |

**تفاصيل اللي شفته بنفسي:**

- **#44:** الفصل الفاضي هو الحالة اللي كانت بتضيّع الـ anchor (مفيش block يقف عليه). بعد force-stop، كارت «حَجَرُ الْمَاءِ» رجع `25%` والكتاب التاني `75%`، والضغط على «كمل القراية» فتح على «فصل فارغ» ص3/4 `67%` — نفس الصفحة بالظبط، مش ص1.
- **#56:** الحوار ظهر كامل فوق الكيبورد: «إضافة ملاحظة»، الاقتباس «الصَّبَاحِ»، النص العربي، وزرار **حفظ** (أحمر) و**إلغاء** كاملين ظاهرين. الـ Back مش بيرجع ولا بيقفل الحوار. بعد الحفظ، التظليل ظهر على «الصَّبَاحِ» في الفصل التاني، والملاحظة ظهرت في `.reader-state.json` (`"note": "ملاحظة اختبار RC2"`).
- **#57:** بأقصى حجم خط مسموح (36px) الصفحة بتتعاد تقسيمها صح: نص واحد ومضبوط، مفيش سطر مقطوع من الحافة، والعداد «صفحة 28 من 118».
- **#79:** ملاحظة دقيقة: الاختبار بيثبت **السلوك السليم**، يعني «الشريط بيتعمّر في نفس اللحظة بدون transition». على الجهاز مش ممكن أقيس `scaleX` في نفس الـ turn، فالدليل الجوهري هو `(m14)` في الـ 118، والدليل البصري هو إن الشريط بيتعمّر عند أول رسم (مش بيتحرك من صفر).

---

## 3. Smoke للـ 7 ميزات — 7/7 PASS

| الميزة | اللي اتحقق | النتيجة | الدليل |
|---|---|---|---|
| **F31** موسوعة الثيمات + إراحة العين | «موسوعة الثيمات»: **13 ثيمًا**، شارة «تباين AAA على الأقل» على الكروت (13.0:1 / 12.8:1 / 12.0:1 / 10.5:1…)، فلاتر «الكل/فاتح/دافئ/داكن/OLED». فلتر «دافئ» رجّع **3 ثيمات بالظبط** (قهوة داكنة/رمل الصحراء/سيبيًا) والعداد بقى «3 ثيما» — مطابق لـ `theme/encyclopedia.ts`. تطبيق «قهوة داكنة» اشتغل، وإعادة فتح الموسوعة بتوري ✓ على النشط. تعتيم/دفء/سطوع بيغيّروا الصفحة فعلًا (الدفء ٢٠٪→٣٠٪ والصفحة اتدهنت) | ✅ PASS | `smoke-f31-theme-encyclopedia.png` · `smoke-f31-filter-warm.png` · `smoke-f31-night-theme-applied.png` · `smoke-f31-lighting.png` · `smoke-f31-warmth.png` |
| **F32** ألوان مخصصة + تباين حي | اختيار لون ورقة `#181310` + حبر `#DECFC0` → الشارة اتحدّثت **مباشرة** من تحذير `1.4:1` إلى **`12.1:1 AAA ممتاز`** → «تطبيق» → الصفحة اتغيّرت، والصف بقى «ألوان مخصصة مفعّلة · #181310 · #DECFC0» | ✅ PASS | `smoke-f32-custom-colors.png` |
| **F22** وضع التمرير | تبويب «الصفحة» → «وضع القراءة» = **تمرير** → عمود واحد متصل، صف **«شريط التقدم العلوي»** ظهر (مش موجود في وضع الصفحات)، والشريط+النسبة زادوا 3% → 5% مع السحب، والفوتر اتحول من «صفحة N من M» إلى «الفصل X%» | ✅ PASS | `smoke-f22-scroll.png` · `smoke-f22-scroll-scrolled.png` |
| **F29** الخط الزمني للفصول | سحب الشريط أظهر أثر (ticks) لحدود الفصول، وtooltip فيه: «**الفصل الثاني: صوت الماء القديم**» + «**صفحة 89**» + أول سطر «في الصباح كان الجد في الماء…» | ✅ PASS | `smoke-f29-timeline-tooltip.png` |
| **F26** الرجوع بعد القفزة | بعد قفزة، ظهرت الحبة «**ارجع لصفحة 5 ×**»؛ الضغط عليها رجّعني لمكان ما قبل القفزة وطلعت الحبة | ✅ PASS | `smoke-f26-jump-back.png` |
| **F28** «فين كنا واقفين؟» | **إيجابي:** عدّلت `updatedAt` في `.reader-state.json` لغياب 5 أيام ونص → فتح الكتاب أظهر الكارت: «فين كنا واقفين؟»، «غبت ٥ أيام · الفصل الثاني: صوت الماء القديم»، فقرات آخر مكان، «آخر علامة» بالاقتباس «تنتظر أن ترت…»، وزرار «كمل القراية» (قفل الكارت ورجّع ص30/118 25%). **سلبي:** إعادة فتح عادية (بدون غياب) **مفيش كارت** | ✅ PASS | `smoke-f28-welcome-back-card.png` · `smoke-f28-card-dismissed.png` · `smoke-f28-no-card-fresh-open.png` · `smoke-f28-welcome-back.png` |
| **F49** قاموس أوفلاين | «الْجَدِّ» → مدخل «**جَدّ**» + وسم «مصدر» + «غير عليها تحت الصيغة: جد» + **4 تعريفات** + لينك صفحة ويكاموس «جد» + نسبة CC BY-SA 4.0. شاشة «عن التطبيق» فيها «القاموس: ويكاموس العربي» و«CC BY-SA 4.0» | ✅ PASS | `smoke-f49-dict.png` · `smoke-f49-about.png` |

### 3.1 القاموس — بيانات مثبتة (لـ F49 وF-6)

- ملف القاموس اللي بيتشحن جوه الـ APK: `res/Ft.sqlite` = **2,596,864 بايت**، SHA256 `6da53fb598bc71d1a90dd52892c1e3eba94cb07d9ce6afeb9275d6890350edd8` — **مطابق بايت-بايت** للملف اللي التطبيق بيقرأ منه وقت التشغيل: `/data/data/com.rewiaty.app/files/SQLite/arwiktionary.sqlite`.
- `select count(*) from entries` = **15,714** مدخل.
- كلمات موجودة: جد (3 معاني)، كتاب (2)، فصل (3)، صوت (2)، كان (2)، بحر (3). كلمات **مش موجودة**: «صباح»، «ماء» → الشاشة بتقول «لم نعثر على الكلمة في القاموس» (P3، F-5).

---

## 4. جدول الرحلات الـ 22 (مدموج بين run-81 وrun-84)

- **`@1d3cb18`** = run `45977168081` (الـ 22 رحلة كلها، RC2 الرسمي — junit times من نفس الـ run).
- **`@cf1f82e9`** = run `45977830684` (`FLOW: keep-awake,long-book-open`، `DICT_REQUIRED: 1`).
- **الحكم** = على مستوى الميزة، مش على مستوى النص الحرفي للرحلة.

| # | الرحلة | الوقت (run-81) | @1d3cb18 | @cf1f82e9 | الحكم | الدليل |
|---|---|---|---|---|---|---|
| 1 | first-launch-sample | 32.3s | ✅ | — | ✅ PASS | `screenshots/first-launch-sample/` |
| 2 | import-md | 44.5s | ✅ | — | ✅ PASS | `screenshots/import-md/` |
| 3 | resume-position | 71.3s | ✅ | — | ✅ PASS | `screenshots/resume-position/` |
| 4 | settings-live | 46.5s | ✅ | — | ✅ PASS (مع تحذير F-7) | `screenshots/settings-live/` |
| 5 | scroll-mode | 62.3s | ✅ | — | ✅ PASS | `screenshots/scroll-mode/` |
| 6 | open-with-telegram | 10.0s | ✅ | — | ✅ PASS | `screenshots/open-with-telegram/` |
| 7 | drag-page-direction | 33.3s | ✅ | — | ✅ PASS | `screenshots/drag-page-direction/` |
| 8 | footnote-popover | 51.4s | ✅ | — | ✅ PASS | `screenshots/footnote-popover/` |
| 9 | rotate-position | 24.9s | ❌ | — | ⛔ **BLOCKED** (قرار منتج: portrait-locked) | `screenshots/rotate-position/` |
| 10 | keep-awake | 28.5s | ❌ | ✅ | ⚠️ **PASS هشّ** (F-2) | run-84: `run84-keep-awake-hud-open.png` + `screenshots/keep-awake/` |
| 11 | long-book-open | 27.7s | ❌ | ❌ | ❌ **FAIL** (F-1) | run-84: `run84-long-book-open-hud-closed.png` + `screenshots/long-book-open/` |
| 12 | scrubber-direction | 38.6s | ✅ | — | ✅ PASS | `screenshots/scrubber-direction/` |
| 13 | chapter-timeline | 29.2s | ✅ | — | ✅ PASS | `screenshots/chapter-timeline/` |
| 14 | import-epub | 49.6s | ✅ | — | ✅ PASS | `screenshots/import-epub/` |
| 15 | import-epub-broken | 54.6s | ✅ (inverted) | — | ✅ PASS بالتصميم (junit = ERROR، الـ runner بيقلب) | `screenshots/import-epub-broken/` |
| 16 | highlight-add | 65.9s | ✅ | — | ✅ PASS | `screenshots/highlight-add/` |
| 17 | mission-control-byok | 24.4s | ✅ | — | ✅ PASS | `screenshots/mission-control-byok/` |
| 18 | lighting-themes | 61.2s | ❌ | — | ❌ **FAIL** (F-3) | `screenshots/lighting-themes/` |
| 19 | custom-colors | 47.6s | ✅ | — | ✅ PASS | `screenshots/custom-colors/` |
| 20 | jump-back | 28.7s | ✅ | — | ✅ PASS | `screenshots/jump-back/` |
| 21 | welcome-back | 31.4s | ✅ | — | ✅ PASS | `screenshots/welcome-back/` |
| 22 | dictionary-lookup | 52.0s | ✅ | — | ✅ PASS | `screenshots/dictionary-lookup/` |

**قراءة الجدول:**

- **18/22 خضراء** على RC2. الحمراء: `rotate-position` (blocked)، `keep-awake` (سبب نص قديم على RC2 / هشّ على HEAD)، `long-book-open` (سبب نص قديم على RC2 / عنصر مخفي على HEAD)، `lighting-themes` (سكرول).
- **الـ times بتاعة run-81 كلها من junit** (مثال: `resume-position=71.277s`). run-84 مش بيغطي غير رحلتين، ووقتهم هناك `keep-awake=74.8s` و`long-book-open=40.4s` — الفرق في الوقت مش مشكلة سرعة، ده زمن تشغيل الـ flow نفسه على نفس الـ emulator.
- **مهم:** `lighting-themes` و`rotate-position` و`keep-awake` و`long-book-open` كلهم gate افتراضي **ما عدا** `long-book-open` (`measure-only`) و`rotate-position` (`blocked`). يعني **`lighting-themes` أحمر على بوابة إصدار، ومش مقصود**.
- **#81 محدش أثّر على أي حكم فوق غير رحلتين**: الـ diff ملفين `keep-awake.yaml` + `long-book-open.yaml` بس، والـ run-84 أثبت إن `keep-awake` بقى يعدّي و`long-book-open` لسه بيقع.

---

## 5. النتائج (Findings)

> كل نتيجة تحت فيها: الشدة، والدليل، وخطوات إعادة الإنتاج، والإصلاح المقترح. الأرقام والمسارات مضبوطة على اللي موجود في `.factory/qa/evidence/rc2/`.

### F-1 — `long-book-open` بيتأكد على عدّاد الـ HUD وهو مقفول (P1 — بوابة)
- **الدليل:** junit run-84: `Assertion is false: "صفحة .* من .*", id: reader-page-counter is visible`. الـ hierarchy الكامل: **0 occurrences** لـ `reader-page-counter`، والموجود `reader-running-numbers` = `صفحة 1 من 1917 · 0%` (في الفوتر) و`reader-live-region` = `صفحة 1 من 1906`. الصورة `02-first-page-under-2s.png` بتوري الفوتر «صفحة 1 من ~1906 · 0%» والـ HUD مقفول.
- **الأهم:** قياس الـ 2 ثانية **نجح** (النص ظهر قبل الـ timeout)؛ الفشل كله في الـ assert اللي بعده. يعني **مش مشكلة أداء**.
- **إعادة الإنتاج:** `bash scripts/ci-flows.sh long-book-open` على تثبيت نضيف، أو أي جهاز اتفتح عليه كتاب قبل كده (التلميح بتاع الـ HUD بيتعلّم `seen`).
- **الإصلاح المقترح:** زي ما `rotate-position.yaml` بيعمل — افتح الشرايط الأول:
  ```yaml
  - runFlow:
      when:
        notVisible:
          id: "reader-page-counter"
      commands:
        - tapOn: { point: "50%,50%" }
  - assertVisible: { id: "reader-page-counter", text: "صفحة .* من .*" }
  ```
  أو الأبسط: `assertVisible: { id: "reader-running-numbers", text: "صفحة .* من .*" }` — الفوتر ظاهر دايمًا.
- **ملاحظة سياق:** في run-81 كان الفشل `".* / .*" is visible` (النص القديم `1 / 26`)، و#81 صلّح النص لكن ربطه بعنصر الـ HUD.

### F-2 — `keep-awake` بيعدّي بالصدفة على أول تثبيت بس (P1 — هشاشة بوابة)
- **الدليل:** run-84 عدّى و`hierarchy-keep-awake` فيه `reader-page-counter = «صفحة 1 من 26»` + الـ HUD مفتوح في الصورة `02-after-45s-idle.png`. على الجهاز بعد ما التلميح اتشاف: فتح بارد للكتاب → الـ HUD **مقفول** والفوتر `صفحة 30 من ~118 · 25%` (`f2-keep-awake-hud-closed.png`) → نفس الـ assert بيفشل.
- **السبب في الكود:** `reader-screen.tsx:1184-1195` بيفتح الشرايط مرة واحدة بس لما `reader_hud_hint_seen_v1` = false، وبعدها بيكتبه `true`. مفيش `tapOn` في الـ flow.
- **الإصلاح:** نفس `runFlow` بتاع F-1 قبل أول assert.
- **الخطورة:** أي CI على جهاز/صورة مش نضيفة، أو re-run على نفس الـ emulator، هيقلب الرحلة أحمر من غير أي ريجرشن.

### F-3 — `lighting-themes` بيدوّر على «دفء الشاشة» وهي تحت الشاشة (P1 — بوابة)
- **الدليل:** junit: `Assertion is false: "١٠٪", id: settings-warmth-value is visible`، وصورة الفشل (`screenshots/lighting-themes/step-029-…) بتوري «التعتيم ٢٠٪» في آخر الشاشة وصف «دفء الشاشة» مقطوع تحته. على الجهاز: «دفء الشاشة» ٢٠٪ → ٣٠٪ والصفحة بتدفى فعلًا (`smoke-f31-warmth.png`).
- **السبب:** صفوف F31 الجديدة (موسوعة الثيمات + ألوان مخصصة + تلقائيًا) زوّدت ارتفاع شيت المظهر، فصفوف التعتيم/الدفء/السطوع نزلت تحت الـ fold.
- **الإصلاح:** `scrollUntilVisible` على `settings-warmth-value` قبل الـ assert (ويفضّل نفس الحاجة لـ `settings-brightness-value`)، أو `tapOn` على صف «التعتيم» كـ anchor. **مش مشكلة منتج.**

### F-4 — `rotate-position` فاشلة بالتصميم (P2 — معروف)
- **الدليل:** `Assertion is false: false is true` + `apps/mobile/app.json` فيه `"orientation": "portrait"`. الرحلة نفسها مكتوب فيها إنها بتفشل عن قصد لما الشاشة portrait-locked، و`flows.yaml` مسجلها `gate: blocked`.
- **الحكم:** مش finding جديد؛ تأكيد إن السلوك الحالي مطابق للقرار. لو القرار اتغير (تابلت/landscape) الرحلة هتتحول بوابة.

### F-5 — تغطية القاموس ناقصة لكلمات شائعة (P3 — محتوى)
- **الدليل:** «صباح» و«ماء» مش موجودين في الـ 15,714 مدخل (`norm` و`word` = 0)، والشاشة بتقول «لم نعثر على الكلمة في القاموس». المفردات اللي في الكتاب التجريبي فيها «الصَّبَاحِ» و«الْمَاء» — يعني قارئ بيقف على أهم كلمة في أول سطر ومش بيلاقيها.
- **ملاحظة:** دي حدود dump الـ Wiktionary المستخدم، مش bug في الكود؛ لكنها P3 حقيقية لتجربة القاموس. الحل: توسيع الـ dump أو fallback (جذر/بحث تقريبي).

### F-6 — عدد المداخل المطبوع غلط (P3 — بيانات/نسخ)
- **الدليل:** `apps/mobile/src/storage/dictionary.ts:61` → `export const DICTIONARY_ENTRY_COUNT = 15735;`، والكارت بيطبعه حرفيًا في `components/about-attribution-card.tsx:100`: `` `نسخة القاموس: ${dumpDate} · ${entryCount} مدخل` ``. الـ DB اللي بيتشحن فيه **15,714**.
- **الأثر:** شاشة «عن التطبيق» بتقول رقم غلط بـ 21 مدخل.
- **الإصلاح:** يا تتحدّث القيمة لـ 15714، يا تتقرأ من الـ DB وقت الفتح (`select count(*)`) وتُمرّر كـ `entryCount`.

### F-7 — `csp-check` إنذار كاذب دايم (P3 — أداة)
- **الدليل:** `.factory/evidence/1d3cb18fc765/logs/csp-check.txt` = `WARN/FAIL (no CSP violation, but Amiri confirmation missing: none)`. في `settings-live-logcat.txt` (2360 سطر): **0** أسطر `[rewiaty-fonts]`، و4 أسطر chromium كلها boilerplate (WebView version / fake index / overlays) — مفيش خطأ font.
- **السبب:** الـ runner بيدوّر على `[rewiaty-fonts] amiri=true` في logcat، والسطر ده بيتكتب بـ `console.info` **جوه الـ WebView** (`logFontStatus` في `assets/reader.html`)، والـ WebView console مش بيوصل Android logcat في release. يعني الشرط ده **عمره ما هيتحقق** على نسخة release.
- **الأثر:** مفيش فشل للرحلة (الـ status فضل PASS)، بس الإنذار بيدوّر على دليل مستحيل ويشوّش أي قراءة لاحقة.
- **الإصلاح:** يا تمرير الـ console messages من الـ WebView للـ RN (`onMessage`/bridge) وطباعتها في logcat، يا إسقاط شرط Amiri من الـ runner (الـ CSP نفسه سليم).

### F-8 — `proof check` NOT DONE على HEAD (P2 — عملية)
- **الدليل:** الخرج الكامل تحت في §6. السبب: الـ gates والرحلات مسجّلين على `1d3cb18`، والـ HEAD `cf1f82e9`. أي رحلة مشغّلتش على HEAD بتتقرأ «ماتجرّبتش».
- **الحكم:** مش عيب في التطبيق — عيب في تعريف «خلص» لما الـ HEAD فيه commit YAML بس. الحل: re-run للـ gates + الـ 22 رحلة على `cf1f82e9` (أو تثبيت HEAD = RC2)، وبعدها `proof check` هيبقى DONE.

### F-9 — صفحة بيضاء عابرة عند الفتح البارد (P3 — ملاحظة)
- **الدليل:** `f9-blank-page-transient.png` — بعد الدخول للقارئ بـ ~7 ثواني، الفوتر بيقول `صفحة 30 من ~118 · 25%` والصفحة نفسها بيضاء، وبعد ~3 ثواني النص ظهر (`f2-keep-awake-hud-closed.png`). حصلت كمان أول مرة قبل كده ومااتكررتش في محاولتين.
- **القراءة:** على Redroid برندر سوفتوير وحمل مشترك، الفرق بين «الفوتر عارف المكان» و«الـ WebView رسم النص» بيبان. **مش مثبت إنه مشكلة منتج** — لكنه بيفتح سؤال: هل الـ loader المفروض يقفل بعد أول paint فعلي، مش بعد `ready`؟
- **كمان:** `reader-live-region` قال «صفحة 1 من 1906» بينما الفوتر «1917» في نفس اللحظة — الـ a11y live region بيتأخر شوية عن العداد المرئي. مش مؤثر على المستخدم السامع (بيتحدّث بعد كده)، لكنه بيفسّر تناقض أي assert بيقرأ من الـ accessibility tree.

---

## 6. `proof check` — الخرج الحرفي

```text
$ proof check /home/ubuntu/.t3/worktrees/rewiaty/lead-l5-release-qa-5c5508fb0b12e061
NOT DONE  lead-l5-release-qa-5c5508fb0b12e061 @ cf1f82e9 (lead/l5-release-qa)
  ✓ HEAD في origin/main
  ✓ ⚠ 18 ملف untracked (مش داخلين في الحكم؛ لو لازمين اعملهم commit): .factory/qa/evidence/rc2/p1-44-before-restart.png, …
  ✗ مفيش gates لـ HEAD — شغّل: gates /home/ubuntu/.t3/worktrees/rewiaty/lead-l5-release-qa-5c5508fb0b12e061
  ✗ رحلة «first-launch-sample» ماتجرّبتش على HEAD
  ✗ رحلة «import-md» ماتجرّبتش على HEAD
  ✗ رحلة «resume-position» ماتجرّبتش على HEAD
  ✗ رحلة «settings-live» ماتجرّبتش على HEAD
  ✗ رحلة «scroll-mode» ماتجرّبتش على HEAD
  ✗ رحلة «open-with-telegram» ماتجرّبتش على HEAD
  ✗ رحلة «drag-page-direction» ماتجرّبتش على HEAD
  ✗ رحلة «footnote-popover» ماتجرّبتش على HEAD
  ✗ رحلة «rotate-position» ماتجرّبتش على HEAD
  ✗ رحلة «keep-awake» ماتجرّبتش على HEAD
  ✗ رحلة «long-book-open» ماتجرّبتش على HEAD
  ✗ رحلة «scrubber-direction» ماتجرّبتش على HEAD
  ✗ رحلة «chapter-timeline» ماتجرّبتش على HEAD
  ✗ رحلة «import-epub» ماتجرّبتش على HEAD
  ✗ رحلة «import-epub-broken» ماتجرّبتش على HEAD
  ✗ رحلة «highlight-add» ماتجرّبتش على HEAD
  ✗ رحلة «mission-control-byok» ماتجرّبتش على HEAD
  ✗ رحلة «lighting-themes» ماتجرّبتش على HEAD
  ✗ رحلة «custom-colors» ماتجرّبتش على HEAD
  ✗ رحلة «jump-back» ماتجرّبتش على HEAD
  ✗ رحلة «welcome-back» ماتجرّبتش على HEAD
  ✗ رحلة «dictionary-lookup» ماتجرّبتش على HEAD
  ⚠ 42 فرع فيهم شغل مش في origin/main (الميل الأخير):
     docs/l4-features-merged-batch  +1  (2 hours ago)
     feat/l3-f46-scene-placeholder  +2  (17 hours ago)
     feat/l3-f49-offline-dictionary  +2  (15 hours ago)
     feat/l4-f22-scroll  +4  (3 hours ago)
     feat/l4-f22-scroll-blind-tests  +1  (20 hours ago)
     feat/l4-f26-jump-back  +3  (4 hours ago)
     feat/l4-f28-welcome-back  +3  (4 hours ago)
     feat/l4-f29-chapter-timeline  +3  (4 hours ago)
     feat/l4-f31-lighting-themes  +6  (87 minutes ago)
     fix/ci-flows-from-flows-yaml  +2  (12 hours ago)
     fix/l3-pr32-codex  +3  (16 hours ago)
     fix/l3-pr33-codex  +2  (15 hours ago)
     fix/l3-pr34-codex  +2  (13 hours ago)
     fix/l3-pr36-codex  +2  (12 hours ago)
     fix/l3-pr37-codex  +3  (13 hours ago)
     …
```
(exit code = 1؛ الخرج الكامل 42 سطر محفوظ في `/tmp/rc2-verify/proof-check.txt`.)

**قراءة `proof check`:**
- `HEAD في origin/main` ✓ — الـ commit مدفوع.
- `مفيش gates لـ HEAD` — لأن أدلة الـ gates مربوطة بـ `1d3cb18`.
- الـ 22 رحلة كلها «ماتجرّبتش على HEAD» — ده literal للسجل، مش معناه إنها مشتغلتش؛ 18 منها جرّبت على RC2 و2 على HEAD.
- `18 ملف untracked` = صور الأدلة (مجلد `.factory/qa/evidence/rc2/`). **اللقطة دي اتاخدت قبل ما أضيف أدلة F28 الإيجابية وأدلة run-84 وF-2/F-9؛ العدد الحالي 29 ملف** — وكلهم تحت نفس المجلد المذكور في السطر، فالحكم نفسه مايتغيرش.

---

## 7. الحكم النهائي وإيه اللي لازم يحصل قبل توقيع RC2

**الحكم:** كود التطبيق في RC2 (`1d3cb18`) **سليم** من ناحية الـ P1s والميزات السبع. المشكلة الوحيدة الحقيقية اللي بتوقف «RC2 gate-green» هي **الـ Maestro flows** — مش المنتج.

**بالترتيب قبل التوقيع:**

1. **F-1:** عدّل `apps/mobile/.maestro/long-book-open.yaml` ليقرأ `reader-running-numbers` (أو يفتح الشرايط الأول). دي بتمنع الرحلة الحمراء الوحيدة على HEAD.
2. **F-2:** نفس الحاجة في `keep-awake.yaml` — من غيرها الرحلة هتفضل تعدّي/تفشل حسب ترتيب التثبيت.
3. **F-3:** `scrollUntilVisible` على `settings-warmth-value` (و`settings-brightness-value`) في `lighting-themes.yaml`.
4. **F-6:** صحّح `DICTIONARY_ENTRY_COUNT` (15714) أو اقرأه من الـ DB.
5. **F-7:** صلّح `csp-check` في ريبو الـ runner (أو شيل شرط Amiri) عشان الإنذار الكاذب مايتقرأش كعيب.
6. **F-8:** بعد ما 1–3 يتحلوا، شغّل **gates + الـ 22 رحلة على `cf1f82e9`** (أو على الـ HEAD الجديد اللي فيه الإصلاحات) — وده اللي هيحوّل `proof check` لـ DONE. **مفيش طريقة تعمل DONE بالـ evidence الحالي، ومحاولة الالتفاف عليها غلط.**
7. **F-4** يفضل `blocked` لحد قرار المنتج بخصوص الـ landscape/tablet.
8. **F-5** قرار محتوى (توسيع القاموس) — مش بلوكر للإصدار.
9. **F-9** يتحوّل لـ issue لو حصل تاني على جهاز حقيقي (مش Redroid)؛ محتاج قياس على هاتف حقيقي قبل الحكم.

---

## 8. المنهج، الأدوات، والحدود

- **الجهاز:** Redroid 14 (`127.0.0.1:5555`)، 720×1520. كل التفاعل بـ `adb input tap/swipe` بإحداثيات مقاسة من سكرينشوت (الصور الكاملة 720×1520؛ الـ previews في الشغل كانت 360×760 بمقياس ×2). عشان أي إيجنت تاني بيسرق الـ foreground (مشروع دكتور/DocumentsUI)، كل خطوة كانت بتتنفّذ في سكربت واحد `/tmp/rc2-verify/d.sh` = `am start` + wait + snippet + screencap.
- **`uiautomator dump` مش متاح على الجهاز:** فيه instrumentation غريب معلّق (`com.callstack.agentdevice.snapshothelper/.SnapshotInstrumentation`, PID 1694252) وماسك UiAutomation، فكل dump بيرجع `UiAutomationService … already registered`. Maestro CLI driver كذلك بيفشل فيبدأ. **يعني التحقق كله بصري** (screenshots) + قراءة الـ hierarchy اللي الـ CI runner نفسه سجّلها.
- **إدخال عربي:** `ADBKeyboard.apk` مؤقت + broadcast، وبعد الشغل **اتشال** (اتأكدت: `pm list packages | grep -i adbkeyboard` فاضي، و`default_input_method` رجع `com.android.inputmethod.latin/.LatinIME`، و`font_scale` رجع `1.0`).
- **الـ font_scale 1.3** استخدم في اختبار #56 بس، ورجع 1.0.
- **F28:** عدّلت `.reader-state.json` (جهاز QA فقط) لغياب 5 أيام عشان أجرّب الحالة الإيجابية، وبعد الفتح التطبيق حدّثه طبيعيًا. مفيش أي كتاب/داتا إنتاج اتلمست.
- **الاستقرار:** التطبيق قعد 34+ دقيقة من غير restart أثناء جولة #44/#56/#57 والـ smoke. بعد كده force-stop مرتين **مقصودين** (اختبار #44 وF28). `logcat -b crash` فيه **0** entries لـ `rewiaty` (الموجود crash قديم لـ bluetooth HAL الساعة 01:24). الـ FATAL الوحيد المتعلق بينا هو `uiautomator dump` نفسه.
- **ملاحظة على السرعة:** أرقام فتح الكتاب/التطبيق على Redroid (بارد ~9 ثواني للمكتبة، ~6 ثواني للقارئ) هي حمولة رندر سوفتوير وحمل مشترك — **مش أرقام أداء المنتج**، ومش بتتناقش هنا.

---

## 9. فهرس الأدلة

**مسار الأساس:** `.factory/qa/evidence/rc2/` (الريبو) — 29 ملف:

| المجموعة | الملفات |
|---|---|
| P1 #44 | `p1-44-before-restart.png` · `p1-44-reopen.png` |
| P1 #56 | `p1-56-note-keyboard.png` · `p1-56-after-back.png` |
| P1 #57 | `p1-57-cold-open-200.png` |
| F31 | `smoke-f31-theme-encyclopedia.png` · `smoke-f31-filter-warm.png` · `smoke-f31-night-theme-applied.png` · `smoke-f31-lighting.png` · `smoke-f31-warmth.png` |
| F32 | `smoke-f32-custom-colors.png` |
| F22 / #79 | `smoke-f22-scroll.png` · `smoke-f22-scroll-scrolled.png` |
| F29 | `smoke-f29-timeline-tooltip.png` |
| F26 | `smoke-f26-jump-back.png` |
| F28 | `smoke-f28-welcome-back-card.png` · `smoke-f28-card-dismissed.png` · `smoke-f28-no-card-fresh-open.png` · `smoke-f28-welcome-back.png` |
| F49 | `smoke-f49-dict.png` · `smoke-f49-about.png` |
| Findings | `f2-keep-awake-hud-closed.png` · `f9-blank-page-transient.png` · `run84-long-book-open-hud-closed.png` · `run84-keep-awake-hud-open.png` · `run84-hierarchy-long-book-open.json` · `run84-hierarchy-keep-awake.json` · `run84-junit-long-book-open.xml` · `run84-junit-keep-awake.xml` |
| CI (run-81) | `.factory/evidence/1d3cb18fc765/{status.tsv, junit/, screenshots/, logs/, video/}` + `.factory/evidence/latest -> 1d3cb18fc765` |

**مفيش كود اتغيّر:** `git diff --stat` فاضي؛ `git status --short` = `?? .factory/qa/evidence/rc2/` + `?? .factory/qa/runs/2026-11-27-rc2-reverify-smoke.md` بس (أدلة + التقرير نفسه، صفر تغيير في كود التطبيق).
