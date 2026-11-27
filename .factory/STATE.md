# STATE — روايتي
- **المرحلة:** كل موجات البناء مدموجة على `origin/main` (M0–M3 + المرحلة 2 + L3 Phase 4 + L4 Phase 3 UX + L5)، وRC2 مبني ومُختبر و**صفر P1 مفتوح على المنتج**. PR التلميع **#82 مدموج** (`ef081d0`)، و`main` عند `f487af8`. الباقي: إصلاح صغير لانتظار settle في رحلة `chapter-timeline` ← بعده البوابة النهائية `gates` + `ci-flows all` + `proof check` + تسليم الـ APK. **`proof check` والتسليم لسه pending.** · **آخر تحديث:** 2026-11-28
- **إحصائيات `.factory/FEATURES.md` (`node scripts/feature-stats.mjs`، 2026-11-28):**
  - المرحلة 1 (القارئ): 74/78 بند (95%) · بوابات 65/85 (76%)
  - المرحلة 2 (المحرك): 30/31 بند (97%) · بوابات 30/45 (67%)
  - المرحلة 3 (اللمسات UX): 16/37 بند (43%) · بوابات 20/75 (27%)
  - المرحلة 4 (AI + Backend): 35/60 بند (58%) · بوابات 23/70 (33%)
  - المرحلة 5 (المزامنة): 0/9 بند (0%) · بوابات 0/15 (0%)
  - الإجمالي: 155/215 بند صغير · 0/58 فيتشر مكتمل البوابات
- **الموديلات:** القادة على Gemini 4 Neon (`antigravity_sohail6`)، والعمّال على OpenCode `go-locked/deepseek-v4.1-flash` (حد أقصى عاملين بالتوازي، fallback Hydrogen)، والمراجعة النهائية على Codex (`gpt-6.2-sol`)، والدمج على Claude. القواعد: `.factory/briefs/LEADS-COMMON.md`.

| Milestone / المسار | الحالة | المرجع / PR |
|---|---|---|
| M0–M3 (الأساس + المحرك + الإعدادات + التصميم) | ✅ مدموجة | `#1`–`#17` |
| المرحلة 2 (F10–F20: حواشي، تظليل، بحث FTS5، تنظيف، zip/epub، R5) | ✅ مدموجة | `#18`–`#26`, `#30`, `#31` |
| L1 Backend Core + L2 PDF Pipeline | 🟡 ريبو منفصل (`rewiaty-backend`) — مش جزء من بوابة RC2 | `rewiaty-backend` |
| L3 Phase 4 (F40 BYOK, F42 PDF, F46 Placeholder, F48 Mission Control, F49 Dictionary, OpenAPI/SSE) | ✅ مدموجة | `#32`–`#39`, `#64`, `#69`, `#76`, `#77` |
| L4 Phase 3 UX (F21, F22, F26, F28, F29, F31, F32) + إصلاحات QA r1 | ✅ مدموجة | UX: `#35`, `#38`, `#40`, `#42`, `#43`, `#53`, `#54` · إصلاحات P1/P2: `#65`, `#66`, `#68`, `#74`, `#75`, `#80` |
| L5 Release + QA Wave r1 | ✅ مدموجة | `#55`, `#62`, `#63`, `#67`, `#73`, `#77`, `#80`, `#81`, `#82` |
| `mobile-agent-testers` (`layla` + `grace`) | ✅ مكتمل ومُقيَّم (متوسط 6.5/10 مقابل 6.0/10؛ التقييم في `.factory/qa/agent-testers-eval.md`) | run `45906946090` (`sohailcollege2032008-tech/rewiaty-agent-testers`) |

## حالة Release Candidate & `proof check`
- **RC2 — المصدر `1d3cb18fc765` + `#81` `cf1f82e9` (2026-11-27):**
  - **CI Gates** (`rewiaty-gates.yml`, run `45977161586`): ✅ **PASS** — 8 مراحل، `ALL GATES PASSED`: **206 Vitest** (8 ملفات) · **118 Playwright** · **767 Jest** (57 suite) · Android export (`Exported: dist`).
  - **إعادة تحقق الـ P1s على الجهاز (release APK):** **4/4 PASS** — `#44` (استرجاع المكان عبر `force-stop` مع anchor في فصل فاضي) · `#56` (حفظ الملاحظة فوق الكيبورد) · `#57` (فتح بارد عند 180%) · `#79` (شريط التقدم يثبت فورًا في وضع التمرير).
  - **Smoke للميزات السبع الجديدة:** **7/7 PASS** بدليل بصري — F31 (موسوعة 13 ثيم) · F32 (ألوان مخصّصة بتباين WCAG) · F22 (وضع التمرير) · F26 (الرجوع بعد القفزة) · F29 (tooltip الخط الزمني) · F28 (كارت «فين كنا واقفين؟» بتجربة إيجابية بغياب 5 أيام) · F49 (القاموس).
  - **الـ P1s المفتوحة:** **0** (منتج). `rotate-position` لسه موقوفة بقرار منتج (مش gating).
  - **التقرير الكامل:** `.factory/qa/runs/2026-11-27-rc2-reverify-smoke.md` + الأدلة `.factory/qa/evidence/rc2/`.
  - **`proof check` على `f487af8`: NOT DONE.** أداة `proof` محتاجة سجل gates ناجح وسجل لكل رحلة على نفس الـ SHA. `ci-flows all` بتنزل أدلة الجولة والـ APK، و`proof check` بتقرا سجلاتها من مخزن أدلة المصنع. الرحلة المؤجلة لسه بتظهر ضمن النواقص في `proof check`.
