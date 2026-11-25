# P2-B — البحث: SQLite FTS5 وقت الاستيراد + شاشة البحث والتنقل للمكان (F15)

- **الدور:** إنت عامل (`implementer`)، نفّذ بنفسك ومتفوّضش.
- **الفرع:** `feat/p2-b-search` من `origin/main` (اعمل `git fetch origin && git checkout -b feat/p2-b-search origin/main`).
- **الملفات المسموحة فقط:**
  - ملفات جديدة:
    - `apps/mobile/src/storage/search-normalize.ts`
    - `apps/mobile/src/storage/search-index.ts`
    - `apps/mobile/src/storage/__tests__/search-index.test.ts`
    - `apps/mobile/src/screens/search-screen.tsx`
    - `apps/mobile/src/screens/__tests__/search-screen.test.tsx`
    - `apps/mobile/src/app/search.tsx`
  - لمسات صغيرة ومحدودة فقط في:
    - `apps/mobile/src/storage/database.ts` (استدعاء `initSearchSchema(db)` جوه `initDatabase` بس)
    - `apps/mobile/src/storage/bundle.ts` (فهرسة الكتاب في `importBookContent` وحذف فهرسه في `deleteBookBundle` فقط — **ممنوع** تلمس `readBookBundle` أو `saveBookReaderState`)
    - `apps/mobile/src/app/_layout.tsx` (إضافة `<Stack.Screen name="search" />` فقط)
    - `apps/mobile/src/screens/library-screen.tsx` (زرار أيقونة البحث في `headerActions` جنب زرار الاستيراد فقط، `testID="library-search-button"`، يفتح `/search` — متلمسش كود الاستيراد أو الكروت)
    - `apps/mobile/src/screens/reader-screen.tsx` (استقبال `blockId` و`charOffset` اختياريين في `useLocalSearchParams` علشان لما القارئ يضغط نتيجة بحث يروح للـ `anchor` ده سواء في أول `load` أو عبر `goto` بعد `ready` — متلمسش العلامات أو الـ HUD أو الإعدادات)
- **ممنوع تماماً:**
  - لمس `packages/reader-engine/**` أو `packages/book-format/**`.
  - لمس `apps/mobile/src/components/reader-hud.tsx` أو `reader-settings-sheet.tsx` أو `toc-modal.tsx`.
  - لمس `apps/mobile/src/types/reader.ts` (مش محتاج تغييره).
  - أي build على السيرفر (`mobile-run` ممنوع). لو لقيت باج خارج نطاقك اكتبه في التقرير بس ومتصلّحوش.

## المتطلبات ومعايير القبول (F15)

