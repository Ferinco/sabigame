export function computeRemainingMs(expiresAt: string, now: number): number {
  return Math.max(0, new Date(expiresAt).getTime() - now);
}
