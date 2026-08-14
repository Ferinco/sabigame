export type WinCounts = { mine: number; opponent: number };

export function applyRoundWinner(
  current: WinCounts,
  winnerGuestId: string,
  myGuestId: string
): WinCounts {
  return winnerGuestId === myGuestId
    ? { ...current, mine: current.mine + 1 }
    : { ...current, opponent: current.opponent + 1 };
}

export function initialWinCounts(
  initialWinnerGuestId: string | null | undefined,
  myGuestId: string
): WinCounts {
  if (!initialWinnerGuestId) return { mine: 0, opponent: 0 };
  return applyRoundWinner({ mine: 0, opponent: 0 }, initialWinnerGuestId, myGuestId);
}

export type AnswerFeedback = "correct" | "wrong" | "late";

export function deriveFeedback(result: { correct: boolean; claimed: boolean }): AnswerFeedback {
  if (!result.correct) return "wrong";
  return result.claimed ? "correct" : "late";
}
