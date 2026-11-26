# Rewiaty Maestro Flows Summary (`95301310bfd3`)

- **Actions Run:** https://github.com/sohailcollege2032008-tech/rewiaty-agent-testers/actions/runs/45638109295
- **Run ID:** `45638109295`
- **APK SHA256:** `dd72fd9bec22b6d2f80040a730de3c81f5a0216207a285bc0deca2482b36bf89`
- **Requested Target:** `all`
- **Workflow Exit Code:** `1`
- **CSP / Amiri Font Check:** WARN/FAIL (no CSP violation, but Amiri confirmation missing: none)

| Flow | Status | Details |
|---|---|---|
| `first-launch-sample` | **PASS** | maestro exit=0 |
| `import-md` | **FAIL** | maestro exit=1 |
| `resume-position` | **PASS** | maestro exit=0 |
| `settings-live` | **PASS** | maestro exit=0 |
| `open-with-telegram` | **PASS** | maestro exit=0 |
| `footnote-popover` | **PASS** | maestro exit=0 |
| `rotate-position` | **FAIL** | maestro exit=1 |
| `keep-awake` | **PASS** | maestro exit=0 |
| `long-book-open` | **PASS** | maestro exit=0 |

## ملاحظات على الفشلين (اتقروا من الـ artifacts)

- **`import-md` FAIL** — مش باج في قراية الـ md: المستند عمره ما وصل التطبيق أصلًا. الشاشة الأخيرة
  (`logs/hierarchy-import-md.xml`) كلها `com.android.documentsui` ومعاها `action_mode_bar` +
  `action_menu_select`، يعني الدوسة على الملف اتحسبت long press (انحراف أحداث الإدخال على emulator الـ CI
  > 500ms)، الـ picker دخل selection mode، والخطوة اللي بعدها (`reader-toc-button`) مالقيتهاش.
  الرحلة دي مش من الخمس الجديدة، وسبناها زي ما هي. الحل (intent بـ `content://` بدل الـ picker) اتطبّق
  على `long-book-open` بنجاح — رون منفصل 45638109295 نفس الـ run.
- **`rotate-position` FAIL** — الفشل كان على السطر العربي (`assertCondition` رقم 14:
  `.*خَيْطٌ أَحْمَرُ بَالٍ.*` مش ظاهر) في نسخة الرحلة القديمة اللي كانت بتفترض صفحة معيّنة.
  الرحلة اتكتبت من جديد بشكل حتمي (مقارنة نص العدّاد) واتجرّبت لوحدها في run 45649048874 —
  التفاصيل في `.factory/evidence/59c44f82b2e2/summary.md`.
