# STATE — روايتي
- **المرحلة:** 1 + 2 مدموجتين، والمرحلة 4 (L3) مدموج أغلبها، والمرحلة 3 (L4) وموجة QA الأولى (L5) في التنفيذ والمراجعة · **آخر تحديث:** 2026-11-27
- **إحصائيات `.factory/FEATURES.md` (`node scripts/feature-stats.mjs`):**
  - المرحلة 1 (القارئ): 73/77 بند (95%) · بوابات 65/85 (76%)
  - المرحلة 2 (المحرك): 26/31 بند (84%) · بوابات 23/45 (51%)
  - المرحلة 3 (اللمسات UX): 0/37 بند مسجّل (قيد مراجعة PRs L4)
  - المرحلة 4 (AI + Backend): 3/58 بند مسجّل (PRs `#32`–`#39` مدموجة، `#64`/`#69` قيد المراجعة)
- **الموديلات:** القادة على Gemini 4 Neon (`antigravity_sohail6`)، والعمّال على OpenCode `go-locked/deepseek-v4.1-flash` (حد أقصى عاملين بالتوازي، fallback Hydrogen)، والمراجعة النهائية على Codex (`gpt-6.2-sol`)، والدمج على Claude. القواعد: `.factory/briefs/LEADS-COMMON.md`.

| Milestone / المسار | الحالة | المرجع / PR |
|---|---|---|
| M0–M3 (الأساس + المحرك + الإعدادات + التصميم) | ✅ مدموجة | `#1`–`#17` |
| المرحلة 2 (F10–F20: حواشي، تظليل، بحث FTS5، تنظيف، zip/epub، R5) | ✅ مدموجة | `#18`–`#26`, `#30`, `#31` |
| L1 Backend Core + L2 PDF Pipeline | 🟡 قيد العمل | `rewiaty-backend` |
| L3 App Phase 4 (F40 BYOK, F42 PDF, F46 Placeholder, F48 Mission Control, F49 Dictionary, OpenAPI/SSE) | 🟡 أغلبها مدموج، وتكامل نهائي قيد المراجعة | مدموج: `#32`, `#33`, `#34`, `#36`, `#37`, `#39` · مفتوح: `#64`, `#69` |
| L4 Phase 3 UX + إصلاحات P1/P2 | 🟡 قيد المراجعة | مفتوح: `#35`, `#38`, `#40`, `#42`, `#43`, `#53`, `#54`, `#65` (P1 `#56`), `#66` (P1 `#57`), `#68` (P2 `#60`) · `#44` قيد العمل |
| L5 Release + QA Wave r1 | 🟡 موجة QA r1 مكتملة (4 أدوار + `layla`/`grace`) + إصلاحات L5 جاهزة للدمج | مدموج: `#55`, `#62` (`#45`) · جاهز للدمج: `#63` (`#46`), `#67` (`#52`, `#61`) |
| `mobile-agent-testers` (`layla` + `grace`) | ✅ مكتمل ومُقيَّم (متوسط 6.5/10 مقابل 6.0/10؛ تقييم كامل في `.factory/qa/agent-testers-eval.md`) | run `45906946090` (`sohailcollege2032008-tech/rewiaty-agent-testers`) |

## حالة Release Candidate & `proof check`
- **آخر RC APK مبني ومُختبر (عن `91e4a4d`):**
  - Clean CI Gates (`rewiaty-gates.yml`): ✅ PASS (runs `45849171616`, `45906201559`)
  - Device Flows (`rewiaty-flows.yml`, run `45906206340`): **12/12 رحلات gating PASS** (`first-launch-sample`, `import-md`, `resume-position`, `settings-live`, `open-with-telegram`, `drag-page-direction`, `footnote-popover`, `keep-awake`, `scrubber-direction`, `import-epub`, `import-epub-broken`, `highlight-add`). غير gating: `rotate-position` (مؤجلة لقرار منتج) و`long-book-open` (`measure-only`: 2893 ms في `45846756202`).
  - أحجام RC1 (`45846756202`): Universal `70.08 MB` (SHA256 `66a01d0a…`) · ARM64 `41.47 MB` / `39.55 MiB` (SHA256 `80748909…`).
- **`proof check`:** لم يُحسم بـ `DONE` بعد — مطلوب بناء RC جديد و`gates` + جميع رحلات `.factory/flows.yaml` على أحدث `origin/main` بعد دمج إصلاحات الـ P1 الثلاثة (`#44`, `#56`, `#57`) وموجة الدمج الحالية.

## ملخص موجة QA الأولى (r1 — 2026-11-26 / 2026-11-27)
- **التقارير:** `.factory/qa/runs/2026-11-26-global-qa-r1.md`, `2026-11-26-visual-qa-r1.md`, `2026-11-27-novice-ux-r1.md`, `2026-11-27-perf-qa-r1.md`, والتقييم المقارن `.factory/qa/agent-testers-eval.md`.
- **الـ P1 المفتوحة (3 — كلها `lane:L4` ومُبلَّغ بها قائد L4):**
  - `#44` (ضياع المكان عند anchor في فصل فاضي) — قيد الإصلاح في L4
  - `#56` (الكيبورد يغطي حفظ الملاحظة والرجوع يضيعها) — إصلاح مفتوح في PR `#65`
  - `#57` (صفحة نصف مقلوبة مجمدة بعد `force-stop` عند 200%) — إصلاح مفتوح في PR `#66`
- **الـ P2/P3 من L5:** `#45` ✅ أُغلق بـ PR `#62` · `#46` جاهز للدمج بـ PR `#63` · `#52` و`#61` جاهزان للدمج بـ PR `#67` · `#70` و`#71` (أداء APK / كاش `readBookBundle`) مفتوحة للتخطيط بعد التسليم.
- **الـ P2/P3 من L4:** `#47`, `#48`, `#49`, `#50`, `#51`, `#58`, `#59`, `#60` (إصلاح في PR `#68`), `#71`, `#72`.

## الخطوة التالية حتى التسليم
1. دمج PRs L5 الجاهزة (`#63`, `#67`, وPR توثيق QA/STATE الحالي) وPRs إصلاحات L4 للـ P1 (`#44`, `#65`, `#66`) وPRs L3/L4 المعتمدة.
2. بناء Release Candidate جديد من `origin/main` وتشغيل `rewiaty-gates.yml` + `scripts/ci-flows.sh all` + `proof check`.
3. جولة re-verify (جولة 2) للتأكد من إغلاق كل الـ P1 (`0 open P1`) + smoke QA للشاشات المدمجة حديثاً من L3/L4 ← التسليم النهائي للمدير برابط الـ APK وتقرير الـ QA الكامل.

## مستني سهيل
- (مفيش — قرار `rotate-position` اختياري ومؤجل)
