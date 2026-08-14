"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  submitAnswer,
  triggerBotMove,
  expireRound,
  type RoundInfo,
  type ParticipantInfo,
} from "@/lib/match/actions";
import { computeRemainingMs } from "@/lib/match/countdown";
import { deriveFeedback } from "@/lib/match/scoring";

const EXPIRE_CALL_BUFFER_MS = 300;

type DbRoundRow = {
  id: string;
  match_id: string;
  round_number: number;
  question_text: string;
  options: string[];
  started_at: string;
  expires_at: string;
  resolved_at: string | null;
};

type DbMatchResultRow = {
  match_id: string;
  player_id: string;
  is_bot: boolean;
  score: number;
};

type DbMatchRow = {
  id: string;
  ended_at: string | null;
};

function mapRound(row: DbRoundRow): RoundInfo {
  return {
    id: row.id,
    matchId: row.match_id,
    roundNumber: row.round_number,
    questionText: row.question_text,
    options: row.options,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
  };
}

export function MatchRoom({
  matchId,
  guestId,
  questionCount,
  initialRound,
  initialParticipants,
}: {
  matchId: string;
  guestId: string;
  questionCount: number;
  initialRound: RoundInfo | null;
  initialParticipants: ParticipantInfo[];
}) {
  const [round, setRound] = useState<RoundInfo | null>(initialRound);
  const [participants, setParticipants] = useState<ParticipantInfo[]>(initialParticipants);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [matchEnded, setMatchEnded] = useState(false);
  const [timeLeftMs, setTimeLeftMs] = useState(() =>
    initialRound ? computeRemainingMs(initialRound.expiresAt, Date.now()) : 0
  );

  const roundRef = useRef(round);
  const botTriggeredKeys = useRef(new Set<string>());
  const expireTriggeredRounds = useRef(new Set<string>());
  const [seenRoundId, setSeenRoundId] = useState(round?.id ?? null);

  if (round?.id !== seenRoundId) {
    setSeenRoundId(round?.id ?? null);
    setHasAnswered(false);
    setFeedback(null);
  }

  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  useEffect(() => {
    if (!round) return;
    const interval = setInterval(() => {
      setTimeLeftMs(computeRemainingMs(round.expiresAt, Date.now()));
    }, 250);
    return () => clearInterval(interval);
  }, [round]);

  useEffect(() => {
    if (!round || round.resolvedAt) return;
    if (expireTriggeredRounds.current.has(round.id)) return;
    expireTriggeredRounds.current.add(round.id);

    const delay = computeRemainingMs(round.expiresAt, Date.now()) + EXPIRE_CALL_BUFFER_MS;
    const timeout = setTimeout(() => {
      expireRound(round.id).catch(() => {});
    }, delay);

    return () => clearTimeout(timeout);
  }, [round]);

  useEffect(() => {
    if (!round || round.resolvedAt) return;

    for (const participant of participants) {
      if (!participant.isBot) continue;
      const key = `${round.id}:${participant.playerId}`;
      if (botTriggeredKeys.current.has(key)) continue;
      botTriggeredKeys.current.add(key);
      triggerBotMove(participant.playerId, round.id).catch(() => {});
    }
  }, [round, participants]);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`match-${matchId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "match_rounds", filter: `match_id=eq.${matchId}` },
        (payload) => {
          setRound(mapRound(payload.new as DbRoundRow));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "match_rounds", filter: `match_id=eq.${matchId}` },
        (payload) => {
          const row = payload.new as DbRoundRow;
          if (roundRef.current && row.id === roundRef.current.id) {
            setRound(mapRound(row));
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "match_results", filter: `match_id=eq.${matchId}` },
        (payload) => {
          const row = payload.new as DbMatchResultRow;
          setParticipants((current) =>
            current.map((p) => (p.playerId === row.player_id ? { ...p, score: row.score } : p))
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
        (payload) => {
          const row = payload.new as DbMatchRow;
          if (row.ended_at) setMatchEnded(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId]);

  async function handleAnswer(index: number) {
    if (!round || submitting || matchEnded || hasAnswered || round.resolvedAt) return;

    setSubmitting(true);
    try {
      const result = await submitAnswer(round.id, index);

      if (result.recorded) {
        setHasAnswered(true);
        setFeedback(deriveFeedback(result));
      }

      if (result.matchEnded) {
        setMatchEnded(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (matchEnded) {
    const ranked = [...participants].sort((a, b) => b.score - a.score);

    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
        <div className="flex w-full max-w-sm flex-col items-center gap-6">
          <h1 className="text-2xl font-bold text-black dark:text-zinc-50">Match ended</h1>
          <ol className="flex w-full flex-col gap-2">
            {ranked.map((p, i) => (
              <li
                key={p.playerId}
                className="flex items-center justify-between rounded-lg border border-black/[.08] bg-white px-4 py-2 dark:border-white/[.145] dark:bg-zinc-900"
              >
                <span>
                  {i + 1}. {p.playerId === guestId ? "You" : p.isBot ? "Bot" : "Player"}
                </span>
                <span className="font-semibold">{p.score}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-12 dark:bg-black">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <div className="flex w-full items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
          <span>Question {round ? round.roundNumber : "-"} / {questionCount}</span>
          <span>{Math.ceil(timeLeftMs / 1000)}s</span>
        </div>

        <div className="flex w-full flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
          {participants.map((p) => (
            <span key={p.playerId}>
              {p.playerId === guestId ? "You" : p.isBot ? "Bot" : "Player"}: {p.score}
            </span>
          ))}
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
                  disabled={submitting || hasAnswered || Boolean(round.resolvedAt)}
                  className="rounded-xl border border-black/[.08] bg-white px-4 py-3 text-left transition-colors hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.145] dark:bg-zinc-900 dark:hover:bg-white/[.08]"
                >
                  {option}
                </button>
              ))}
            </div>
            {feedback === "correct" && <p className="text-green-600">Correct!</p>}
            {feedback === "wrong" && <p className="text-red-600">Wrong</p>}
            {hasAnswered && !round.resolvedAt && (
              <p className="text-zinc-500">Waiting for other players…</p>
            )}
          </>
        ) : (
          <p className="text-zinc-600 dark:text-zinc-400">Loading question…</p>
        )}
      </div>
    </div>
  );
}
