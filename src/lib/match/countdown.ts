export const MATCH_DURATION_MS = 15_000;

export function computeRemainingMs(
  startedAt: string,
  now: number,
  durationMs: number = MATCH_DURATION_MS
): number {
  const endsAt = new Date(startedAt).getTime() + durationMs;
  return Math.max(0, endsAt - now);
}
