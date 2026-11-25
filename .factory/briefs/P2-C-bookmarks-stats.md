# P2-C — العلامات المرجعية بـ anchor نصي (F16) + وقت القراية والإحصائيات والـ streak (F23)

- **الدور:** إنت عامل (`implementer`)، نفّذ بنفسك ومتفوّضش.
- **الفرع:** `feat/p2-c-bookmarks-stats` من `origin/main` (اعمل `git fetch origin && git checkout -b feat/p2-c-bookmarks-stats origin/main`).
- **الملفات المسموحة فقط:**
  - ملفات جديدة:
    - `apps/mobile/src/storage/bookmarks.ts`
    - `apps/mobile/src/storage/__tests__/bookmarks.test.ts`
    - `apps/mobile/src/storage/reading-stats.ts`
    - `apps/mobile/src/storage/__tests__/reading-stats.test.ts`
    - `apps/mobile/src/components/reading-stats-panel.tsx`
    - `apps/mobile/src/components/__tests__/bookmarks-stats.test.tsx`
  - لمسات محدودة ومقصودة فقط في:
    - `apps/mobile/src/types/reader.ts` (إضافة `BookmarkItem` وحقل اختياري `bookmarkItems?: BookmarkItem[]` داخل `BookReaderState` مع الإبقاء على `bookmarks?: number[]` للتوافق العكسي)
    - `apps/mobile/src/storage/bundle.ts` (في `readBookBundle` فقط: قراءة وحفظ `bookmarkItems` من `.reader-state.json` — **ممنوع** تلمس `importBookContent` أو `deleteBookBundle`)
    - `apps/mobile/src/components/toc-modal.tsx` (إضافة تبويبات في أعلى الـ drawer: «الفصول» (الافتراضي — يفضل بنفس الـ `testID`s القديمة بالظبط)، و«العلامات» لعرض/الانتقال/حذف العلامات المرجعية، و«الإحصائيات» لعرض `ReadingStatsPanel`)
    - `apps/mobile/src/screens/reader-screen.tsx` (تحديث `handleToggleBookmark` لحفظ `BookmarkItem` بـ anchor + quote + context، ربط `ReadingSessionTracker` مع `position` و`AppState`، وتمرير props العلامات والإحصائيات لـ `TocModal`، وعرض الوقت المتبقي بشكل هادئ في الـ running footer لما يتوفر — **ممنوع** تلمس `useLocalSearchParams` بتاع الـ route أو `ReaderHud` أو `ReaderSettingsSheet`)
- **ممنوع تماماً:**
  - لمس `packages/reader-engine/**` أو `packages/book-format/**`.
  - لمس `apps/mobile/src/components/reader-hud.tsx` أو `reader-settings-sheet.tsx`.
  - لمس `apps/mobile/src/storage/database.ts` أو `apps/mobile/src/screens/library-screen.tsx` أو `apps/mobile/src/app/**`.
  - أي build على السيرفر (`mobile-run` ممنوع). لو لقيت باج خارج نطاقك اكتبه في التقرير بس ومتصلّحوش.

## المتطلبات ومعايير القبول

### 1. F16 — العلامات المرجعية (`apps/mobile/src/storage/bookmarks.ts`)
- النوع `BookmarkItem`:
  ```ts
  export type BookmarkItem = {
    id: string;
    anchor: Anchor; // { blockId, charOffset }
    chapterId: string;
    chapterTitle: string;
    quote: string;         // مقتطف حتى ~80 حرف من مكان العلامة
    contextBefore: string; // حتى ~25 حرف قبل المقتطف
    contextAfter: string;  // حتى ~25 حرف بعد المقتطف
    page?: number;
    createdAt: number;
  };
  ```
