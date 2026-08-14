import { describe, expect, it } from "vitest";
import { deriveFeedback } from "./scoring";

describe("deriveFeedback", () => {
  it("is wrong when the answer was incorrect", () => {
    expect(deriveFeedback({ correct: false })).toBe("wrong");
  });

  it("is correct when the answer was correct", () => {
    expect(deriveFeedback({ correct: true })).toBe("correct");
  });
});
