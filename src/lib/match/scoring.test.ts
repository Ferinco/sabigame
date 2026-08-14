import { describe, expect, it } from "vitest";
import { applyRoundWinner, deriveFeedback, initialWinCounts } from "./scoring";

describe("applyRoundWinner", () => {
  it("increments mine when I am the winner", () => {
    const result = applyRoundWinner({ mine: 0, opponent: 0 }, "me", "me");
    expect(result).toEqual({ mine: 1, opponent: 0 });
  });

  it("increments opponent when someone else is the winner", () => {
    const result = applyRoundWinner({ mine: 0, opponent: 0 }, "them", "me");
    expect(result).toEqual({ mine: 0, opponent: 1 });
  });

  it("does not mutate the input", () => {
    const input = { mine: 1, opponent: 2 };
    applyRoundWinner(input, "them", "me");
    expect(input).toEqual({ mine: 1, opponent: 2 });
  });
});

describe("initialWinCounts", () => {
  it("returns zeroes when there is no prior winner", () => {
    expect(initialWinCounts(null, "me")).toEqual({ mine: 0, opponent: 0 });
    expect(initialWinCounts(undefined, "me")).toEqual({ mine: 0, opponent: 0 });
  });

  it("credits me when I already won the initial round", () => {
    expect(initialWinCounts("me", "me")).toEqual({ mine: 1, opponent: 0 });
  });

  it("credits the opponent when someone else won the initial round", () => {
    expect(initialWinCounts("them", "me")).toEqual({ mine: 0, opponent: 1 });
  });
});

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
