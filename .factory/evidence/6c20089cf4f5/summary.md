# Rewiaty Maestro Flows Summary (`6c20089cf4f5`)

- **Actions Run:** https://github.com/sohailcollege2032008-tech/rewiaty-agent-testers/actions/runs/45626039118
- **Run ID:** `45626039118`
- **APK SHA256:** `377795e95e594e88fd5ba6407c2f405df82de2195640d52d9920db4ffe1f4191`
- **Requested Target:** `all`
- **Workflow Exit Code:** `1`

> ملاحظة: الـ summary ده اتصلّح بالإيد. سكربت `ci-flows.sh` بتاع الرن اللي بعده (45636411175، اتلغى) كتب فوقه جدول MISSING لأنه ملقاش artifacts، فالنسخة دي هي الأرقام الحقيقية من `status.tsv` و`junit/` اللي لسه موجودين في الفولدر.

| Flow | Status | Details |
|---|---|---|
| `first-launch-sample` | **PASS** | maestro exit=0 |
| `import-md` | **FAIL** | flake — شوف تحت |
| `resume-position` | **PASS** | maestro exit=0 |
| `settings-live` | **PASS** | maestro exit=0 |
| `open-with-telegram` | **PASS** | maestro exit=0 |
| `footnote-popover` | **PASS** | F10 OK — popover اتفتح واتقفل ورجع لنفس الصفحة |
| `rotate-position` | **FAIL** | الفلو نفسه كان لسه بيقارن بـ 26 ثابتة — اتصلح بعد كده |
| `keep-awake` | **FAIL** | البارس بتاع الـ runner غلط: القيمة كانت `mWakefulness=Awake` فالمقارنة فشلت، والجهاز كان **صاحي** |
| `long-book-open` | **FAIL** | الـ file picker دخل selection mode (tap بقى long press) فالكتاب مدخلش التطبيق |

## الأدلة

### F10 الحواشي — PASS

- `footnote-popover-commands.json`: كل الأوامر `COMPLETED` (فتح `^1$` ← `footnote-title` ← نص `الصَّدَفَةُ الْبَيْضَاءُ` ← إغلاق عند `50%,35%` ← `footnote-title` اختفى ← `^1$` لسه باين).
- `frames/footnote-popover-open-126s.png`: الـ popover مفتوح، العنوان «حاشية [1]»، والصفحة لسه «صفحة 25 من 26».
- `frames/footnote-popover-closed-same-page.png`: بعد الإغلاق، نفس الصفحة 25 من 26 والرابط `1` لسه في مكانه.

### F3 اللف — كان فاشل بغلط في الفلو نفسه

`rotate-position-commands.json` step 13: `Assertion is false: ".* / ~?26.*" is visible` — الفلو وقع **قبل** ما يلف، لأن الإجمالي بيبدأ تقديري («~25» في الرن ده و«26» في الرن اللي قبله). اتغيّر لـ `copyTextFrom` + مقارنة إن الرقم اتغيّر بعد اللف (commit `9530131`).

### F13 الشاشة متطفيش — الميزة ناجحة، الحكم في البارس غلط

`logs/keep-awake-power.txt` + `logs/keep-awake-maestro.log`:

- الرحلة نجحت: `[Passed] keep-awake (1m 9s)` — يعني الـ 45 ثانية idle اتعملوا.
- بعد الـ idle: `wakefulness: mWakefulness=Awake` (الدالة) مع `screen_off_timeout=30000` — يعني الشاشة فضلت صاحية 45 ثانية ضد timeout 30.
- الـ control (شاشة المكتبة، مفيش قارئ، 40 ثانية): `wakefulness: mWakefulness=Asleep` — يعني الإمولاتور بينام فعلًا.
- الفشل الوحيد إن المقارنة كانت `mWakefulness=Awake != Awake`. اتصلحت في الـ runner (`4fcd078`).

### F2 الرواية الكبيرة — المشكلة في الـ environment مش في الميزة

`long-book-open-commands.json`: `tapOn: "long-ar.md"` رجع `COMPLETED` بعد 11.6 ثانية، لكن `logs/hierarchy-long-book-open.xml` كلها `com.android.documentsui` وفيها `action_menu_bar` + `action_menu_select` — الـ picker دخل selection mode (tap اتحوّل long press لأن حقن الأحداث على إيمولاتور محمّل بيعدّي 500ms)، فالصفقة ما رجعتش للتطبيق خالص. اتغيّر: الـ runner بيدخّل الملف بـ `ACTION_VIEW` وبيستنى `reader-page-counter` قبل ما يعمل force-stop (commit `26f80c9` + `4fcd078`).

### import-md — flake على نفس الكود

نفس الفلو نجح في الرن 45614321052 على نفس الكود بالظبط، وفشل هنا عند `notVisible reader-loading-overlay` اللي بيتحقق بسهولة غلط لما التطبيق ما استلمش الملف أصلًا (نفس ميكانيزم الـ picker). مش من ضمن الرحلات اللي عدّلت فيها.
