import { describe, expect, it } from "vitest";
import { computeRemainingMs } from "./countdown";

describe("computeRemainingMs", () => {
  it("returns the full remaining time right at start", () => {
    const expiresAt = "2026-01-01T00:00:05.000Z";
    const now = new Date("2026-01-01T00:00:00.000Z").getTime();
    expect(computeRemainingMs(expiresAt, now)).toBe(5_000);
  });

  it("counts down as time passes", () => {
    const expiresAt = "2026-01-01T00:00:05.000Z";
    const now = new Date("2026-01-01T00:00:02.000Z").getTime();
    expect(computeRemainingMs(expiresAt, now)).toBe(3_000);
  });

  it("never goes negative once expired", () => {
    const expiresAt = "2026-01-01T00:00:05.000Z";
    const now = new Date("2026-01-01T00:00:10.000Z").getTime();
    expect(computeRemainingMs(expiresAt, now)).toBe(0);
  });

  it("returns 0 immediately if expiresAt is already far in the past", () => {
    const expiresAt = "2020-01-01T00:00:00.000Z";
    expect(computeRemainingMs(expiresAt, Date.now())).toBe(0);
  });

  it("handles microsecond-precision Postgres timestamps", () => {
    const expiresAt = "2026-01-01T00:00:05.051273+00:00";
    const now = new Date("2026-01-01T00:00:00.051273Z").getTime();
    expect(computeRemainingMs(expiresAt, now)).toBe(5_000);
  });
});
