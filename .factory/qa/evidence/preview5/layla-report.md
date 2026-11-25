# روايتي (Rewiaty) — phase 1 QA report

**Persona:** layla — pharmacist, 39, reads Arabic, expects every screen to flow right-to-left.
**Device:** Pixel 6, Android 13, 1080×2400 @ 420 dpi, font scale 1.15, light system theme, UI language ar-EG.
**Build:** com.rewiaty.app, phase 1 (offline reading only).

| Journey | verdict | screenshots |
|---|---|---|
| 1. First launch and the bundled novel | pass | 01, 22 |
| 2. Import a file | pass | 02, 04, 05 |
| 3. Reading and page turns | partial | 08, 10, 12, 14, 15, 19, 20, 37 |
| 4. Settings, font and theme | pass | 24, 25, 26, 27, 28, 30, 31 |
| 5. Table of contents | partial | 33, 35, 36, 38, 39 |
| 6. Come back after force-stop | pass | 40, 41, 42, 43 |

## Five-line summary

- The bundled novel «حَجَرُ الْمَاءِ» is on the shelf with its cover, title, author «روايتي», a progress bar (0%, «لم تبدأ بعد») and a working «كمّل القراية» button; the screen is properly mirrored (title and cover on the right, forward chevron pointing left).
- Import works through the system picker: the file is visible in «عمليات التنزيل», and selecting it adds «أُمُّ الشَّوَاطِئ» / «قسم الجودة» as the first (currently-reading) card with the correct diacritics.
- Reading is the strong part: full tashkeel, correctly joined letters, no line cut between pages, every chapter starts on a new page, left edge = forward, right edge = back, horizontal swipe works, and the middle tap toggles the header/footer without stealing page turns.
- Settings (font, size, OLED theme) apply immediately behind the sheet, keep the page, and survive closing the sheet, closing the reader and a force-stop.
- The weak part is the chrome: the header overlays and clips the top of the page, the page total changes between 5, 6 and 7, the index's page numbers contradict the footer, and the bookmark button is buried under the Back button.

## Issues (most severe first)

### 1. Bookmark button is unreachable while the reading header is shown — minor
**Screens:** 44, 46 (workaround: 45) · **Screen:** Reader
**Steps:** open a book → tap the middle of the page so the header/footer appear → tap the bookmark ribbon in the top-right corner (≈1000,150 px).
**Actual:** the app leaves the book and returns to the library. The bookmark control's accessibility bounds (34×52 dp at 993,196) sit underneath the Back button's (40×40 dp at 985,180). With the chrome hidden the same tap toggles it correctly — the label changes from «حفظ علامة مرجعية» to «إزالة العلامة المرجعية» (45). The ribbon is also a dark maroon on black in the OLED theme, almost invisible (45).
**Expected:** Bookmark toggles when tapped; Back and Bookmark must not share a hit area.
**Severity:** minor (the control works only after hiding the header; a real workaround exists, but the normal "show controls then bookmark" path exits the book).

### 2. Page totals are unstable and the TOC page numbers disagree with the reader — minor
**Screens:** 09/12 (6), 15 (5), 26/29 (7), 36/39/40 (6), 33/35/38 (TOC 1/4/6) · **Screen:** Reader / TOC
**Steps:** open the book (footer «صفحة 1 من 6»), turn forward to chapter 2, go back one page («2 / 5»), open/close the settings sheet («6 / 7»), jump to chapter 1 through the index («صفحة 1 من 6»).
**Actual:** the same book with the same settings reports 6, then 5, then 7, then 6 pages. The index (33/35/38) says chapter 1 is «3 صفحات» and chapter 2 starts at page 4, but tapping chapter 2 lands on «صفحة 3 من 6» (39) — in that same layout chapter 1 is only 2 pages. The library shows 60% for the position the reader shows as 67% (41 vs 40).
**Expected:** one stable pagination; the index's page numbers equal the page the footer shows.
**Severity:** minor (annoying, reading still works).

### 3. Showing the header clips the top of the first line / chapter heading — minor
**Screens:** 09, 21, 40, 44 · **Screen:** Reader
**Steps:** open a chapter or any page → tap the middle so the header is shown.
**Actual:** the page does not move; the app bar overlays the top of the page. On a chapter page the top of «الْفَصْلُ الثَّالِثُ: مَا تَرَكَهُ الْجَدُّ» is cut (21); on page 4 the diacritics of the first line of the quote are cut (40/44). With the header hidden the same lines are complete (20/43).
**Expected:** the page should be inset below the header (or reflow) so no glyph is clipped.
**Severity:** minor.

### 4. Continuation pages show a clipped sliver of the previous page's last line — cosmetic
**Screens:** 12, 15, 19 · **Screen:** Reader
**Steps:** read from page 1 to page 2, or to any continuation page, with the chrome hidden.
**Actual:** at the very top edge, above the first line, the bottom of the previous page's last line is visible, cut in half (clearest in the full-resolution capture of 15).
**Expected:** nothing above the first line of a page.
**Severity:** cosmetic.

### 5. Touch targets under 48 dp — minor (accessibility)
**Screens:** 01, 09, 21, 24, 30, 33 · **Screens:** Library, Reader, Settings, TOC
**Actual:** library «تبديل المظهر» 38×38 dp, «استيراد كتاب جديد» 83×38 dp, «كمّل القراية» 117×38 dp (01); reader Back/TOC/Settings 40×40 dp, bookmark 34×52 dp (09/21); TOC close 36×36 dp (33); the settings sheet reports 20–26 controls under 48 dp (tabs 35–48×43 dp, «افتراضي» 68×30 dp, font chips ≈43 dp tall) (24/30). Labels fit at 1.15×, but the hit areas are small.
**Expected:** ≥48 dp touch targets.
**Severity:** minor.

