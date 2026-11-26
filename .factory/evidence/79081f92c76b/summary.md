# Rewiaty Maestro Flows Summary (`79081f92c76b`)

The delivered tree: `test/p1-device-flows` after merging `origin/main` a second time (PR #23, the page
scrubber RTL fix). This is the run the PR table is based on.

- **Actions Run:** https://github.com/sohailcollege2032008-tech/rewiaty-agent-testers/actions/runs/45668376498
- **Run ID:** `45668376498`
- **Source:** `79081f92c76b86958bfe185374338ae051ee1b1e`
- **APK SHA256:** `fed20a471a4811ad7ae3eb305bec51727922d49a603c4e55be6feaabe7937c9b`
- **ARM64 APK Size:** 39.50 MB (41419627 bytes)
- **ARM64 APK SHA256:** `166d8064fa452afd69790770ea56cb5bce97c7c623e067904fdb963c70f2775e`
- **Requested Target:** `all`
- **Workflow Exit Code:** `1` (red only because of the blocked flow plus `footnote-popover`)

| Flow | Status | Time | Details |
|---|---|---|---|
| `first-launch-sample` | **PASS** | 27.86s | maestro exit=0 |
| `import-md` | **PASS** | 51.89s | maestro exit=0 |
| `import-epub` | SKIP | — | flow file absent on this ref (another agent's flow) |
| `resume-position` | **PASS** | 71.53s | maestro exit=0 |
| `scrubber-direction` | **PASS** | 38.47s | maestro exit=0 (new on `main` with the RTL fix) |
| `drag-page-direction` | SKIP | — | flow file absent on this ref |
| `settings-live` | **PASS** | 46.24s | maestro exit=0 |
| `open-with-telegram` | **PASS** | 9.90s | maestro exit=0 |
| `footnote-popover` | **FAIL** | 66.39s | `Assertion is false: id: footnote-title is visible` — same tap (586, 917) |
| `rotate-position` | **FAIL** | 23.85s | `Assertion is false: false is true` at step 20 — identical page-counter string |
| `keep-awake` | **PASS** | 58.03s | 45s idle against `screen_off_timeout=30000` → `wakefulness: Awake`; control (library only) → `Asleep` |
| `long-book-open` | **PASS** | 11.11s | 201,059 words / 60 chapters; `reader rendered after 12s` in prep; the 2000ms assert found the first page |
| `highlight-add` | SKIP | — | flow file absent on this ref |

Blocked (reported, not a gate): `rotate-position` — F3 rotation waits on a product decision (landscape may become tablet-only; `apps/mobile/app.json` still locks the phone to portrait).

## Notes

- `long-book-open` passes here but sits **on the 2s boundary**: the same journey failed twice on the
  previous tree (`ce538eb36a69`, runs 45654469093 and 45661209279) at 2.1–2.5s while the runner was
  rendering the reader in 21–22s instead of 12s. The only app change between the two trees is the page
  scrubber's RTL fix, so the difference is machine load, not a speed fix. See the one-flow repeat in
  `../79081f92c76b-r4/summary.md`.
- `footnote-popover` fails exactly as in both previous runs: the ref lands at y=917 of the 2400px screen
  (38%, above the bottom sheet band), the popover opens on `pointerup` and the following synthetic click
  hits the backdrop, closing it in the same gesture. The mechanism and the CDP repro are documented in
  `../ce538eb36a69/summary.md`.
- `rotate-position` fails on the identical page-counter string, i.e. `app.json` keeps the activity in
  portrait — the product decision, not a selector problem.
