export type AnswerFeedback = "correct" | "wrong";

export function deriveFeedback(result: { correct: boolean }): AnswerFeedback {
  return result.correct ? "correct" : "wrong";
}