### 1. تطبيع النص العربي للبحث (`apps/mobile/src/storage/search-normalize.ts`)
- `stripHtmlToPlainText(html: string): string`: يشيل HTML tags ويفك entities الأساسية (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&nbsp;`) ويشيل أرقام الحواشي `<sup class="fn-ref">...</sup>` من غير كسر الكلمات.
- `normalizeArabicForSearch(input: string): string`:
  - يشيل كل علامات التشكيل العربي (`\u064B-\u065F`, `\u0670`, `\u06D6-\u06ED`) والتطويل (`\u0640`).
  - يوحّد الهمزات: `أ` و`إ` و`آ` و`ٱ` → `ا` (وكذلك `ؤ`→`و`؟ لأ: التزم بالمكتوب في المواصفة: `أ/إ/آ/ٱ` → `ا`، و`ة` → `ه`، و`ى` → `ي`).
  - يحوّل الحروف الإنجليزية لـ lowercase ويوحّد المسافات.
- دالة `findMatchOffsetInOriginal(originalText: string, normalizedQuery: string): number`: ترجّع الـ `charOffset` الحقيقي داخل النص الأصلي (المشكّل) لبداية أول تطابق، علشان الـ anchor يودّي للفقرة والـ offset الدقيق!
- دالة `buildSearchSnippet(originalText: string, matchOffset: number, queryLength: number, radius?: number)`: ترجّع مقتطف نصي (`before`, `match`, `after`) مع `…` عند الحواف.

### 2. فهرس SQLite FTS5 (`apps/mobile/src/storage/search-index.ts`)
- جدول افتراضي FTS5:
  ```sql
  CREATE VIRTUAL TABLE IF NOT EXISTS book_search_fts USING fts5(
    book_id UNINDEXED,
    chapter_id UNINDEXED,
    chapter_title UNINDEXED,
    block_id UNINDEXED,
    raw_text UNINDEXED,
    norm_text,
    tokenize = 'unicode61'
  );
  ```
- `initSearchSchema(db: DatabaseAdapter): Promise<void>`: ينشئ الجدول بأمان.
- `indexBookForSearch(book: Book, db?: DatabaseAdapter): Promise<void>`:
  - يحذف أي صفوف قديمة لنفس `book.id` ثم يدرج كل blocks النصية (`kind !== 'break' && kind !== 'image'`, نصها غير فاضي) بـ `raw_text` (النص المشكّل الصافي) و`norm_text` (النص المطبّع).
  - يعمل بسلام مع الـ in-memory mock في `bundle.test.ts` (لو قاعدة البيانات mock بسيطة لا تكرش الاستيراد).
- `removeBookFromSearch(bookId: string, db?: DatabaseAdapter): Promise<void>`: يحذف كل صفوف الكتاب من `book_search_fts`.
- `buildFtsQuery(rawQuery: string): string`: يطبّع استعلام المستخدم ويهرب علامات FTS5 الخاصة (`"`, `*`, `^`, `(`, `)`, `:`, `-`, `+`, `OR`, `AND`, `NOT`, `NEAR`) بحيث أي إدخال من المستخدم (حتى لو فيه رموز غريبة) عمره ما يرمي SQL syntax error! يدعم prefix matching على آخر كلمة (`token*`) للبحث اللحظي السلس.
- `searchLibrary(query: string, options?: { bookId?: string; limit?: number }, db?: DatabaseAdapter): Promise<SearchHit[]>`:
  - يرجّع نتائج فيها: `{ bookId, bookTitle, chapterId, chapterTitle, blockId, charOffset, snippetBefore, snippetMatch, snippetAfter }`.
  - يرتّب بالصلة (`bm25(book_search_fts)`).
  - يدعم البحث في المكتبة كلها أو في كتاب واحد (`bookId`).
  - يعمل في **أقل من 15ms** على مكتبة فيها عدة فصول/كتب.
- `ensureLibrarySearchIndexed(db?: DatabaseAdapter): Promise<void>`: لو فيه كتب موجودة في جدول `books` قبل التحديث ومش مفهرسة في `book_search_fts`، يفهرسها من `readBookBundle` مرة واحدة في الخلفية/عند فتح البحث بحيث الكتب القديمة (مثل «حَجَرُ الْمَاءِ») تظهر في البحث فوراً.

### 3. شاشة البحث (`apps/mobile/src/screens/search-screen.tsx` + `apps/mobile/src/app/search.tsx`)
- تصميم متناسق 100% مع ثيم «الوَرّاق» (`getAppThemeTokens` و`useResponsiveLayout` و`TYPOGRAPHY`)، بالكامل **بالعربي** RTL.
- لو اتفتحت بـ `bookId` (query param اختياري)، تعرض اختيار النطاق «في هذا الكتاب» / «في المكتبة كلها»؛ غير كده تبحث في المكتبة كلها.
- حقل بحث (`testID="search-input"`) بـ debounce خفيف (150ms) وزرار مسح وزرار رجوع.
- كل نتيجة تعرض: عنوان الكتاب (في بحث المكتبة)، اسم الفصل، والمقتطف مع تمييز الكلمة المطابقة بلون `palette.accent`.
- الضغط على نتيجة (`testID="search-result-<index>"`) ينقلك إلى `/reader/[id]` مع `params: { id: hit.bookId, blockId: hit.blockId, charOffset: String(hit.charOffset) }`.
- حالات واضحة بالعربي: قبل الكتابة («ابحث في رواياتك…»)، جاري البحث، لا توجد نتائج، وأي خطأ يعدّي على حارس عربي (مثل `readerErrorMessage` — ممنوع يظهر أي خطأ إنجليزي تقني للقارئ).

### 4. اختبارات شاملة
- **`apps/mobile/src/storage/__tests__/search-index.test.ts`**:
  - استخدم SQLite **حقيقي** في الذاكرة عبر Node 22 المدمج `require('node:sqlite').DatabaseSync(':memory:')` مغلّفاً بـ `DatabaseAdapter` (بيشتغل على FTS5 حقيقي!).
  - اختبر: الفهرسة وقت الاستيراد، البحث مع تجاهل التشكيل («حجر الماء» يلاقي «حَجَرُ الْمَاءِ»)، توحيد الهمزات (`أ/إ/آ` ↔ `ا`)، التاء المربوطة (`ة` ↔ `ه`)، الألف المقصورة (`ى` ↔ `ي`)، البحث بكتاب محدد مقابل المكتبة كلها، حذف كتاب يمسح نتائجه، هروب الرموز الخاصة في FTS5 (مفيش crash)، دقة `charOffset` في النص المشكّل، واختبار أداء يثبت إن البحث في مكتبة متعددة الكتب والفصول أقل من **15ms** (قيس متوسط عدة استعلامات بعد warm-up).
- **`apps/mobile/src/screens/__tests__/search-screen.test.tsx`**:
  - render واحد لكل `it` (ممنوع render مرتين في نفس الاختبار علشان `act()`).
  - اختبر: الكتابة وعرض النتائج والتمييز، عدم وجود نتائج، والضغط على نتيجة ينادي `router.push` بـ `blockId` و`charOffset` الصح، وحماية رسائل الخطأ بالعربي.
- اختبر كمان إن `reader-screen.test.tsx` و`library-screen.test.tsx` و`bundle.test.ts` كلهم خضر ومن غير أي تعديل يضعّف اختبار قديم!

## قواعد الشغل والتسليم (إلزامي)
- **كل الاختبارات والأوامر في المقدمة (foreground).** ممنوع background.
- **ممنوع ترد بـ «جاري» أو «هكمّل» قبل ما الـ PR يتفتح.** ردّك الوحيد بعد فتح الـ PR ونتائج التحقق.
- **ممنوع أي build على السيرفر.**
- شغّل محلياً في المقدمة: `npm --workspace=@rewiaty/mobile run typecheck` و`npm --workspace=@rewiaty/mobile test`.
- اعمل commit على `feat/p2-b-search`، وpush، وافتح PR على `main`.
- شغّل `rewiaty-gates.yml` على GitHub Actions (`sohailcollege2032008-tech/rewiaty-agent-testers` بـ `-f src_ref=src/<sha12>`) واستنى النتيجة لحد `conclusion == success`.
- شغّل `bash scripts/ci-flows.sh all` في المقدمة وتأكد إنها 5/5.
- آخر سطر في ردك: `PR <URL> | head <SHA> | jest <pass/total> | gates <run URL> | flows <5/5 & run URL>` + أي ملاحظة خارج النطاق.
