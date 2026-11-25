# Rewiaty «روايتي» — QA report

**Persona:** grace — retired nurse, 74, low vision, reads with Android's largest font size.
**Device:** Pixel 7 (1080×2400, 420 dpi), Android 14, **font scale 2.0 (200%)**, system light theme, **en-US**. App `com.rewiaty.app` (offline reader, phase 1).

## Summary

- The app opens straight into a library with the bundled novel «حَجَرُ الْمَاءِ» (cover, title, author, 0% progress) and an import button; nothing to sign into.
- Import works through the system picker but gives no confirmation at all, and the imported book silently becomes the "current reading" hero; the shelf still says 2 novels while showing only 1 cover.
- Reading works: page turns by left/right edge and swipe, chapter starts on a new page, correct «صفحة X من Y», and opening after a force-stop returns to the exact page and sentence.
- At 200% the biggest defect is that the reading header/footer are drawn **over** the page: with the bars shown the first and last line of every full page are cut in half (proved by comparing 43 and 44, the same page with bars hidden and shown).
- The settings sheet, the footer chapter name and several controls do not fit at 200%: a clipped font list, a label broken in two lines, a truncated chapter name, and many touch targets under 48 dp.

| Journey | verdict | screenshots |
|---|---|---|
| 1. First launch and the bundled novel | partial | 01, 02 |
| 2. Import a file | pass | 03, 04, 05, 06, 07, 08 |
| 3. Reading and page turns | partial | 09–18 |
| 4. Find settings, change font and theme | partial | 19–30 |
| 5. Table of contents | pass | 33, 34, 35 |
| 6. Same place after force-stop and relaunch | pass | 41, 42, 43, 44 |

---

## Issues (most severe first)

### 1. Reading header and footer are drawn on top of the page and cut the first and last line — major

**Screenshots:** 43 vs 44 (same page; 43 bars hidden, 44 bars shown — full-resolution copies `full43.png`, `full44.png`), also 19, 27, 34.
**Steps to reproduce:** open «أُمُّ الشَّوَاطِئ», go to a full page (e.g. page 8), tap the middle to show the bars.
**Actual:** the page does not move or reflow; the header (0–260 px) and footer (≈2028–2400 px) are laid over the text. With the bars visible, the red section heading «الطَّرِيقُ إِلَى الْبِئْرِ» loses its top half under the header, and the blockquote line «يُشْبِهُ شَيْئًا آخَرَ، إِلَّا» loses its bottom half under the footer. Hiding the bars shows both lines complete. On page 1 and every chapter page the big chapter title is cut the same way (09, 19, 27, 34).
**Expected:** the reading area shrinks to the space between the bars (or the bars overlay nothing), so the first and last line stay whole.
**Why it matters:** every page that is full loses text whenever the chrome is visible — which is how a book opens, and after every TOC jump and settings close.

### 2. Reading settings sheet does not fit at 200%: clipped list, broken label, tiny controls — minor

**Screenshots:** 20, 22, 24, 29, 30.
**Steps:** open a book, tap the middle, tap the red "A" (إعدادات القراءة).
**Actual:** the sheet opens at about one third of the screen, but the font list does not fit: the last row ("Inter") is half off the bottom edge (20). The weight row breaks the word «متوسط» into «متوس» + «ط» on two lines inside its chip (22). The close ✕ (32×32 dp) and «افتراضي» (100×30 dp) are squeezed into the tab row; «افتراضي» does not say what it resets. Font-size −/+ are 36×32 dp. The sheet is translucent, so the page text shows through behind the theme grid and the empty lower half, making both harder to read (24, 30).
**Expected:** every row fits on one line, the list is fully visible or clearly scrollable with bottom padding, and every control is at least 48 dp and clearly labelled.

### 3. Layout is not mirrored for Arabic: chrome and lists are laid out left-to-right — minor

**Screenshots:** 01, 09, 27, 33, 35, 41.
**Steps:** look at the library, reader header, TOC and footer.
**Actual:** the text is Arabic and the back arrow points right, but its position and the rest of the chrome follow LTR order: app title/logo on the left with the actions on the right (01, 27, 41); reader back button at the far left while TOC and settings are on the right (09, 27); TOC page numbers at the far right and chapter titles to their left (33, 35); library shelf title on the left, count on the right, and the single shelf card on the left with the right half of the row empty (01, 41); the "+" sits to the left of «استيراد» (01).
**Expected:** a mirrored RTL layout: start edge on the right, back arrow at the right, page numbers at the left/trailing edge, shelf filled from the right.

### 4. Library progress does not match the reading position — minor

**Screenshots:** 41, 43/44, 42.
**Steps:** read to page 8 of 13 (62%), go back to the library.
**Actual:** the library card shows **58% / مقروء** while the reader footer and slider show **8 / 13 · 62%**; the same 58% survives the force-stop (42).
**Expected:** the same percentage in both places.

### 5. Import: no confirmation and the new book is not in the shelf (count says 2, one card shown) — minor

**Screenshots:** 05, 06, 07, 08, 41.
**Steps:** library → «+ استيراد» → Downloads → `qa-import-preview5.md`.
**Actual:** the file is only reachable through the picker's "Show roots → Downloads"; the "Recent" tab shows "No items" and the picker is filtered with Images/Audio/Videos chips, not documents (03, 04, 05). After choosing it, the app gives **no** toast, snackbar or confirmation — the screen simply changes, and the imported book replaces «حَجَرُ الْمَاءِ» as the "current reading" hero. The shelf header then says «2 روايات» but shows only the bundled book; the shelf does not scroll vertically or horizontally (07, 08), so the imported book cannot be found there at all.
**Expected:** a short "imported" confirmation, and the new book visible in the shelf list (or the count matching what is shown).

