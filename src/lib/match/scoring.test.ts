import { describe, expect, it } from "vitest";
import { deriveFeedback } from "./scoring";

describe("deriveFeedback", () => {
  it("is wrong when the answer was incorrect", () => {
    expect(deriveFeedback({ correct: false, claimed: false })).toBe("wrong");
  });

  it("is correct when correct and claimed first", () => {
    expect(deriveFeedback({ correct: true, claimed: true })).toBe("correct");
  });

  it("is late when correct but someone else claimed it first", () => {
    expect(deriveFeedback({ correct: true, claimed: false })).toBe("late");
  });
});
