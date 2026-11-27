/**
 * F31 — «تذكير هادي لراحة العين كل 45 دقيقة».
 *
 * The tracker counts only *active foreground reading* time:
 * - `pause(now)` is called when AppState leaves `active` (the phone is in a pocket, not reading),
 * - `resume(now)` when it comes back,
 * - `tick(now)` on the screen's one-second heartbeat returns `true` exactly once per interval,
 * - `acknowledge(now)` resets the stretch when the reader dismisses the banner.
 *
 * Pure and clock-injectable so the unit test can fast-forward 45 minutes in a millisecond.
 */
export const EYE_REST_MIN_INTERVAL_MINUTES = 15;
export const EYE_REST_MAX_INTERVAL_MINUTES = 120;
export const EYE_REST_DEFAULT_INTERVAL_MINUTES = 45;

export type EyeRestTrackerOptions = {
  intervalMinutes?: number;
  enabled?: boolean;
  /** Start "already reading". Pass `null` to start paused. */
  startedAt?: number | null;
  now?: number;
};

function clampIntervalMinutes(value: number): number {
  if (!Number.isFinite(value)) return EYE_REST_DEFAULT_INTERVAL_MINUTES;
  return Math.max(
    EYE_REST_MIN_INTERVAL_MINUTES,
    Math.min(EYE_REST_MAX_INTERVAL_MINUTES, Math.round(value)),
  );
}

export class EyeRestTracker {
  private intervalMs: number;
  private enabled: boolean;
  private accumulatedMs = 0;
  private lastResumeAt: number | null = null;
  private notified = false;

  constructor(options: EyeRestTrackerOptions = {}) {
    this.intervalMs = clampIntervalMinutes(options.intervalMinutes ?? EYE_REST_DEFAULT_INTERVAL_MINUTES) * 60_000;
    this.enabled = options.enabled ?? true;
    if (options.startedAt === null) {
      this.lastResumeAt = null;
    } else {
      this.lastResumeAt = options.startedAt ?? options.now ?? Date.now();
    }
  }

  get intervalMinutes(): number {
    return this.intervalMs / 60_000;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get isRunning(): boolean {
    return this.lastResumeAt !== null;
  }

  /** Active foreground reading time so far, in ms. */
  activeMs(now: number = Date.now()): number {
    if (!this.enabled) return this.accumulatedMs;
    if (this.lastResumeAt === null) return this.accumulatedMs;
    const delta = now - this.lastResumeAt;
    return this.accumulatedMs + (delta > 0 ? delta : 0);
  }

  remainingMs(now: number = Date.now()): number {
    return Math.max(0, this.intervalMs - this.activeMs(now));
  }

  isDue(now: number = Date.now()): boolean {
    return this.enabled && this.activeMs(now) >= this.intervalMs;
  }

  /**
   * Returns `true` only on the tick that crosses the interval, so the screen can show the banner
   * once instead of re-showing it every second while it waits for the reader.
   */
  tick(now: number = Date.now()): boolean {
    if (!this.isDue(now)) return false;
    if (this.notified) return false;
    this.notified = true;
    return true;
  }

  pause(now: number = Date.now()): void {
    if (this.lastResumeAt === null) return;
    this.accumulatedMs = this.activeMs(now);
    this.lastResumeAt = null;
  }

  resume(now: number = Date.now()): void {
    if (this.lastResumeAt !== null) return;
    this.lastResumeAt = now;
  }

  /** The reader said «تم» (or tapped the banner): start a fresh stretch from now. */
  acknowledge(now: number = Date.now()): void {
    this.accumulatedMs = 0;
    this.notified = false;
    this.lastResumeAt = now;
  }

  setIntervalMinutes(minutes: number): void {
    this.intervalMs = clampIntervalMinutes(minutes) * 60_000;
  }

  setEnabled(enabled: boolean, now: number = Date.now()): void {
    if (this.enabled === enabled) return;
    if (!enabled) {
      this.pause(now);
    } else {
      this.resume(now);
    }
    this.enabled = enabled;
    if (!enabled) this.notified = false;
  }
}