- `extractBookmarkContext(book: Book, anchor: Anchor): { chapterId: string; chapterTitle: string; quote: string; contextBefore: string; contextAfter: string }`: يستخرج النص الصافي (بدون HTML tags مع الحفاظ على التشكيل) من الـ block عند `charOffset`.
- `resolveBookmarkAnchor(book: Book, item: BookmarkItem): Anchor`: لو الـ `blockId` موجود ولسه يحتوي الـ `quote` يرجّع `item.anchor`؛ لو النص اتغير/انزاح يبحث بالـ `quote` + `contextBefore`/`contextAfter` داخل الفصل ثم الكتاب عشان يرجّع أقرب `Anchor` صحيح!
- `normalizeBookmarkItems(rawItems: unknown, legacyPages: unknown, book?: Book): BookmarkItem[]`: يحافظ على العلامات القديمة الرقمية (إن وُجدت) بدون crash ولا فقدان.
- `isPositionBookmarked(items: BookmarkItem[], anchor: Anchor | null, page: number): boolean` و`toggleBookmarkAtPosition(...)` و`removeBookmarkById(...)`.
- في `TocModal` (تبويب «العلامات» `testID="toc-tab-bookmarks"`):
  - يعرض قائمة العلامات مرتبة من الأحدث للأقدم، لكل علامة: اسم الفصل، ومقتطف النص `«...»`، ورقم الصفحة إن وُجد، وزرار حذف (`testID="bookmark-delete-<id>"`).
  - الضغط على علامة ينقل القارئ عبر `postToEngine({ type: 'goto', anchor: resolveBookmarkAnchor(book, item) })` ويقفل الـ drawer.
  - حالة فاضية بالعربي: «لا توجد علامات مرجعية بعد. المس الشريطة لحفظ موضعك.»

### 2. F23 — وقت القراية والإحصائيات والـ Streak (`apps/mobile/src/storage/reading-stats.ts`)
- **تخزين الإحصائيات:** باستخدام `getKv`/`setKv` الموجودة في `database.ts` تحت المفتاح `'reading_stats_v1'` (صفر تعديل في schema قاعدة البيانات!).
- **حساب WPM الحقيقي + بوابة الخمول (`INACTIVITY_GATE_MS = 3 * 60 * 1000`):**
  - `ReadingSessionTracker` (يقبل `now?: () => number` لاختبارات حتمية بدون `setTimeout` حقيقي!):
    - يستقبل أحداث التقليب `recordProgress({ chapterId, page, pageCount, wordsPerPageEstimate, timestamp })`.
    - **Inactivity gate:** لو الفرق بين آخر حركة والحركة الحالية > 3 دقايق (180,000 ms)، الفترة الخاملة دي **لا تُحسب** ضمن وقت القراءة الفعلي ولا تدخل في حساب WPM.
    - يتجاهل القفزات غير الواقعية (مثلاً قفزة من الفهرس أو scrubber أو زمن < 3 ثواني لصفحة كاملة أو WPM خارج `[60, 600]`) عند تحديث المتوسط المتحرك (EWMA) للـ WPM، مع قيمة ابتدائية منطقية `DEFAULT_WPM = 180` قبل توفر عينات كافية.
    - يحسب:
      - `effectiveWpm`: سرعة القراءة الحالية (كلمة/دقيقة).
      - `chapterRemainingMinutes`: الوقت المتبقي للفصل الحالي.
      - `bookRemainingMinutes`: الوقت المتبقي للكتاب كله.
      - `estimatedFinishDate`: تاريخ متوقع لإنهاء الرواية بناءً على متوسط القراءة اليومي (مع fallback منطقي مثل 30 دقيقة/يوم لو لسه مفيش أيام كافية).
- **Streak وتقويم أيام القراءة:**
  - `toLocalDateKey(ts: number): string` بصيغة `YYYY-MM-DD` بالتوقيت المحلي.
  - `recordDailyReading(stats, dateKey, addedActiveMs, addedWords)`: يحدّث سجل اليوم (يحسب اليوم «يوم قراءة» لو قرأ ≥ 60 ثانية أو ≥ 50 كلمة).
  - `computeStreak(days, todayKey): { currentStreak: number; longestStreak: number; readToday: boolean }`:
    - يحسب الـ streak الحالي (بما في ذلك لو قرأ امبارح ولسه مقراش النهاردة يفضل الـ streak محفوظ لحد آخر اليوم)، وأطول streak، وحالة اليوم.
  - `buildReadingCalendar(days, year, month)`: يولّد مصفوفة أيام الشهر لحالة كل يوم (قرأ / لم يقرأ / اليوم الحالي / عدد الدقائق).
