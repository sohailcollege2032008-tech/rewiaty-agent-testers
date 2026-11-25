# P2-A — الصيغة: منظّف النص العربي (F19) + صور Obsidian واكتشاف فصول txt (F20)

- **الدور:** إنت عامل (`implementer`)، نفّذ بنفسك ومتفوّضش.
- **الفرع:** `feat/p2-a-format` من `origin/main` (اعمل `git fetch origin && git checkout -b feat/p2-a-format origin/main`).
- **الملفات المسموحة فقط:** `packages/book-format/**`.
- **ممنوع تماماً:** لمس أي ملف خارج `packages/book-format/**` (خصوصاً `packages/reader-engine/**` و`apps/mobile/**` و`gates.sh`). لو لقيت باج خارج نطاقك اكتبه في تقريرك النهائي بس ومتصلّحوش.

## المتطلبات ومعايير القبول

### 1. F19 — منظّف النص العربي (`packages/book-format/src/cleaner.ts`)
منظّف **non-destructive** (دالة نقية على النص في الذاكرة، لا تعدّل الملف الأصلي أبداً)، تُصدَّر من `packages/book-format/src/index.ts`:
```ts
export type CleanArabicOptions = {
  punctuationSpacing?: boolean; // default true
  arabicQuotes?: boolean;       // default true
  unwrapHardLines?: boolean;    // default true
};
export function cleanArabicText(text: string, options?: CleanArabicOptions): string;
```
- **إزالة المسافات قبل علامات الترقيم (`punctuationSpacing`):** يشيل المسافات/الـ tabs اللي قبل `،` و`؛` و`؟` و`!` و`.` و`:` و`…` من غير ما يبوّظ الأرقام العشرية (`3.5`) ولا الروابط (`https://...`) ولا النقط المتتالية (`...`).
- **علامات التنصيص في الحوار العربي (`arabicQuotes`):** يحوّل `"..."` إلى `«...»` **فقط** لو النص اللي جوه التنصيص فيه حروف عربية (`[\u0600-\u06FF]`)، ويسيب الإنجليزي وسمات HTML/Markdown زي ما هي، وميعبّرش أسطر فاضية، ويسيب علامات التنصيص غير المتوازنة زي ما هي.
- **لزق السطور المكسورة (`unwrapHardLines`):** يلزق السطور المكسورة بـ newline واحد جوه نفس الفقرة بمسافة واحدة، مع الحفاظ الكامل على:
  - السطور الفاضية (فواصل الفقرات).
  - YAML frontmatter (`--- ... ---` في أول الملف).
  - عناوين Markdown (`#`، `##`)، وفواصل المشاهد (`***`، `---`، `___`)، والاقتباسات (`>`)، والصور (`![...]` و`![[...]]`)، وتعريفات الحواشي (`[^id]:`).
  - عناوين فصول `.txt` المكتشفة (تبدأ سطر جديد مستقل).
  - سطور الحوار اللي بتبدأ بـ `- ` أو `— ` أو `– ` أو `«` (متتلزقش في السطر اللي قبلها)، والسطر اللي بينتهي بعلامة نهاية جملة (`.` أو `؟` أو `!` أو `…` أو `»`).
- **حماية التشكيل والـ idempotency:**
  - التشكيل العربي يفضل حرف بحرف وبنفس الـ codepoints من غير أي حذف أو تطبيع.
  - الدالة idempotent: `cleanArabicText(cleanArabicText(s)) === cleanArabicText(s)`.
- **التكامل مع الـ parser:** أضف معامل ثالث اختياري `options?: ParseOptions` لدوال `parseBook` و`parseTxt`:
  ```ts
  export type ParseOptions = {
    cleanArabic?: boolean;    // default false للحفاظ على توافق الاختبارات القائمة والـ hashes
    detectChapters?: boolean; // في parseTxt: default true
  };
  ```
  لما `cleanArabic: true`، يتطبّق التنظيف على متن النص (بعد فصل الـ frontmatter) من غير تعديل النص الأصلي.

### 2. F20 — صيغة Obsidian للصور (`packages/book-format/src/parser.ts` و`sanitize.ts`)
- دعم سطور الصور بصيغة Obsidian:
  - `![[img.webp]]` → `<img src="assets/img.webp" alt="">` (لو اسم ملف بدون `/` يتحوّل لـ `assets/<name>`).
  - `![[images/map.png]]` أو `![[assets/scene.jpg]]` → يحتفظ بالمسار النسبي كما هو.
  - `![[img.webp|وصف الصورة]]` → `alt="وصف الصورة"`.
  - `![[img.webp|300]]` أو `![[img.webp|300x200]]` (مقاس رقمي في Obsidian) → `alt=""`.
