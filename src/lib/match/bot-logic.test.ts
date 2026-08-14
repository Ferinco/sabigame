import { describe, expect, it } from "vitest";
import {
  BOT_CORRECT_CHANCE,
  BOT_MAX_DELAY_MS,
  BOT_MIN_DELAY_MS,
  pickBotAnswerIndex,
  pickBotDelayMs,
} from "./bot-logic";

describe("pickBotAnswerIndex", () => {
  it("returns the correct index when the random roll is below the correct chance", () => {
    const rand = () => 0;
    expect(pickBotAnswerIndex(2, 4, rand)).toBe(2);
  });

  it("returns a wrong index when the random roll is above the correct chance", () => {
    const rand = () => 0.99;
    const result = pickBotAnswerIndex(2, 4, rand);
    expect(result).not.toBe(2);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(4);
  });

  it("never returns the correct index when incorrect, across the full wrong-index range", () => {
    const indexPicks = [0, 0.3, 0.6, 0.99];
    for (const pick of indexPicks) {
      const queue = [0.99, pick];
      const rand = () => queue.shift()!;
      const result = pickBotAnswerIndex(1, 4, rand);
      expect(result).not.toBe(1);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(4);
    }
  });

  it("respects a custom correct chance", () => {
    const rand = () => 0.5;
    expect(pickBotAnswerIndex(0, 4, rand, 0.6)).toBe(0);
    expect(pickBotAnswerIndex(0, 4, rand, 0.4)).not.toBe(0);
  });

  it("defaults to the module correct chance of 0.55", () => {
    expect(BOT_CORRECT_CHANCE).toBe(0.55);
  });
});

describe("pickBotDelayMs", () => {
  it("stays within the configured delay bounds", () => {
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      const delay = pickBotDelayMs(() => roll);
      expect(delay).toBeGreaterThanOrEqual(BOT_MIN_DELAY_MS);
      expect(delay).toBeLessThanOrEqual(BOT_MAX_DELAY_MS);
    }
  });

  it("returns the minimum delay when the roll is 0", () => {
    expect(pickBotDelayMs(() => 0)).toBe(BOT_MIN_DELAY_MS);
  });
});
