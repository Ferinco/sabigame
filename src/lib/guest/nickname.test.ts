import { describe, expect, it } from "vitest";
import { validateNickname } from "./nickname";

describe("validateNickname", () => {
  it("rejects empty input", () => {
    expect(validateNickname("").ok).toBe(false);
    expect(validateNickname("   ").ok).toBe(false);
  });

  it("trims surrounding whitespace", () => {
    const result = validateNickname("  Ada  ");
    expect(result).toEqual({ ok: true, value: "Ada" });
  });

  it("accepts a name at the max length", () => {
    const name = "a".repeat(20);
    expect(validateNickname(name)).toEqual({ ok: true, value: name });
  });

  it("rejects a name over the max length", () => {
    const name = "a".repeat(21);
    const result = validateNickname(name);
    expect(result.ok).toBe(false);
  });
});