- **دوال تنسيق عربية نقية:** `formatDurationArabic(minutes)` (مثل «أقل من دقيقة»، «١٢ دقيقة»، «ساعة و٢٠ دقيقة»)، و`formatExpectedFinishArabic(date, now)` (مثل «اليوم»، «غداً»، أو تاريخ عربي واضح).
- **واجهة الإحصائيات (`apps/mobile/src/components/reading-stats-panel.tsx`):**
  - تظهر داخل تبويب «الإحصائيات» (`testID="toc-tab-stats"`) في `TocModal` بتصميم «الوَرّاق» (`getAppThemeTokens`):
    - سرعة القراءة (كلمة/دقيقة)
    - الوقت المتبقي للفصل + الوقت المتبقي للكتاب
    - التاريخ المتوقع لإنهاء الرواية
    - الـ Streak الحالي وأطول streak
    - تقويم الشهر الحالي (أيام القراءة مميّزة بلون `palette.accent`)
- كل النصوص الظاهرة للقارئ بالعربي فقط، وأي رسالة خطأ (إن وُجدت) تعدّي على حارس عربي (ممنوع أي رسالة إنجليزية تقنية).

### 3. اختبارات شاملة
- **`apps/mobile/src/storage/__tests__/bookmarks.test.ts`**: استخراج `quote`+`context` مع الحفاظ على التشكيل، إعادة التثبيت (fuzzy re-anchoring) لما الفقرة تتنقل أو يتغير `blockId`، التوافق مع العلامات الرقمية القديمة، الإضافة والحذف.
- **`apps/mobile/src/storage/__tests__/reading-stats.test.ts`**: حساب WPM من تقليب حقيقي، **بوابة الخمول 3 دقايق** (فجوة 4 دقايق لا تزيد الوقت ولا تهبط بالـ WPM)، رفض القفزات غير الواقعية (TOC jump / 100ms)، الوقت المتبقي للفصل والكتاب، التاريخ المتوقع، حساب الـ streak (متصل، متقطع، عبور شهر/سنة، قرأ أمس فقط)، وبناء تقويم الشهر.
- **`apps/mobile/src/components/__tests__/bookmarks-stats.test.tsx`**: تبويبات `TocModal` (الفصول الافتراضي، العلامات مع الضغط والحذف، الإحصائيات مع الـ streak والتقويم). **مهم:** render واحد لكل `it` (ممنوع render مرتين في نفس الاختبار علشان `act()`).
- كل الاختبارات القائمة (`reader-screen.test.tsx`, `bundle.test.ts`, إلخ) تعدّي خضرا من غير تعديل يضعّف أي اختبار قديم.

## قواعد الشغل والتسليم (إلزامي)
- **كل الاختبارات والأوامر في المقدمة (foreground).** ممنوع background.
- **ممنوع ترد بـ «جاري» أو «هكمّل» قبل ما الـ PR يتفتح.** ردّك الوحيد بعد فتح الـ PR ونتائج التحقق.
- **ممنوع أي build على السيرفر.**
- شغّل محلياً في المقدمة: `npm --workspace=@rewiaty/mobile run typecheck` و`npm --workspace=@rewiaty/mobile test`.
- اعمل commit على `feat/p2-c-bookmarks-stats`، وpush، وافتح PR على `main`.
- **لأن المسار ده بيلمس حسابات وتوقيت (F23):** شغّل `rewiaty-gates.yml` على GitHub Actions (`sohailcollege2032008-tech/rewiaty-agent-testers` بـ `-f src_ref=src/<sha12>`) **3 مرات متتالية** وتأكد إن التلاتة `success`.
- شغّل `bash scripts/ci-flows.sh all` في المقدمة وتأكد إنها 5/5.
- آخر سطر في ردك: `PR <URL> | head <SHA> | jest <pass/total> | gates 3x <3 run URLs> | flows <5/5 & run URL>` + أي ملاحظة خارج النطاق.
