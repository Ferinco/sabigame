"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { submitAnswer, triggerBotMove, type RoundInfo } from "@/lib/match/actions";

const MATCH_DURATION_MS = 15_000;

type DbRoundRow = {
  id: string;
  match_id: string;
  question_text: string;
  options: string[];
  started_at: string;
  winner_guest_id: string | null;
};

function mapRound(row: DbRoundRow): RoundInfo {
  return {
    id: row.id,
    matchId: row.match_id,
    questionText: row.question_text,
    options: row.options,
    startedAt: row.started_at,
    winnerGuestId: row.winner_guest_id,
  };
}

export function MatchRoom({
  matchId,
  guestId,
  startedAt,
  initialRound,
  isBotMatch,
}: {
  matchId: string;
  guestId: string;
  startedAt: string;
  initialRound: RoundInfo | null;
  isBotMatch: boolean;
}) {
  const [round, setRound] = useState<RoundInfo | null>(initialRound);
  const [wins, setWins] = useState(() => {
    if (initialRound?.winnerGuestId === guestId) return { mine: 1, opponent: 0 };
    if (initialRound?.winnerGuestId) return { mine: 0, opponent: 1 };
    return { mine: 0, opponent: 0 };
  });
  const [feedback, setFeedback] = useState<"correct" | "wrong" | "late" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [matchEnded, setMatchEnded] = useState(false);
  const [timeLeftMs, setTimeLeftMs] = useState(MATCH_DURATION_MS);
  const countedRounds = useRef(
    new Set<string>(initialRound?.winnerGuestId ? [initialRound.id] : [])
  );
  const botTriggeredRounds = useRef(new Set<string>());

  useEffect(() => {
    const endsAt = new Date(startedAt).getTime() + MATCH_DURATION_MS;
    const interval = setInterval(() => {
      const remaining = Math.max(0, endsAt - Date.now());
      setTimeLeftMs(remaining);
      if (remaining <= 0) {
        setMatchEnded(true);
        clearInterval(interval);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [startedAt]);

  useEffect(() => {
    if (!isBotMatch || !round || round.winnerGuestId) return;
    if (botTriggeredRounds.current.has(round.id)) return;
    botTriggeredRounds.current.add(round.id);
    triggerBotMove(matchId, round.id).catch(() => {});
  }, [isBotMatch, matchId, round]);

  useEffect(() => {
    const supabase = createClient();

    function handleWinner(roundId: string, winnerGuestId: string | null) {
      if (!winnerGuestId || countedRounds.current.has(roundId)) return;
      countedRounds.current.add(roundId);
      setWins((w) =>
        winnerGuestId === guestId
          ? { ...w, mine: w.mine + 1 }
          : { ...w, opponent: w.opponent + 1 }
      );
    }

    const channel = supabase
      .channel(`match-rounds-${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "match_rounds",
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const row = payload.new as DbRoundRow;
          setRound(mapRound(row));
          setFeedback(null);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "match_rounds",
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const row = payload.new as DbRoundRow;
          handleWinner(row.id, row.winner_guest_id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, guestId]);

  async function handleAnswer(index: number) {
    if (!round || submitting || matchEnded || round.winnerGuestId) return;

    setSubmitting(true);
    try {
      const result = await submitAnswer(round.id, index);

      if (result.correct && result.claimed) {
        setFeedback("correct");
      } else if (!result.correct) {
        setFeedback("wrong");
      } else {
        setFeedback("late");
      }

      if (result.matchEnded) {
        setMatchEnded(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (matchEnded) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-bold text-black dark:text-zinc-50">
            Match ended
          </h1>
          <p className="text-lg text-zinc-600 dark:text-zinc-400">
            You: {wins.mine} — Opponent: {wins.opponent}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-12 dark:bg-black">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <div className="flex w-full items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
          <span>You: {wins.mine}</span>
          <span>{Math.ceil(timeLeftMs / 1000)}s</span>
          <span>Opponent{isBotMatch ? " (bot)" : ""}: {wins.opponent}</span>
        </div>

        {round ? (
          <>
            <h2 className="text-center text-xl font-semibold text-black dark:text-zinc-50">
              {round.questionText}
            </h2>
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
              {round.options.map((option, index) => (
                <button
                  key={index}
                  onClick={() => handleAnswer(index)}
                  disabled={submitting || Boolean(round.winnerGuestId)}
                  className="rounded-xl border border-black/[.08] bg-white px-4 py-3 text-left transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.145] dark:bg-zinc-900 dark:hover:bg-white/[.08]"
                >
                  {option}
                </button>
              ))}
            </div>
            {feedback === "correct" && (
              <p className="text-green-600">Correct!</p>
            )}
            {feedback === "wrong" && <p className="text-red-600">Wrong</p>}
            {feedback === "late" && (
              <p className="text-zinc-500">Opponent got it first</p>
            )}
          </>
        ) : (
          <p className="text-zinc-600 dark:text-zinc-400">Loading question…</p>
        )}
      </div>
    </div>
  );
}
