# Mission: QA «روايتي» (Rewiaty) Release Candidate — Phase 1 + Merged Phase 2

Read `AGENT_BRIEF.md` first: its tools, rules and final report files apply. This
brief replaces its "What to check" list with eight journeys covering the current
`origin/main` build (Phase 1 reader + merged Phase 2: Search, Bookmarks,
Highlights, Tashkeel display modes, Reading Stats). You are still one persona,
on one phone, and you still report as that persona plus as a tester.

App: `com.rewiaty.app`, offline Arabic RTL novel reader. No account, no sign-in,
no network needed. Everything is local on the phone.

## Important interaction contract (current app)
- **Page turns are horizontal SWIPES, NOT edge taps.** In Arabic (RTL), swipe
  **LEFT-TO-RIGHT** (finger moves toward the right edge, like turning an Arabic
  paper book page) to go **FORWARD**, and swipe **RIGHT-TO-LEFT** to go **BACK**.
- **HUD toggle:** tap the center of the page (`~50%, 50%`) to show/hide header & footer.
- **Long-press** on a word/sentence inside the reader page opens text selection / highlight toolbar.

## Before you start (once)

Put the file you will import into the phone's Downloads:

```
adb push rewiaty/samples/qa-import-preview5.md /sdcard/Download/
adb shell ls -l /sdcard/Download/
```

You should see `qa-import-preview5.md`. Its real title is «أُمُّ الشَّوَاطِئ»,
author «قسم الجودة», three chapters.

## The eight journeys, in this order

Take a screenshot after every action. Do not skip a journey because the previous
one failed: write the failure down, try ONE alternative, then move on. Budget
about 60 actions in total.

1. **First launch and the bundled novel.** The app is already open. The library
   should contain the bundled novel «حَجَرُ الْمَاءِ». Check: is it there, does
   it show title and author, does it look like a book (generated Arabic cover),
   is there a progress indicator, is the layout mirrored for Arabic (RTL even if
   phone system language is English)? Note any English text, empty area, clipped
   labels, or thing you do not understand as a new user.

2. **Import a file.** In the library, find how to import (`+ استيراد` or import
   button). Choose `/sdcard/Download/qa-import-preview5.md`. Expected: a new
   book appears titled «أُمُّ الشَّوَاطِئ» with author «قسم الجودة», with clear
   feedback, and it appears properly in the library (count matches visible books).
   If import fails, note it and continue with the bundled novel.

3. **Reading, swipe page turns, and footnotes.** Open «حَجَرُ الْمَاءِ». Read 4–5
   pages by **swiping left-to-right** (forward in RTL) and **right-to-left**
   (back). Check with your eyes on every screenshot: is tashkeel complete and
   not clipped, are Arabic letters joined correctly, is any line cut between
   pages or covered by header/footer, does each chapter start on a new page, is
   the page counter stable and accurate? Also look for a footnote number (e.g.
   in chapter 4) and tap it: does the footnote popover open, stay open, and
   close cleanly?

4. **Settings live (font, size, theme, tashkeel mode).** Tap the center of the
   page to show the HUD. Open reading settings (إعدادات). Screenshot the sheet:
   check if all rows are reachable, readable, not clipped/transparent, and touch
   targets feel comfortable. Change font (e.g. Amiri → Noto Naskh), change font
   size once, pick a dark theme (OLED Night / وَرَق مَحْروق), and try switching
   the Tashkeel display mode (كامل / بدون / شدة وتنوين) if visible. Verify each
   change updates the page live without losing your paragraph. Close the sheet
   and verify the app stays on the same page.

5. **Table of contents (الفهرس) & Bookmarks.** Open TOC from header. Screenshot
   the list and verify page numbers match the footer. Tap Chapter 3: verify you
   land on Chapter 3 page 1. Add a bookmark (from the ribbon or HUD) and verify
   it is saved and listed without kicking you back to the library.

6. **Highlights (التظليل).** Long-press a sentence on a reading page. If the
   highlight toolbar appears, pick a color (and optionally add a note). Verify
   the highlight lands on the sentence you actually pressed (not mirrored/wrong
   text) and stays visible.

7. **Library Search (البحث) & Reading Stats.** Return to the library. Open
   Search and search for a word from «حَجَرُ الْمَاءِ» WITHOUT tashkeel (e.g.
   «الصحراء» or «الماء»). Verify results appear quickly and tapping a result
   jumps to that spot. Also check if reading stats / time remaining display
   sensible values (no NaN, no garbled text).

8. **Persistence after force-stop.** Read into Chapter 2, note one distinctive
   sentence on screen (quote it in the report). Go back to the library, then:

   ```
   adb shell am force-stop com.rewiaty.app
   adb shell monkey -p com.rewiaty.app -c android.intent.category.LAUNCHER 1
   ```

   Reopen the book. Verify: same chapter & sentence, theme/font/settings kept,
   highlight/bookmark kept, library progress matches reader progress, and most
   recently read book is first.

## On this device

Play your persona honestly, including its text size, language and patience. If
your persona has a large font size (200%), look especially for clipped text,
headers/footers overlapping book lines, overflowing settings rows, broken Arabic
word wraps, and unreachable or tiny (<48dp) buttons.

## Final report

Write `results/<persona>/report.md` and `results/<persona>/findings.json` with
the Write tool, as `AGENT_BRIEF.md` says, plus:

- At the top of `report.md`, a table `Journey | verdict | screenshots` with one
  row per journey above (verdict: `pass`, `partial`, `fail`).
- Under the issues, a short "as a reader" paragraph: would this persona keep
  the app, and the score out of 10.
- In `findings.json`, use `blocker` only when reading/core flow is broken or
  crashes, `major` for a journey that fails or an unusable control, `minor` for
  something annoying that still works, `cosmetic` for looks and wording.