- **أمان XSS وpath traversal:**
  - كل مسار صورة يعدّي على `isSafeImageSrc`، وقوّي `isSafeImageSrc` بحيث ترفض path traversal (`..` كـ segment، والـ backslash `\`، والمسار اللي يبدأ بـ `/`).
  - في صيغة Obsidian اقبل بس امتدادات الصور الـ raster الآمنة (`png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`)، وأي رابط غير آمن (`../secret.png`, `/etc/passwd`, `javascript:...`, `evil.svg`) يتحوّل لفقرة نصية escaped (مش `<img>`).

### 3. F20 — اكتشاف الفصول في `.txt` (`packages/book-format/src/txt-chapters.ts` + `parser.ts`)
- صدّر `detectTxtChapterHeading(line: string, context?: { prevBlank: boolean; nextBlank: boolean }): string | null`.
- في `parseTxt` (لما `detectChapters !== false`):
  - يكتشف عناوين الفصول العربية (مع أو بدون تشكيل): `الفصل الأول`، `الفصل 1`، `الفصل ١٢`، `فصل ...`، `الباب ...`، `باب ...`، `الجزء ...`، `المقدمة` / `مقدمة`، `تمهيد`، `الخاتمة` / `خاتمة`.
  - يكتشف عناوين الفصول الإنجليزية: `Chapter 1`، `CHAPTER IV: Title`، `Chapter One`، `Part 1`، `Prologue`، `Epilogue`.
  - يكتشف الأرقام المستقلة على سطر لوحدها (فقط لما قبلها سطر فاضي أو بداية الملف، وبعدها سطر فاضي أو نص، وطول السطر قصير): `1`، `١`، `١٢`، `(١)`، `[1]`، `- 1 -`، `— ١ —`، والأرقام الرومانية (`I`..`L` بشرط أن تكون محاطة بسطور فاضية).
  - **حماية ضد الـ false positives:** أي سطر أطول من 80 حرفاً أو ينتهي بعلامة نهاية جملة طويلة (مثل فقرة سرد تبدأ بكلمة «الفصل ده كان...») لا يُعتبر عنوان فصل.
  - لو فيه نص قبل أول عنوان فصل، يتحط كفصل أول، والفصول التالية تأخذ `ch02`، `ch03`... مع `noIndent: true` لأول فقرة في كل فصل.
  - لو مفيش أي عنوان فصل اتكتشف، يرجّع فصل واحد زي السلوك القديم بالظبط (كل الاختبارات القديمة تفضل خضرا من غير تعديلها!).

## قواعد الشغل والتسليم (إلزامي)
- **كل الاختبارات والأوامر في المقدمة (foreground).** ممنوع background.
- **ممنوع ترد بـ «جاري» أو «هكمّل» قبل ما الـ PR يتفتح.** ردّك الوحيد بعد فتح الـ PR ونتائج التحقق.
- **ممنوع أي build على السيرفر.**
- ممنوع تعدّل أي اختبار قديم علشان يعدّي.
- اختبر محلياً بـ `npm run typecheck` و`npm test` (أضف اختبارات Vitest شاملة في `packages/book-format/test/` تغطي كل معايير F19 وF20 والحالات الحدية والأمان).
- اعمل commit على `feat/p2-a-format`، وpush، وافتح PR على `main`.
- شغّل `rewiaty-gates.yml` على GitHub Actions (الريبو `sohailcollege2032008-tech/rewiaty-agent-testers`):
  ```bash
  SHA12=$(git rev-parse HEAD | cut -c1-12)
  git push -f https://github.com/sohailcollege2032008-tech/rewiaty-agent-testers.git HEAD:refs/heads/src/$SHA12
  gh workflow run rewiaty-gates.yml -R sohailcollege2032008-tech/rewiaty-agent-testers -f src_ref=src/$SHA12
  ```
  واستنى النتيجة في المقدمة لحد ما تخلص وتتحقق إن `conclusion == success`.
- آخر سطر في ردك: `PR <URL> | head <SHA> | vitest <pass/total> | gates <run URL & conclusion>` + أي ملاحظة خارج النطاق.
