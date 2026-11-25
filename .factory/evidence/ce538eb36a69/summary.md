# Rewiaty Maestro Flows Summary (`ce538eb36a69`)

- **Actions Run:** https://github.com/sohailcollege2032008-tech/rewiaty-agent-testers/actions/runs/45654469093
- **Run ID:** `45654469093`
- **Source:** `ce538eb36a699b70aaf95e5d54688c18f608e95c` (merge of `origin/main` into `test/p1-device-flows`)
- **APK SHA256:** `e4a89f0b2aff2b3287c0727eb4a51f47a7477d469bb952c601ce8ef5299c5f75`
- **ARM64 APK Size:** 39.50 MB (41419447 bytes)
- **ARM64 APK SHA256:** `1d1ac11e732c6d902beea283bcfde7160c52c0c221d949828839ed92549aadb7`
- **Requested Target:** `all`
- **Workflow Exit Code:** `1` (red only because of the blocked flow plus the two regressions below)

| Flow | Status | Time | Details |
|---|---|---|---|
| `first-launch-sample` | **PASS** | 87.24s | maestro exit=0 |
| `import-md` | **PASS** | 99.39s | maestro exit=0 |
| `resume-position` | **PASS** | 75.25s | maestro exit=0 |
| `scrubber-direction` | SKIP | — | flow file absent on this ref (another agent's flow) |
| `drag-page-direction` | SKIP | — | flow file absent on this ref |
| `settings-live` | **PASS** | 48.89s | maestro exit=0 |
| `open-with-telegram` | **PASS** | 10.14s | maestro exit=0 |
| `footnote-popover` | **FAIL** | 69.36s | `Assertion is false: id: footnote-title is visible` — the ref was tapped, the popover opened and closed immediately |
| `rotate-position` | **FAIL** | 27.16s | `Assertion is false: false is true` at step 20 — page-counter string identical after landscape |
| `keep-awake` | **PASS** | 68.18s | 45s idle against `screen_off_timeout=30000` → `wakefulness: Awake`; control (library only) → `Asleep` |
| `long-book-open` | **FAIL** | 13.27s | `.*تَعْرِفُ الْبَحْرَ قَبْلَ أَنْ تَعْرِفَ اسْمَهُ.*` not visible within 2000ms |
| `highlight-add` | SKIP | — | flow file absent on this ref |

Blocked (reported, not a gate): `rotate-position` — F3 rotation waits on a product decision (landscape may become tablet-only; `apps/mobile/app.json` still locks the phone to portrait).

## The two regressions this run proves (they were PASS before the P2 merge)

### `footnote-popover` — the popover closes itself

Rebuilt locally with headless Chrome + real touch events over CDP (`/tmp/fn-repro.html`, `/tmp/fn-repro.cjs`),
event order for a ref in the top half of the page:

```
pointerdown@346 → pointerup@346 target=A → OPEN 1 → backdrop click target=footnote-backdrop → CLOSE
```

- `engine.ts:364` opens the footnote on `pointerup`; the synthetic `click` that follows is then hit-tested
  against the backdrop that just became visible, so the same gesture closes it.
- If the ref sits inside the sheet's own band (bottom ~45% of the page) the click target is
  `footnote-popover` and it stays open — which is why the pre-merge run passed: in `95301310bfd3` the tap
  landed at y=1880/2000 (94%), in this run at y=917 (46%) because P2 changed the pagination.
- Fix direction (app owner, not this PR): open on `click`, or ignore backdrop clicks for ~300ms after opening.

### `long-book-open` — 2000ms budget missed

- Prep: 201,059 words / 60 chapters, handed over as `content://media/external/downloads/1000000020`
  via `ACTION_VIEW`; `reader rendered after 22s`.
- Flow: `stopApp` → `launchApp` → tap library card → assert within 2000ms → **FAILED after 2686ms**.
- The screenshot right after the failure shows page 1 of ~1860 rendered, so the book does open — it is a
  speed regression of the open path, not a crash. Two identical runs (this one and `-r2`) show 2.1–2.5s.
- `readBookBundle` re-parses `book.md` through `parseBook` on every open, which is the first place to look.
