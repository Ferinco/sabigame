import { describe, expect, it } from "vitest";
import { computeRemainingMs, MATCH_DURATION_MS } from "./countdown";

describe("computeRemainingMs", () => {
  it("returns the full duration right at start", () => {
    const startedAt = "2026-01-01T00:00:00.000Z";
    const now = new Date(startedAt).getTime();
    expect(computeRemainingMs(startedAt, now)).toBe(MATCH_DURATION_MS);
  });

  it("counts down as time passes", () => {
    const startedAt = "2026-01-01T00:00:00.000Z";
    const now = new Date(startedAt).getTime() + 5_000;
    expect(computeRemainingMs(startedAt, now)).toBe(MATCH_DURATION_MS - 5_000);
  });

  it("never goes negative once the duration has elapsed", () => {
    const startedAt = "2026-01-01T00:00:00.000Z";
    const now = new Date(startedAt).getTime() + MATCH_DURATION_MS + 60_000;
    expect(computeRemainingMs(startedAt, now)).toBe(0);
  });

  it("returns 0 immediately if startedAt is already far in the past", () => {
    const startedAt = "2020-01-01T00:00:00.000Z";
    expect(computeRemainingMs(startedAt, Date.now())).toBe(0);
  });

  it("handles microsecond-precision Postgres timestamps", () => {
    const startedAt = "2026-01-01T00:00:00.051273+00:00";
    const now = new Date("2026-01-01T00:00:00.051273Z").getTime();
    expect(computeRemainingMs(startedAt, now)).toBe(MATCH_DURATION_MS);
  });
});
