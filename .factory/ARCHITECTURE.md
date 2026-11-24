# Architecture — روايتي (المرحلة 1)

## Stack وليه
- **Expo (أحدث SDK مستقر) + React Native + TypeScript strict + expo-router.** قرار سهيل إنه React Native، وExpo هو الـ framework الرسمي المرشّح من React Native. ومعاه dev client (مش Expo Go) علشان الـ native modules.
- **Monorepo بـ npm workspaces:**
  ```
  apps/mobile/            # Expo app (Native shell)
  packages/book-format/   # Parser: md/txt → BookModel. TS نقي، من غير DOM ولا RN. Vitest
  packages/reader-engine/ # محرك القراية: HTML/CSS/TS يتبني لملف reader.html واحد. Playwright
  samples/                # الرواية التجريبية + روايات اختبار (طويلة جداً، LTR، edge cases)
  ```
- **Why (tech):** `<Text>` في RN مفيهوش columns، والـ justify العربي فيه وحش، وحساب الصفحات بإيدك بيقص التشكيل. عشان كده القراية جوه WebView بـ CSS multi-column (جلسة Neon، والـ PRD). والمحرك package لوحده يتبني ويتختبر في Chromium **من غير موبايل**، يعني الـ QA بتاع الـ pagination رخيص وسريع.

## BookModel (العقد بين الـ parser والمحرك والتخزين)
```ts
type Book = { id: string; meta: { title: string; author?: string; lang: 'ar'|'en'|string; dir: 'rtl'|'ltr'; coverColor?: string };
  chapters: Chapter[]; footnotes: Record<string, Block[]>; wordCount: number };
type Chapter = { id: string /* ch01 */; title: string; blocks: Block[]; wordCount: number; hash: string };
type Block = { id: string /* ch01_p0007 */; kind: 'p'|'h2'|'break'|'quote'|'image'; html: string /* inline sanitized */; noIndent?: boolean };
type Anchor = { blockId: string; charOffset: number };   // مكان القراية
```
- الـ IDs **ثابتة ومعتمدة على الترتيب جوه الفصل**. كل الـ patches اللي جاية (الصوت، والمشاهد، والـ highlights) هتتربط بيها.
- `noIndent` بيتحسب في الـ parser (أول block بعد h1 أو h2 أو break).
- الـ HTML اللي جوه السطر بيتعمله sanitize (em، وstrong، وfootnote ref بس). ممنوع raw HTML من الملف.

## صيغة الكتاب على الجهاز (Canonical Bundle)
```
<documentDirectory>/books/<bookId>/
  book.md            # النص الأصلي زي ما هو
  manifest.json      # meta + chapters[{id,title,wordCount,hash}] + parserVersion
  assets/            # صور (من zip، أو لاحقاً من السيرفر)
  .reader-state.json # anchor، والإعدادات الخاصة بالكتاب (لاحقاً bookmarks/highlights)
```
- فهرس المكتبة في `expo-sqlite`: جدول `books(id, title, author, dir, coverSeed, progress, lastOpenedAt, addedAt)`.
- الإعدادات العامة في `expo-sqlite` (kv)، ومش AsyncStorage، علشان نفضل على مصدر واحد.
- **Why (product):** الصيغة دي نفسها هي اللي هتتزامن مع Obsidian والسيرفر في المراحل 4 و5 من غير migration.

## Reader engine
- **ملف `reader.html` واحد** (esbuild، والـ JS والـ CSS inline). الخطوط ملفات woff2 في `apps/mobile/assets/fonts`، والـ WebView بيحمّلها offline (`baseUrl` محلي أو `@font-face` بـ file URI).
- **Chapter virtualization:** في الـ DOM بيبقى الفصل الحالي بس، ومعاه الفصل اللي قبله واللي بعده. وعدد الصفحات لكل فصل بيتكاش لكل (إعدادات + حجم viewport) علشان «صفحة X من Y» والـ scrubber.
- **Pagination:** `column-width = viewport width - margins`، و`column-gap = 2*margin`، و`height: 100%`، والانتقال بـ `transform: translateX` على صفحات صحيحة (مش `scrollLeft`). **Why (tech):** `scrollLeft` في RTL قيمته بتختلف من محرك لمحرك، وكمان بيعمل rounding. والـ translate بأرقام صحيحة لصفحة رقمها معروف مبيعملش off-by-one.
- **التشكيل:** `line-height` ≥ 1.5، و`padding-block` في الـ column علشان الحركات اللي فوق وتحت متتقصّش. وممنوع `letter-spacing` أو `<span>` جوه الكلمة العربية.
- **Bridge (RN ⇄ WebView)** بـ `postMessage`، والرسايل JSON فيها `type`:
  - RN→Web: `load {book, anchor, settings}`، و`settings {partial}`، و`goto {anchor|chapterId|page}`، و`next`، و`prev`.
  - Web→RN: `ready`، و`position {anchor, chapterId, page, pageCount, bookProgress}`، و`tap {zone: 'prev'|'next'|'center'}`، و`toc {chapters}`، و`error {message}`.
  - تفسير الـ tap zones (يمين وشمال حسب `dir`) **جوه المحرك**، ونفس المنطق في وضع الـ swipe.
- تغيير الإعدادات = CSS variables + إعادة حساب الصفحات + رجوع للـ anchor. من غير reload.

## Native shell
- expo-router: `/` المكتبة، و`/reader/[id]` القراية.
- `expo-document-picker` + `expo-file-system` للـ import. وAndroid intent filter لـ `text/markdown` و`text/plain` و`text/x-markdown` و`application/octet-stream` بامتداد md.
- Bottom sheet (`@gorhom/bottom-sheet`)، وReanimated، وGesture Handler، و`expo-keep-awake`، و`react-native-webview`.
- **مفيش network** في المرحلة 1.

## الجودة
- `gates.sh` في الجذر: typecheck، وlint، وvitest (`book-format`)، وplaywright (`reader-engine`)، و`expo export` أو prebuild check.
- Release APK بـ `mobile-run` على السيرفر، وMaestro flows على Redroid بـ `app-flow` (`.factory/flows.yaml`).
- **QA بالـ agents:** ريبو public منفصل (`rewiaty-agent-testers`) من template `pierridotite/mobile-agent-testers`، شغال على GitHub Actions المجاني، وموديله deepseek عن طريق OpenCode Go (KB: `HowTo/opencode-go-anthropic-endpoint.md`). والريبو ده بيتمسح في آخر المشروع.

## الموديلات (قرار سهيل 2026-11-24)
التنفيذ الأساسي على Antigravity `gemini-4-hydrogen`، والمهام الأقل أهمية على OpenCode `deepseek-v4.1-flash`، ومراجعة الـ PR على Codex، والمراجعة النهائية والدمج على Claude (المدير).
