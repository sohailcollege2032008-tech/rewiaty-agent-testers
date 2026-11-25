/**
 * Convert engine `bookProgress` (0..1) into an integer display percentage (0..100).
 * Used across both the reader footer and library cards so percentages always match.
 */
export function progressToPercent(progress: number): number {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress * 100)));
}
