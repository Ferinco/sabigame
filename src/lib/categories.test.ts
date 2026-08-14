import { describe, expect, it } from "vitest";
import { CATEGORIES, isCategory } from "./categories";

describe("isCategory", () => {
  it("accepts every value in CATEGORIES", () => {
    for (const category of CATEGORIES) {
      expect(isCategory(category)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isCategory("basketball")).toBe(false);
    expect(isCategory("")).toBe(false);
    expect(isCategory("Football")).toBe(false);
  });
});
