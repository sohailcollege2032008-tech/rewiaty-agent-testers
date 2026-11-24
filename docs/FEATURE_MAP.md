# Feature Map — روايتي (Rewiaty)

## Mobile Shell (`apps/mobile`)

### 1. المكتبة (Library)
- **Route:** `/` ([`apps/mobile/src/app/index.tsx`](../apps/mobile/src/app/index.tsx)) → [`LibraryScreen`](../apps/mobile/src/screens/library-screen.tsx)
- **Features:**
  - أول تشغيل: بذر الرواية العربية التجريبية (`sample-ar.md`) لمرة واحدة عبر `kv` (`sample_seeded_v1`).
  - عرض كروت الكتب مرتبة بآخر فتح (`lastOpenedAt DESC`) مع العنوان والمؤلف ونسبة التقدم وغلاف مولّد من `coverColor` أو hash العنوان ([`BookCard`](../apps/mobile/src/components/book-card.tsx)، [`BookCover`](../apps/mobile/src/components/book-cover.tsx)).
  - استيراد كتاب `.md` أو `.txt` عبر `expo-document-picker` (`testID="import-book-button"`) مع توحيد الـ `id` بـ content hash.
  - حذف كتاب بالضغط المطول (`longPress`) مع نافذة تأكيد (`Alert.alert`).

### 2. التخزين المحلي (Canonical Bundle + SQLite)
- **Files:** [`apps/mobile/src/storage/database.ts`](../apps/mobile/src/storage/database.ts), [`apps/mobile/src/storage/bundle.ts`](../apps/mobile/src/storage/bundle.ts), [`apps/mobile/src/storage/importer.ts`](../apps/mobile/src/storage/importer.ts)
- **Layout:**
  - `<documentDirectory>/books/<bookId>/book.md`
  - `<documentDirectory>/books/<bookId>/manifest.json`
  - `<documentDirectory>/books/<bookId>/assets/`
  - `<documentDirectory>/books/<bookId>/.reader-state.json`
  - SQLite (`rewiaty.db`): جداول `books` و`kv`.

### 3. القارئ (Reader)
- **Route:** `/reader/[id]` ([`apps/mobile/src/app/reader/[id].tsx`](../apps/mobile/src/app/reader/%5Bid%5D.tsx)) → [`ReaderScreen`](../apps/mobile/src/screens/reader-screen.tsx)
- **Features:**
  - WebView (`testID="reader-webview"`) يحمّل `assets/reader.html` المنسوخ من `packages/reader-engine/dist/reader.html` عبر سكربت `prebuild:assets`.
  - يرسل `load { book, anchor }` عند جاهزية الصفحة، ويستقبل `ready` و`position` و`tap` و`toc` و`error`.
  - حفظ الـ anchor والتقدم تلقائياً مع debounce 500ms وflush عند الخروج أو الخلفية.
  - إبقاء الشاشة مضاءة عبر `expo-keep-awake`.
  - HUD متحرك بـ Reanimated ([`ReaderHud`](../apps/mobile/src/components/reader-hud.tsx), [`PageScrubber`](../apps/mobile/src/components/page-scrubber.tsx)) يظهر/يختفي عند `tap center`:
    - الهيدر: رجوع (`testID="reader-back-button"`), العنوان، الفهرس (`testID="reader-toc-button"`).
    - الفوتر: اسم الفصل، «صفحة X من Y»، وscrubber (`testID="reader-scrubber-track"`) يرسل `goto { page }`.
  - الفهرس ([`TocModal`](../apps/mobile/src/components/toc-modal.tsx)): يعرض الفصول من رسالة `toc` ويرسل `goto { chapterId }` عند اختيار فصل.
