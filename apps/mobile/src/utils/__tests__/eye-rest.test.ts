import { EyeRestTracker } from '@/utils/eye-rest';

const MINUTE = 60_000;

describe('F31 — EyeRestTracker (تذكير راحة العين)', () => {
  it('defaults to a 45-minute stretch and clamps the interval to 15..120', () => {
    const tracker = new EyeRestTracker({ startedAt: 0 });
    expect(tracker.intervalMinutes).toBe(45);

    tracker.setIntervalMinutes(5);
    expect(tracker.intervalMinutes).toBe(15);
    tracker.setIntervalMinutes(999);
    expect(tracker.intervalMinutes).toBe(120);
    tracker.setIntervalMinutes(Number.NaN);
    expect(tracker.intervalMinutes).toBe(45);
  });

  it('fires exactly once when 45 active minutes have passed', () => {
    const tracker = new EyeRestTracker({ startedAt: 0 });
    expect(tracker.tick(44 * MINUTE)).toBe(false);
    expect(tracker.tick(45 * MINUTE)).toBe(true);
    // The banner waits for the reader; the tracker must not fire every second.
    expect(tracker.tick(46 * MINUTE)).toBe(false);
    expect(tracker.tick(60 * MINUTE)).toBe(false);
  });

  it('does not count time while the app is in the background', () => {
    const tracker = new EyeRestTracker({ startedAt: 0 });
    tracker.pause(10 * MINUTE);
    expect(tracker.activeMs(10 * MINUTE)).toBe(10 * MINUTE);
    // Three hours in a pocket…
    expect(tracker.tick(190 * MINUTE)).toBe(false);
    expect(tracker.activeMs(190 * MINUTE)).toBe(10 * MINUTE);
    // …then the reader comes back and the clock resumes.
    tracker.resume(190 * MINUTE);
    expect(tracker.tick(224 * MINUTE)).toBe(false);
    expect(tracker.tick(225 * MINUTE)).toBe(true);
  });

  it('starts a fresh stretch after «تم» and can be started paused', () => {
    const tracker = new EyeRestTracker({ startedAt: 0 });
    expect(tracker.tick(45 * MINUTE)).toBe(true);
    tracker.acknowledge(50 * MINUTE);
    expect(tracker.activeMs(50 * MINUTE)).toBe(0);
    expect(tracker.tick(94 * MINUTE)).toBe(false);
    expect(tracker.tick(95 * MINUTE)).toBe(true);

    const paused = new EyeRestTracker({ startedAt: null, now: 0 });
    expect(paused.isRunning).toBe(false);
    expect(paused.tick(999 * MINUTE)).toBe(false);
    paused.resume(1000 * MINUTE);
    expect(paused.tick(1045 * MINUTE)).toBe(true);
  });

  it('never fires while disabled and pauses on disable / resumes on enable', () => {
    const tracker = new EyeRestTracker({ startedAt: 0, enabled: false });
    expect(tracker.tick(500 * MINUTE)).toBe(false);

    tracker.setEnabled(true, 500 * MINUTE);
    expect(tracker.isEnabled).toBe(true);
    expect(tracker.tick(545 * MINUTE)).toBe(true);

    tracker.setEnabled(false, 550 * MINUTE);
    expect(tracker.isEnabled).toBe(false);
    expect(tracker.activeMs(600 * MINUTE)).toBe(tracker.activeMs(550 * MINUTE));
  });

  it('reports remaining time without going negative', () => {
    const tracker = new EyeRestTracker({ startedAt: 0 });
    expect(tracker.remainingMs(10 * MINUTE)).toBe(35 * MINUTE);
    expect(tracker.remainingMs(50 * MINUTE)).toBe(0);
  });
});
