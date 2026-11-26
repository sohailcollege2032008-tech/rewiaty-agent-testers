# STATE — روايتي
- **المرحلة:** 1 (القارئ) · Build · آخر تحديث 2026-11-26
- **الموديلات:** التنفيذ على Hydrogen، والمهام الأقل على OpenCode deepseek، والمراجعة على Codex، والدمج على Claude
| Milestone | الحالة | الثريد / PR |
|---|---|---|
| M1 Engine | ✅ اتدمج (#1). وCodex لقى XSS في مصادر الصور، واتصلح | #1 · follow-up #3 (P2) |
| M0 Sample | ✅ اتدمج (#2) | #2 |
| M-QA infra | ✅ rewiaty-agent-testers شغال (demo: 14 finding، $0، Go allowance) | github.com/sohailcollege2032008-tech/rewiaty-agent-testers |
| M2 Shell | ✅ اتدمج (#4). وfollow-up #5 | #4 |
| M3 Settings | ✅ مدموج #6 (64d4566) | Hydrogen + إصلاحات deepseek، Codex approve |
| M4 Release+QA | ⏳ | |
| Book Lab (أمواج PDF → bundle، تجربة pipeline المرحلة 4) | 🟡 Neon (sohailcollege) + deepseek | ثريد Book Lab · ~/workspace/rewiaty-book-lab |

## المسارات المتوازية (من 2026-11-26، قرار سهيل: «اشتغل بكميات هائلة، والجودة متتأثرش»)
القادة على Neon (`antigravity_sohail6`)، والعمّال deepseek (OpenCode) وHydrogen، والمراجعة النهائية Codex، والدمج Claude. القواعد: `.factory/briefs/LEADS-COMMON.md`.
| المسار | النطاق | الريبو |
|---|---|---|
| L1 Backend core | F38 وF40 وF41 وF48 (السيرفر) + `contracts/openapi.yaml` | rewiaty-backend |
| L2 PDF pipeline | F39 وF39T (من Book Lab) | rewiaty-backend `pipeline/` |
| L3 App phase-4 | الرفع وBYOK وF42 وF46 وF48 UI وF49 | rewiaty |
| L4 UX | F22 وF21 والمرحلة 3 | rewiaty |
| L5 Release + QA | APK وموجة QA وmobile-agent-testers وissues | rewiaty + rewiaty-agent-testers |
| PR #25 (F20 zip/epub) | إصلاحات مراجعة Codex الثانية (deepseek) | rewiaty |

## الخطة لحد التسليم (قرار سهيل 2026-11-25: «خلّص السيستم كله من غير ما حاجة توقفك»)
1. ✅ M3 اتدمج (#6). المرحلة 1: 81% بنود، 46% بوابات.
2. **Design (0.5، اتعمل متأخر):** design-explorer على Neon بيطلّع 3 اتجاهات. **الاتجاه الموصى بيه هو اللي هيتطبّق** (سهيل يقدر يغيّره من صفحة المقارنة)، وبعدها مهمة redesign تطبّق الـ tokens والشكل (Hydrogen).
3. M4: Release APK (`mobile-run`)، وMaestro flows على Redroid (`app-flow`) للـ 5 رحلات، و`proof check`.
4. QA wave: global-qa، وnovice-ux-qa، وvisual-qa (deepseek، جولة جديدة لكل واحد) + mobile-agent-testers (layla وgrace) ← issues.
5. إصلاح الـ P1، وre-verify (أقصى حاجة 3 جولات) ← تسليم الـ APK لسهيل ومعاه «أمواج».

## مستني سهيل
- (مفيش)
