# تقييم `mobile-agent-testers` (`layla` + `grace`) مقابل موجة الـ QA بالأدوار — روايتي (r1)

> **التاريخ:** 2026-11-27 · **المسار:** L5 (الإصدار وموجة الـ QA)
> **النسخة المختبَرة:** Release Candidate APK من `origin/main` (run [`45846756202`](https://github.com/sohailcollege2032008-tech/rewiaty-agent-testers/actions/runs/45846756202) و[`45906206340`](https://github.com/sohailcollege2032008-tech/rewiaty-agent-testers/actions/runs/45906206340))
> **جولة `mobile-agent-testers`:** run [`45906946090`](https://github.com/sohailcollege2032008-tech/rewiaty-agent-testers/actions/runs/45906946090) (بريف `briefs/rewiaty-l5-rc.md` المحدّث بعقد R5 والمرحلة 2)، مقارنةً بالجولة المرجعية الأولى run [`45548725385`](https://github.com/sohailcollege2032008-tech/rewiaty-agent-testers/actions/runs/45548725385) (2026-11-25).
> **تقارير الأدوار الأربعة المقارَن بها:**
> - [`2026-11-26-global-qa-r1.md`](./runs/2026-11-26-global-qa-r1.md) (`global-qa`)
> - [`2026-11-26-visual-qa-r1.md`](./runs/2026-11-26-visual-qa-r1.md) (`visual-qa`)
> - [`2026-11-27-novice-ux-r1.md`](./runs/2026-11-27-novice-ux-r1.md) (`novice-ux-qa`)
> - [`2026-11-27-perf-qa-r1.md`](./runs/2026-11-27-perf-qa-r1.md) (`perf-qa`)

---

## 1. الخلاصة التنفيذية لسهيل

**هل `mobile-agent-testers` (`layla` + `grace`) يستاهل نكمّل بيه جنب موجة الأدوار؟**
**نعم — بقيمة حقيقية ومثبتة، بشرطين تشغيل واضحين:**

1. **التشغيل الانتقائي على الـ Release Candidates فقط (مش على كل PR):** الجولة الواحدة للشخصيتين استهلكت **294 turn** و**24.58M `cache_read` tokens** (ما يعادل **$18.44** list-price، و**$0 فعلي** على OpenCode Go)، وتكرارها على كل commit قد يستهلك حصة OpenCode Go الشهرية بسرعة (كما حدث في run `45849085989` على المفتاح القديم).
2. **فلترة بصرية من القائد قبل فتح GitHub Issues:** حوالي **30%–40%** من تقارير الشخصيتين (خصوصاً ملاحظات «التشكيل في خط Amiri» و«قص المساحات <48dp» بدون `hitSlop` وبعض ملاحظات الذوق) طلعت **false positives / ضوضاء** عند فحص السكرينشوتات بالعين. بدون طبقة triage، سيمتلئ الـ backlog بـ issues مغلوطة.

---

## 2. الأرقام والمقارنة الكمية

### أ. تطور `mobile-agent-testers` بين جولتين على روايتي

| المقياس | run `45548725385` (2026-11-25) | run `45906946090` (2026-11-27 — RC) |
|---|---|---|
| متوسط تقييم الشخصيتين | **6.0 / 10** | **6.5 / 10** (+0.5) |
| إجمالي الملاحظات الخام | 26 (1 major · 11 minor · 14 cosmetic) | 30 (5 major · 12 minor · 13 cosmetic) |
| `layla` (جولات · وقت · لقطات · cache_read · list$) | 115 turns · 22.3m · 53 shots · 8.05M · $7.22 | 180 turns · 20.4m · 58 shots · 16.79M · $12.02 |
| `grace` (جولات · وقت · لقطات · cache_read · list$) | 107 turns · 21.9m · 48 shots · 6.16M · $5.30 | 114 turns · 16.2m · 54 shots · 7.79M · $6.42 |
| التكلفة الفعلية | **$0** (OpenCode Go) | **$0** (OpenCode Go) |

### ب. مقارنة التغطية بين `mobile-agent-testers` وموجة الأدوار الأربعة

| المصدر | P1 حقيقي | P2 حقيقي | P3 / تجميلي | ضوضاء / False Positives | نوع الأعطال التي يتفوق في كشفها |
|---|---|---|---|---|---|
| **`mobile-agent-testers`** (`layla` + `grace`) | **1** (`#57`) | **4** (`#58`, `#59`, `#60` جزئياً، `#52/#61` safe-area) | ~10 | **~35%** (أبرزها Amiri tashkeel + 200% blank + raw uiautomator bounds) | تفاعلات APK حقيقي غير متوقعة: `force-stop` عند 200%، قص popovers/toolbars على حواف الشاشة الحقيقية، تصادم gesture bar |
| **`global-qa`** | **1** (`#44`) | **3** (`#45`, `#46`, `#47`) | 9 | **1** (V2 MediaStore path على Redroid — مثبت نجاحه في CI `open-with-telegram`) | العقود الوظيفية والبيانات (V9 persistence، F19 wiring، UUID title، empty page) |
| **`novice-ux-qa`** (شخصية أم محمد، `font_scale=1.3`) | **1** (`#56`) | **5+** (`#61` وداخل `#60`) | 10 | منخفض جداً (<10%) | الكيبورد على Android، الحذف المخفي، ترتيب شيت الاستيراد، لغة عربية غير تقنية |
| **`visual-qa`** (Playwright 44 حالة + كود) | **0** | **4** (`#48`, `#49`, `#50`, `#52`) | 13 | شبه منعدم (أرقام وحسابات كود دقيقة) | تباين WCAG الدقيق (`onAccent/accent` 2.72/3.08)، focus trap و`aria-live`، تدقيق 48dp مع `hitSlop` |
| **`perf-qa`** (Redroid + «أمواج» + 200k + `with-e2e-lock`) | **0** | **3** (`#70`, `#71`, `#72`) | 3 | تحفّظ بيئة موثّق بصراحة (load 19–35) | حجم APK وتركيبه (29 `.so` = 61%)، زمن فتح 200k، PSS memory، jank % |

---

## 3. صيدات فريدة لم يكتشفها إلا `mobile-agent-testers` (مؤكدة بالعين)

هذه الأعطال **لم تظهر** في أي من تقارير الأدوار الأربعة ولا في رحلات Maestro الـ 14، وتم تأكيدها بالعين من سكرينشوتات run `45906946090`:

1. **P1 — [`#57`](https://github.com/sohailcollege2032008-tech/rewiaty/issues/57) (`grace/48.png`):** إعادة فتح كتاب بعد `force-stop` على تكبير خط 200% تعرض صفحة نصف مقلوبة مجمدة (`translateX` نصف عرض الصفحة) بنص مقصوص من الحافتين حتى يسحب المستخدم. ← **P1 حقيقي وخطير، وصلحّه L4 في PR #66.**
2. **P2 — [`#58`](https://github.com/sohailcollege2032008-tech/rewiaty/issues/58) (`layla/32.png`, `grace/13.png`):** حوار الحاشية (footnote popover) يقص آخر سطر خلف شريط الفوتر بدون إمكانية تمرير، خصوصاً عند 200%.
3. **P2 — [`#59`](https://github.com/sohailcollege2032008-tech/rewiaty/issues/59) (`grace/32.png`):** شريط التظليل (`highlight-toolbar`) يخرج من يمين الشاشة ويقص اللون الرابع (الذهبي).
4. **P2 — ضمن [`#60`](https://github.com/sohailcollege2032008-tech/rewiaty/issues/60) (`layla/16.png`, `grace/40.png`):** محاذاة عناوين أقسام الإعدادات لليسار في واجهة RTL، وتصادم آخر صف في شيت الإعدادات والإحصائيات مع الـ gesture bar، وانقلاب bidi في الفوتر (`82 / 44`).

---

## 4. صيدات مهمة فاتت `mobile-agent-testers` واكتشفتها الأدوار الأربعة

- **P1 `#44` (`global-qa`):** ضياع مكان القراءة والكتابة فوقه بصفر لو الـ anchor محفوظ في فصل فارغ (يتطلب قراءة الكود/الاختبار الموجه للحالات الحدية).
- **P1 `#56` (`novice-ux-qa`):** الكيبورد يغطي زر الحفظ في `HighlightNoteModal` وزر الرجوع يغلق الحوار ويضيع الملاحظة نهائياً.
- **P2 `#45` و`#46` (`global-qa`):** ظهور UUID بدل اسم الملف المستورد + عدم توصيل منظف النص العربي F19 (تتطلب استيراد ملفات نصية وتحليل مصدر الكود).
- **P2 `#48` و`#49` و`#50` (`visual-qa`):** حسابات تباين WCAG الدقيقة وفحص TalkBack/focus و`aria-live`.
- **P2 `#70` و`#71` و`#72` (`perf-qa`):** كل قياسات الأداء الكمية (حجم الـ APK، زمن فتح 200k، PSS memory، jank).
- **قيود تقنية في `mobile-agent-testers`:** `adb input text` لا يكتب عربي في شريط البحث؛ ولا يملك وصولاً لكود التطبيق أو الـ DevTools لحساب التباين أو فحص الذاكرة.

---

## 5. الضوضاء والـ False Positives المؤكدة في `mobile-agent-testers` (رُفضت بعد الفحص بالعين)

| الادعاء في تقرير `layla`/`grace` | الدليل البصري | سبب الرفض |
|---|---|---|
| *«Amiri font breaks tashkeel / detached specks / overlaps»* (`layla` major، `grace` minor) | `layla/17.png`, `grace/42.png` | **False positive:** السكون الدائري والتشكيل الكلاسيكي في خط Amiri طبيعي ومقروء؛ موديل الرؤية أخطأ قراءته كـ «نقاط منفصلة». |
| *«At 200% + Amiri paginator breaks ~2 lines early leaving 25–40% blank»* (`grace` major) | `grace/42.png` | **False positive:** عنوان فصل من 3 سطور بحجم 200% + سطرين ضخمين — الفراغ المتبقي أصغر من ارتفاع سطر واحد بحجم 200%. |
| *«Many touch targets under 48dp»* (`layla` #6, `grace` #8) | `uiautomator` bounds | **False positive جزئي:** الشخصيتان تقرآن bounds الخام للـ View دون احتساب React Native `hitSlop`؛ التدقيق الدقيق من `visual-qa` حصر المشاكل الحقيقية بدقة في `#49` و`#52`. |
| *«Library half-empty with 1 book»* / *«Shelf says 2 روايات with 1 card»* / *«Bundled author is روايتي»* | `layla`, `grace` | ملاحظات تصميم/محتوى مقصودة (المكتبة تفصل «تكمل منين» عن «رفوفك»، والكتاب المدمج كتاب تجريبي). |

---

## 6. التوصية العملية لسير العمل (Workflow)

1. **إبقاء `mobile-agent-testers` كطبقة RC إلزامية:** تشغيل `layla` + `grace` **مرة واحدة لكل Release Candidate رئيسي** (قبل التسليم لسهيل وبعد دمج موجات الميزات الكبيرة)، وليس على كل PR.
2. **الحفاظ على الأدوار الأربعة كعمود فقري للـ QA:** `global-qa` و`novice-ux-qa` و`visual-qa` و`perf-qa` تغطي العقود والمنطق والإتاحة والأداء واللغة العربية دون ضوضاء.
3. **إلزامية Triage بالعين:** قائد L5 يراجع لقطات `major`/`minor` من `mobile-agent-testers` بالعين قبل فتح أي GitHub Issue (أو مقارنة تقارير `SUMMARY.md` مع تقارير الأدوار لمنع التكرار).
4. **تحديث البريف مع كل مرحلة:** الحفاظ على `briefs/rewiaty-l5-rc.md` محدثاً بعقود التفاعل الجديدة (مثل R5 swipes، شاشات المرحلة 4 القادمة: PDF upload، Mission Control، القاموس) حتى لا تُبلغ الشخصيتان عن سلوك قديم كـ bug.
