import { describe, expect, it } from "vitest";
import { getBotName } from "./bot-names";

describe("getBotName", () => {
  it("is deterministic for the same id", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(getBotName(id)).toBe(getBotName(id));
  });

  it("returns a non-empty name for any UUID-shaped input", () => {
    const ids = [
      "00000000-0000-0000-0000-000000000000",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
      "550e8400-e29b-41d4-a716-446655440000",
    ];
    for (const id of ids) {
      expect(getBotName(id).length).toBeGreaterThan(0);
    }
  });

  it("varies across different ids", () => {
    const names = new Set(
      Array.from({ length: 20 }, (_, i) => getBotName(`id-${i}`))
    );
    expect(names.size).toBeGreaterThan(1);
  });
});
