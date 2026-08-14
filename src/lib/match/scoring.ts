export type AnswerFeedback = "correct" | "wrong" | "late";

export function deriveFeedback(result: { correct: boolean; claimed: boolean }): AnswerFeedback {
  if (!result.correct) return "wrong";
  return result.claimed ? "correct" : "late";
}
