/**
 * F24 — the fabric bookmark ribbon's drag arithmetic.
 *
 * Pulling DOWN past `RIBBON_PULL_THRESHOLD` saves the bookmark at the current position;
 * pulling UP past `RIBBON_RELEASE_THRESHOLD` on the extended (already saved) ribbon removes
 * it. Anything shorter — or a cancelled gesture — commits nothing, which is the whole point:
 * a page turn or a stray swipe must never leave a bookmark behind.
 *
 * Kept as pure functions so the invisible part of the gesture (which direction commits, how
 * far the ribbon is allowed to travel) is testable without a device.
 */

/** How far the ribbon must be pulled down before the release commits a save. */
export const RIBBON_PULL_THRESHOLD = 44;
/** How far the extended ribbon must be pushed up before the release removes the bookmark. */
export const RIBBON_RELEASE_THRESHOLD = 36;
/** The ribbon never travels further than this, however long the finger drags. */
export const RIBBON_MAX_PULL = 96;
export const RIBBON_MAX_PUSH = 72;
/** Movement smaller than this is a tap, not a drag; the Pressable keeps its own press. */
export const RIBBON_TAP_SLOP = 8;

export type RibbonCommit = 'add' | 'remove' | 'none';

/**
 * The ribbon follows the finger 1:1 inside a bounded range, so a long drag cannot pull it off
 * the page and a non-finite translation (a dropped event) cannot poison the animated style.
 */
export function clampRibbonOffset(translationY: number): number {
  if (!Number.isFinite(translationY)) return 0;
  return Math.max(-RIBBON_MAX_PUSH, Math.min(RIBBON_MAX_PULL, translationY));
}

/**
 * What a RELEASED gesture means. `canceled` wins over distance: a gesture the system took back
 * (a parent scroll, an incoming call) must never save or delete anything.
 */
export function resolveRibbonCommit(input: {
  translationY: number;
  isBookmarked: boolean;
  canceled?: boolean;
}): RibbonCommit {
  if (input.canceled) return 'none';
  if (!Number.isFinite(input.translationY)) return 'none';
  if (!input.isBookmarked && input.translationY >= RIBBON_PULL_THRESHOLD) return 'add';
  if (input.isBookmarked && input.translationY <= -RIBBON_RELEASE_THRESHOLD) return 'remove';
  return 'none';
}

/**
 * Whether the finger is currently past the commit point. This is the moment the haptic tick
 * plays — once per gesture, tracked by the caller — not the release.
 */
export function ribbonCrossesThreshold(input: {
  translationY: number;
  isBookmarked: boolean;
}): boolean {
  return resolveRibbonCommit(input) !== 'none';
}
