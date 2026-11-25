# Mission: QA «روايتي» (Rewiaty), an offline Arabic novel reader

Read `AGENT_BRIEF.md` first: its tools, rules and final report files apply. This
brief replaces its "What to check" list with six journeys. You are still one
persona, on one phone, and you still report as that persona plus as a tester.

App: `com.rewiaty.app`, Arabic RTL novel reader, phase 1 only (reading). No
account, no sign-in, no network needed. Everything is local on the phone.

## Before you start (once)

Put the file you will import into the phone's Downloads:

```
adb push rewiaty/samples/qa-import-preview5.md /sdcard/Download/
adb shell ls -l /sdcard/Download/
```

You should see `qa-import-preview5.md`. Its real title is «أُمُّ الشَّوَاطِئ»,
author «قسم الجودة», three chapters.

## The six journeys, in this order

Take a screenshot after every action. Do not skip a journey because the previous
one failed: write the failure down, try ONE alternative, then move on. Budget
about 55 actions in total.

1. **First launch and the bundled novel.** The app is already open. The library
   should contain the bundled novel «حَجَرُ الْمَاءِ». Check: is it there, does
   it show title and author, does it look like a book, is there a progress
   indicator, is the layout mirrored for Arabic (text on the right, back arrow
   pointing right)? Note any English text, empty area, or thing you do not
   understand as a new user.

2. **Import a file.** In the library, find how to import. If you cannot find it
   after trying the obvious places (a + or import button, a menu, a long press
   on empty space), that is a finding: say so, with the screenshot. Choose
   `/sdcard/Download/qa-import-preview5.md` (Downloads folder, or the picker's
   search). Expected: a new book appears titled «أُمُّ الشَّوَاطِئ» with author
   «قسم الجودة», and it opens. Check also: does the picker show the file at all,
   does the app say anything after the import, is the new book obvious in the
   library. If the import fails, continue with the bundled novel.

3. **Reading and page turns.** Open the book. Then read 4–5 pages: tap near the
   LEFT edge to go forward (RTL), tap near the RIGHT edge to go back, and try a
   horizontal swipe. Check with your eyes on every screenshot: is the
   tashkeel (diacritics) complete and not clipped, are Arabic letters joined
   correctly (no broken letters), is any line cut between two pages, is there
   an empty page, does each chapter start on a new page, does the footer read
   «صفحة X من Y» and look right? Note exactly when the header and footer appear
   and disappear, and whether a tap meant for turning the page instead opens
   or hides them.

4. **Find the settings, change the font and the theme.** Tap the middle of the
   page so the header/footer show. Find the reading settings (the gear /
   إعدادات). The first time a book opens, a hint should tell you to tap the
   middle of the page — screenshot it if it appears. In the settings sheet:
   change the font (Amiri to another one), change the size once, and choose the
   darkest theme (OLED Night / ليلي). After every change, look at the page
   behind the sheet: did the text change immediately, did the paragraph you
   were reading stay on the screen, does the sheet cover about a third of the
   screen with the page visible above it? Then close the sheet, reopen it, and
   check the changes are still there. Report if any control is unreachable,
   unlabelled, too small, or if a change needs a reload to show.

5. **Table of contents (الفهرس).** Open it from the header. Screenshot the list.
   Tap the third chapter. Expected: you land on the first page of that chapter,
   and the footer/chapter name matches. Then open the TOC again: is the current
   chapter marked?

6. **Come back to the same place after closing the app.** Read two pages into
   the second chapter and pick one distinctive sentence on the page you stop
   at (write it in the report). Go back to the library, then force-stop the app
   and relaunch it:

   ```
   adb shell am force-stop com.rewiaty.app
   adb shell monkey -p com.rewiaty.app -c android.intent.category.LAUNCHER 1
   ```

   Open the same book again. Expected: the same chapter and the same sentence
   are on screen, and the library shows your progress and puts this book first.
   If it opens at the beginning, say so and say where it did open.

## On this device

Play your persona honestly, including its text size, language and patience. If
your persona has a large font size, look especially for clipped text, headers
or buttons that no longer fit, rows in the settings sheet that overflow, and
any control that becomes unreachable.

## Final report

Write `results/<persona>/report.md` and `results/<persona>/findings.json` with
the Write tool, as `AGENT_BRIEF.md` says, plus:

- At the top of `report.md`, a table `Journey | verdict | screenshots` with one
  row per journey above (verdict: `pass`, `partial`, `fail`).
- Under the issues, a short "as a reader" paragraph: would this persona keep
  the app, and the score out of 10.
- In `findings.json`, issues keep the usual fields; use `blocker` only when
  reading itself is impossible, `major` for a journey that fails or a control
  you could not use, `minor` for something annoying that still works,
  `cosmetic` for looks and wording.