### 6. Small touch targets (accessibility) — minor

Seen in 01, 09, 20, 22, 25, 33 (the `screen.py` accessibility check reports these): theme toggle 38×38 dp, «استيراد كتاب جديد» 119×38 dp, «كمّل القراية» 159×38 dp, reader back/TOC/settings 40×40 dp, bookmark 34×52 dp, settings close 32×32 dp, font size −/+ 36×32 dp, TOC close 36×36 dp. For a low-vision user at 200% these are hard to hit; they should be ≥48 dp.

### 7. Footer chapter name is truncated at 200% — cosmetic

**Screenshots:** 10, 12, 16, 34.
**Actual:** the footer reads e.g. «الْفَصْلُ الْأَوَّلُ: الرِّيحُ الثَّا..» — the chapter name is cut with "..". The full name fits in the chapter heading but not in the footer.
**Expected:** use two lines or a shorter label; at least keep the full chapter name readable.

### 8. Page break inside a blockquote leaves one word alone — cosmetic

**Screenshots:** 38, 39.
**Actual:** the quote «كُلُّ شَيْءٍ فِي الصَّحْرَاءِ يُشْبِهُ شَيْئًا آخَرَ، إِلَّا الْعَطَشَ.» is split, and page 9 opens with a wide, otherwise empty quote box containing only «الْعَطَشَ.».
**Expected:** keep the quote together or avoid a one-word orphan.

### 9. Duplicate page indicators and a status line that stays when the chrome is "hidden" — cosmetic

**Screenshots:** 11, 12, 14, 16, 43.
**Actual:** with the bars hidden, a grey line still shows the chapter name and «8 / 13 · 62%» at the bottom; with the bars shown the footer repeats «صفحة 8 من 13» and the bottom bar repeats «8 / 13 · 62%», next to «3 فصول» and the hint «اضغط الشريطة لحفظ الصفحة». The reading area looks crowded and the "hidden" state is not fully hidden.
**Expected:** one page indicator; hide all chrome when the user hides it.

### 10. First-open hint contradicts the state and stays while turning pages — cosmetic

**Screenshots:** 09, 10.
**Actual:** the hint «اضغط في نص الصفحة عشان تظهر الإعدادات والفهرس…» appears at the same time as the header/footer, and says to tap to show them; it floats over a paragraph (covering a line) and is still there after turning to page 2. It disappears only on a centre tap, which also hides the bars.
**Expected:** show the hint only when the bars are hidden, and dismiss it on the first page turn.

### 11. Closing the settings sheet hides the header/footer; the next tap turns a page — minor

**Screenshots:** 30, 31.
**Actual:** after closing the sheet the bars are gone; tapping where the TOC button had been turned the book back one page instead (page 6 → 5). The user must tap the middle first.
**Expected:** closing the sheet returns to the state it was opened from (bars visible).

### 12. The reading theme also turns the library dark — cosmetic

**Screenshots:** 26, 41, 42.
**Actual:** after choosing «عتمة OLED» in the reader, the library, header and cards become black too, although the setting is labelled إعدادات القراءة and the phone is in light mode; the library theme toggle then shows a moon.
**Expected:** either keep reading themes inside the reader or label the theme as app-wide.

### 13. The bundled book's author is the app name — cosmetic

**Screenshots:** 01, 06, 41.
**Actual:** under «حَجَرُ الْمَاءِ» the author line reads «روايتي», the app's own name; the imported book correctly shows «قسم الجودة».
**Expected:** a real author name (or an "unknown author" label).

### 14. Shelf card text and cover text are cut — cosmetic

**Screenshot:** 41 (also 06). The imported book's cover prints «قسم الج...» cut at the bottom; the shelf card's author «روايتي» and badge «جديدة» sit under the cover at 200%, and «جديدة» is shown on the bundled book even though the newly imported book is the new one.
**Expected:** cover text fits or is omitted; the "new" badge belongs to the book just imported.

### 15. Arabic-only interface, no language option — minor (localisation)

**Screenshots:** all. The phone is en-US but every label — library, import, settings, TOC, hints — is Arabic, with Western digits. There is no language setting. This is expected for an Arabic reader, but for this persona it means no screen is readable without a translator; only icons and positions were usable.

---

## Device-specific layout problems (200% font, Pixel 7, light theme)

- Header/footer over content, first/last line cut (issue 1) — the main 200% failure.
- Settings sheet: font list runs past the bottom edge on open; «متوسط» wraps and breaks; tab row crowded; translucent background (issue 2).
- Footer chapter name truncated with ".." at 200% (issue 7).
- Touch targets 30–40 dp across the library, reader header and sheets (issue 6).
- The library rows and TOC are not mirrored, with the shelf card left-aligned and half the row empty (issue 3).
- The reader page itself is otherwise good at 200%: the Scheherazade/Amiri text is complete, tashkeel is not clipped, letters are joined correctly, and the 3-chapter/13-page pagination reflows when the font or size changes.

## As a reader

I am 74 and I read at 200%, so I judge by one thing: can I see whole lines and hit the buttons. The reading page is beautiful and the letters and diacritics are complete, and I love that it remembers exactly where I stopped after I closed everything. But I cannot read one word of the Arabic menus, so I had to work by icons and by trial; and every time the header and footer appear they slice the top and bottom line of the page in half, which is exactly the text I was reading. The settings sheet is a jumble: the font list is cut off at the bottom, one word is broken in two, and the little + and − and ✕ are hard to hit with old fingers. I would not keep it unless those lines stop being cut and the interface were offered in English or the text size made everything, including the footer, bigger. **Score: 5/10.**
