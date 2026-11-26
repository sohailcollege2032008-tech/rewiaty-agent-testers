# Rewiaty Maestro Flows Summary (`ce538eb36a69-r2`)

Repeat of run `45654469093` on the **same source SHA** to prove the three failures are reproducible and
not a one-off emulator hiccup. Nothing changed between the two runs.

- **Actions Run:** https://github.com/sohailcollege2032008-tech/rewiaty-agent-testers/actions/runs/45661209279
- **Run ID:** `45661209279`
- **Source:** `ce538eb36a699b70aaf95e5d54688c18f608e95c`
- **APK SHA256:** `f448303a992d6ade453557e4804323de83833096edf670488ecc34f9586d928b`
- **ARM64 APK Size:** 39.50 MB (41419447 bytes)
- **ARM64 APK SHA256:** `b6b528d092af3417ac573d6e9fd9e0597849601aece659ef4d4d2e7239a727da`
- **Requested Target:** `all`
- **Workflow Exit Code:** `1`

The APK bytes differ from `ce538eb36a69` although the source is identical — the Android build is not
byte-reproducible (signing/timestamps). Same source, same flow results.

| Flow | Status | Time | Details |
|---|---|---|---|
| `first-launch-sample` | **PASS** | 30.51s | maestro exit=0 |
| `import-md` | **PASS** | 53.84s | maestro exit=0 |
| `import-epub` | SKIP | — | flow file absent on this ref (another agent's flow) |
| `resume-position` | **PASS** | 74.81s | maestro exit=0 |
| `scrubber-direction` | SKIP | — | flow file absent on this ref |
| `drag-page-direction` | SKIP | — | flow file absent on this ref |
| `settings-live` | **PASS** | 47.72s | maestro exit=0 |
| `open-with-telegram` | **PASS** | 10.12s | maestro exit=0 |
| `footnote-popover` | **FAIL** | 150.77s | `Assertion is false: id: footnote-title is visible`; the tap landed at the same (586, 917) |
| `rotate-position` | **FAIL** | 26.24s | `Assertion is false: false is true` at step 20 |
| `keep-awake` | **PASS** | 58.06s | 45s idle against `screen_off_timeout=30000` → `wakefulness: Awake`; control → `Asleep` |
| `long-book-open` | **FAIL** | 14.00s | same assert; `reader rendered after 21s` in prep |

Blocked (reported, not a gate): `rotate-position` — F3 rotation waits on a product decision.

## Why this run matters

Identical outcome on both runs:

- `footnote-popover`, `rotate-position`, `long-book-open` FAIL both times.
- Every other flow PASSes both times, including the new `keep-awake` with its power control.
- So the failures are properties of the merged `main`, not flakiness, and the pass/fail split is stable
  enough to gate on.

Details and the mechanism behind each failure are in
[`../ce538eb36a69/summary.md`](../ce538eb36a69/summary.md).
