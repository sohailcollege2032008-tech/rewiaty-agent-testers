# PLAN — المرحلة 1 (القارئ)

| Milestone | المحتوى | مين | يعتمد على |
|---|---|---|---|
| **M1 Engine** | `packages/book-format` (parser + vitest) و`packages/reader-engine` (pagination + virtualization + bridge + playwright) وصفحة `dev.html` تتفتح في المتصفح | Hydrogen | — |
| **M0 Sample** | `samples/sample-ar.md`: رواية أصلية قصيرة (3–4 فصول)، مشكّلة بالكامل، وفيها كل عناصر الصيغة. ومعاها `samples/long-ar.md` متولّدة (200 ألف كلمة) و`samples/sample-en.md` | OpenCode deepseek | — |
| **M-QA infra** | ريبو `rewiaty-agent-testers` public من الـ template، وOpenCode Go كـ provider، والتأكد إن deepseek بيشوف الصور، وworkflow بياخد APK كـ release asset | OpenCode deepseek | — |
| **M2 Shell** | Expo app: المكتبة، والـ import، والـ bundle storage، والـ sqlite، والرواية التجريبية، وشاشة القراية فيها الـ WebView engine، والـ HUD، والـ TOC، وحفظ المكان | Hydrogen | M1 (العقد في ARCHITECTURE يكفي للبداية) |
| **M3 Settings** | الـ bottom sheet، والخطوط، والثيمات، والـ keep-awake، و«فتح بواسطة» على Android، والأغلفة المولّدة | Hydrogen | M2 |
| **M4 Release+QA** | Release APK (`mobile-run`)، وMaestro flows على Redroid، وجولة mobile-agent-testers، وQA wave (global-qa وnovice-ux-qa وvisual-qa على deepseek) | المدير + deepseek | M3 |

كل milestone = PR على `main`، يراجعه Codex مرة وبعد الإصلاح مرة تانية، وبعدها Claude يعمل المراجعة النهائية والدمج.