### 6. Settings sheet opens with its last row cut off and no scroll cue — minor
**Screens:** 24, 31 · **Screen:** Settings sheet
**Steps:** open a book → middle tap → «إعدادات القراءة».
**Actual:** the sheet covers about a third of the screen as expected, but the «تباعد الأسطر» row is half below the bottom edge; the sheet grows only if dragged (31), where «تباعد الكلمات» / «تباعد الفقرات» appear.
**Expected:** all rows reachable at once, or a visible drag/scroll affordance.
**Severity:** minor.

### 7. Bookshelf says «2 روايات» but shows a single card and an empty column — cosmetic
**Screens:** 05, 22, 41 · **Screen:** Library
**Actual:** under «رفّ الكتب» the count reads «2 روايات», but only one cover card is rendered in the right half of the row; the left half is blank and the rest of the screen is empty. The second book (the current one) exists only in the «قراءة حالية» card above.
**Expected:** both books in the shelf, or a count/cell that matches what is shown.
**Severity:** cosmetic.

### 8. Import gives no confirmation and marks the new book «قراءة حالية» at 0% — cosmetic
**Screens:** 05 · **Screen:** Library
**Actual:** after choosing the file the library simply refreshes; the new book appears as «قراءة حالية», 0%, «لم تبدأ بعد», with «كمّل القراية», without ever being opened. No toast/snackbar.
**Expected:** a short confirmation, and no "currently reading" state until the book is opened.
**Severity:** cosmetic.

### 9. A book that is 60% read is labelled «مقروء» (read) — cosmetic
**Screens:** 22, 41 · **Screen:** Library
**Actual:** the hero card shows 60% + «مقروء»; 0% shows «لم تبدأ بعد» and 100% shows «مكتملة». «مقروء» reads as "finished/read".
**Expected:** «قيد القراءة» (in progress) for a partially read book.
**Severity:** cosmetic.

### 10. Mixed-language labels, and an invisible English string in the accessibility tree — cosmetic
**Screens:** 24, 27, 09/43 · **Screen:** Settings / Reader
**Actual:** font names «Literata», «Merriweather», «Inter» and the theme «عتمة OLED» are Latin/mixed inside an otherwise Arabic sheet (font names are understandable; the theme label is mixed). On every reading page a node named "Rewiaty Reader Engine" is present in the accessibility tree (centre of the page) but nothing is visible there — TalkBack would announce it.
**Expected:** consistent Arabic labels; no engine/debug string exposed to accessibility.
**Severity:** cosmetic.

### 11. First-open hint contradicts the state it is shown in — cosmetic
**Screens:** 08, 10 · **Screen:** Reader
**Actual:** on first open the header and footer are already visible, and the hint says «اضغط في نص الصفحة عشان تظهر الإعدادات والفهرس، وعلى الأطراف عشان تقلّب» — but the middle tap hides the header/footer (10), it does not show them.
**Expected:** hint shown only when the chrome is hidden, or wording that matches the actual behaviour.
**Severity:** cosmetic.

## Device-specific layout problems (font scale 1.15, Pixel 6)

- The settings sheet's bottom row falls below the screen edge at 1.15× (24) and must be reached by dragging the sheet (31); all chips/tabs are 43 dp tall or less.
- The reading header (status-bar inset + app bar) covers the top ~1 line of the page, so the first line's diacritics are clipped whenever the chrome is shown (21/40/44) — exactly the kind of clipping large/served Arabic text suffers first.
- The library's single shelf card leaves roughly half the row empty (22/41); the TOC drawer leaves an uncovered strip of the page on the right with a second, partial header visible (33/35).
- The status bar does switch to light icons with the OLED theme (verified at full resolution, s45) — no contrast problem there.

## Mirroring check

Good: back arrow on the right and pointing right; title and cover on the right; page text right-aligned; forward chevron in «كمّل القراية» points left; the font-size stepper is mirrored correctly («+» on the left, «−» on the right); TOC page numbers sit on the left. No mirrored-image or reversed-order problem was found. One convention note: the TOC drawer slides in from the left (the same side as its hamburger) rather than from the right; it is coherent with the button placement but unusual for an RTL start-side drawer.

## As a reader

I read Arabic every day and I expect a page to behave like a page. The reading itself is genuinely good: the tashkeel is complete, the letters join properly, the quotes are marked with a red bar on the right, I can turn pages with a tap on the left or a swipe, and the font, size and OLED theme change immediately and are still there after I close the app. It reopened on exactly the line I stopped at — «كُلُّ شَيْءٍ فِي الصَّحْرَاءِ يُشْبِهُ شَيْئًا آخَرَ، إِلَّا الْعَطَشَ.» — which is what I want from a reader. What spoils it is the furniture around the page: when I tap the middle to get the controls, the header eats the top of the line I am reading; if I reach for the bookmark ribbon the app throws me out to the library; and the page count cannot make up its mind (من 6، من 5، من 7) while the index says chapter 2 starts on page 4 and the footer says page 3. I would keep it — the reading experience is the best part and the import is painless — but I would hide the bookmark until the header stops sitting on top of it. **7/10.**