- **اختبارات GitHub العامة — run `46018910006` (ريبو `rewiaty-agent-testers`، مصدر التطبيق `ef081d0` = دمج #82):** ❌ **FAIL** — الـ build ورفع الـ APK نجحوا، والخطوة اللي فشلت هي `Run Maestro flows on Android API 34 x86_64`. **22 رحلة: 20 PASS · 2 FAIL** — `rotate-position` (مؤجلة بقرار منتج، مش gating) و`chapter-timeline`.
  - **`chapter-timeline`:** الفيديو بيوري الـ tooltip ظاهر بوضوح بعد الـ swipe، لكن أول assert بيشتغل بعد ما اختفى. اللوج: الـ swipe يبدأ `15:15:58.237` وأول assert `15:16:02.141`؛ مدة الجستشر `800ms`، و`TOOLTIP_LINGER_MS` في `apps/mobile/src/components/page-scrubber.tsx` = `1800ms`.
  - **الإصلاح:** `waitToSettleTimeoutMs: 500` على نفس `swipe` في `apps/mobile/.maestro/chapter-timeline.yaml` (المفتاح الرسمي في Maestro للحد من انتظار settle بعد الجستشر). كل الـ asserts والقيم ومدة السحب `800ms` وكود التطبيق زي ما هي. `maestro check-syntax` = **OK**، والـ parser أثبت 18 أمر بنفس الترتيب و6 `assertVisible` و3 screenshots، والتغيير الوحيد هو المفتاح المضاف على الـ swipe.
- **التحقق من `f487af8`:** [gates العامة عدّت](https://github.com/sohailcollege2032008-tech/rewiaty-agent-testers/actions/runs/46075451574) بـ 118 Playwright و780 Jest. [جولة الرحلات الكاملة](https://github.com/sohailcollege2032008-tech/rewiaty-agent-testers/actions/runs/46075265488) جارية وقت التحديث.
- **اللي PR #82 (`fix/l5-rc2-maestro-dict-meta-docs`) قفله بعد الدمج:**
  - **F-1** `long-book-open`: كان بيقرأ `reader-page-counter` جوه الـ HUD المقفول ← بقى `reader-running-numbers` (فوتر دائم) بدون لمس `timeout: 2000`.
  - **F-2** `keep-awake`: نفس العنصر المخفي ← بقى `reader-running-numbers`.
  - **F-3** `lighting-themes`: صفوف F31 دفعت stepper الدفء/السطوع تحت الشاشة ← `scrollUntilVisible` قبل القراءة، ونفس القيم المطلوبة حرفيًا.
  - **عدّاد القاموس:** كان ثابت `DICTIONARY_ENTRY_COUNT = 15735` بينما الملف المبني فيه **15,714** مدخل ← «عن التطبيق» بيقرأ `dump_date`/`entry_count` من جدول `meta` جوه الـ SQLite (وقت التشغيل)، والثوابت مجرد fallback لما الداتابيز مش موجودة.
- **RC1 (مرجع قديم عن `91e4a4d`):** Clean CI Gates PASS (`45849171616`, `45906201559`) · Device Flows `45906206340`: 12/12 رحلات gating PASS · Universal `70.08 MB` · ARM64 `41.47 MB` (`80748909…`).

## ملخص موجة QA الأولى (r1 — 2026-11-26 / 2026-11-27)
- **التقارير:** `.factory/qa/runs/2026-11-26-global-qa-r1.md`, `2026-11-26-visual-qa-r1.md`, `2026-11-27-novice-ux-r1.md`, `2026-11-27-perf-qa-r1.md`، والتقييم المقارن `.factory/qa/agent-testers-eval.md`.
- **الـ P1s الأربعة اتقفلت واتأكدت على الجهاز:** `#44` (PR `#75`) · `#56` (PR `#65`) · `#57` (PR `#66`) · `#79` (PR `#80`).
- **الـ P2/P3 المغلقة:** `#45` (`#62`) · `#46` (`#63`) · `#47`–`#50`, `#58`, `#59` (`#74`) · `#52`, `#61` (`#67`) · `#60` (`#68`).

## غير حاجز — P2/P3 مفتوحة (بعد التسليم)
- `#70`, `#71` (أداء APK / كاش `readBookBundle`)
- `#72`, `#51` (لمسات L4 P2/P3)

## الخطوة التالية حتى التسليم
1. دمج PR إصلاح `chapter-timeline` (سطر `waitToSettleTimeoutMs: 500` في `.maestro/chapter-timeline.yaml`).
2. على `origin/main` بعد الدمج: `rewiaty-gates.yml` + `scripts/ci-flows.sh all` + `proof check` (لازم `DONE`).
3. بناء APK نهائي من نفس الـ SHA وتسليمه للمدير مع تقرير RC2 (`.factory/qa/runs/2026-11-27-rc2-reverify-smoke.md`).
4. `rotate-position` مؤجلة بقرار منتج — مش gating، ومش جزء من شرط التسليم.

## مستني سهيل
- (مفيش — قرار `rotate-position` اختياري ومؤجل)
