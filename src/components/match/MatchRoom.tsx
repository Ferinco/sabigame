"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { getBotName } from "@/lib/match/bot-names";

const EXPIRE_CALL_BUFFER_MS = 300;
const MEDALS = ["🥇", "🥈", "🥉"];
const ANSWER_STYLES = [
  { bg: "bg-accent-red", icon: "▲" },
  { bg: "bg-accent-blue", icon: "◆" },
  { bg: "bg-accent-yellow", icon: "●" },
  { bg: "bg-accent-green", icon: "■" },
];
const AVATAR_COLORS = ["bg-brand", "bg-accent-blue", "bg-accent-green", "bg-accent-yellow"];

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
  is_locked: boolean;
};

type DbMatchRow = {
  id: string;
  ended_at: string | null;
};

function displayName(p: ParticipantInfo, guestId: string): string {
  if (p.playerId === guestId) return "You";
  if (p.isBot) return getBotName(p.playerId);
  return p.nickname ?? "Player";
}

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

function CountdownRing({ timeLeftMs, totalMs }: { timeLeftMs: number; totalMs: number }) {
  const pct = totalMs > 0 ? Math.max(0, Math.min(1, timeLeftMs / totalMs)) : 0;
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);
  const color = pct > 0.5 ? "var(--accent-green)" : pct > 0.25 ? "var(--accent-yellow)" : "var(--accent-red)";

  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg viewBox="0 0 60 60" className="h-14 w-14 -rotate-90">
        <circle cx="30" cy="30" r={radius} fill="none" stroke="var(--card-border)" strokeWidth="6" />
        <circle
          cx="30"
          cy="30"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.2s linear, stroke 0.2s linear" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-base font-bold text-foreground">
        {Math.ceil(timeLeftMs / 1000)}
      </span>
    </div>
  );
}

function ConfettiBurst() {
  const colors = [
    "var(--accent-red)",
    "var(--accent-blue)",
    "var(--accent-yellow)",
    "var(--accent-green)",
    "var(--brand)",
  ];

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i / 12) * 2 * Math.PI;
        const distance = 50 + (i % 3) * 15;
        const style = {
          backgroundColor: colors[i % colors.length],
          "--tx": `${Math.cos(angle) * distance}px`,
          "--ty": `${Math.sin(angle) * distance}px`,
        } as React.CSSProperties;

        return <span key={i} className="confetti-dot absolute h-2.5 w-2.5 rounded-full" style={style} />;
      })}
    </div>
  );
}

export function MatchRoom({
  matchId,
  guestId,
  questionCount,
  initialRound,
  initialParticipants,
  initialMatchEnded,
}: {
  matchId: string;
  guestId: string;
  questionCount: number;
  initialRound: RoundInfo | null;
  initialParticipants: ParticipantInfo[];
  initialMatchEnded: boolean;
}) {
  const router = useRouter();
  const [round, setRound] = useState<RoundInfo | null>(initialRound);
  const [participants, setParticipants] = useState<ParticipantInfo[]>(initialParticipants);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [matchEnded, setMatchEnded] = useState(initialMatchEnded);
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
            current.map((p) =>
              p.playerId === row.player_id
                ? { ...p, score: row.score, isLocked: row.is_locked }
                : p
            )
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
    const me = participants.find((p) => p.playerId === guestId);

    return (
      <div className="flex flex-1 items-center justify-center bg-background px-6">
        <div className="animate-pop-in flex w-full max-w-sm flex-col items-center gap-6 py-16">
          <span className="text-5xl">🏆</span>
          <h1 className="font-display text-3xl font-extrabold text-foreground">
            Match ended!
          </h1>
          <ol className="flex w-full flex-col gap-2">
            {ranked.map((p, i) => (
              <li
                key={p.playerId}
                className="animate-bounce-in flex items-center gap-3 rounded-2xl border-2 border-card-border bg-card px-4 py-3 shadow-sm"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <span className="w-7 text-center text-xl">{MEDALS[i] ?? `${i + 1}.`}</span>
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}
                >
                  {displayName(p, guestId).charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 font-semibold text-foreground">
                  {displayName(p, guestId)}
                  {p.isLocked && " 🔒"}
                </span>
                <span className="font-display text-lg font-extrabold text-brand">
                  {p.score}
                </span>
              </li>
            ))}
          </ol>

          {me && !me.isBot && !me.isLocked && (
            <button
              onClick={() => router.push(`/match/${matchId}/lock`)}
              className="w-full rounded-2xl border-2 border-brand px-5 py-3.5 font-display font-bold text-brand transition-all hover:scale-[1.02] hover:bg-brand/10 active:scale-95"
            >
              🔒 Lock this score & join global ranking
            </button>
          )}

          <button
            onClick={() => {
              router.push("/");
              router.refresh();
            }}
            className="w-full rounded-2xl bg-brand px-5 py-3.5 font-display text-lg font-bold text-white shadow-lg shadow-brand/30 transition-all hover:scale-[1.02] hover:bg-brand-dark active:scale-95"
          >
            New Match
          </button>
        </div>
      </div>
    );
  }

  const totalMs = round ? new Date(round.expiresAt).getTime() - new Date(round.startedAt).getTime() : 5000;

  return (
    <div className="flex flex-1 flex-col items-center bg-background px-6 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <div className="flex w-full items-center justify-between">
          <span className="rounded-full bg-card px-4 py-1.5 text-sm font-bold text-muted shadow-sm">
            Question {round ? round.roundNumber : "-"} / {questionCount}
          </span>
          {round && <CountdownRing timeLeftMs={timeLeftMs} totalMs={totalMs} />}
        </div>

        <div className="flex w-full flex-wrap justify-center gap-2">
          {participants.map((p, i) => (
            <span
              key={p.playerId}
              className="flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-sm font-semibold text-foreground shadow-sm"
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}
              >
                {displayName(p, guestId).charAt(0).toUpperCase()}
              </span>
              {p.score}
            </span>
          ))}
        </div>

        {round ? (
          <>
            <h2
              key={round.id}
              className="animate-pop-in min-h-16 text-center font-display text-2xl font-bold text-foreground"
            >
              {round.questionText}
            </h2>
            <div className="relative grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
              {feedback === "correct" && <ConfettiBurst />}
              {round.options.map((option, index) => {
                const style = ANSWER_STYLES[index % ANSWER_STYLES.length];
                return (
                  <button
                    key={`${round.id}-${index}`}
                    onClick={() => handleAnswer(index)}
                    disabled={submitting || hasAnswered || Boolean(round.resolvedAt)}
                    className={`animate-bounce-in flex items-center gap-3 rounded-2xl ${style.bg} px-4 py-4 text-left font-semibold text-white shadow-lg transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:hover:scale-100`}
                    style={{ animationDelay: `${index * 60}ms` }}
                  >
                    <span className="text-lg">{style.icon}</span>
                    {option}
                  </button>
                );
              })}
            </div>
            {feedback === "correct" && (
              <p className="animate-bounce-in font-display text-xl font-bold text-accent-green">
                Correct! 🎉
              </p>
            )}
            {feedback === "wrong" && (
              <p className="animate-wiggle font-display text-xl font-bold text-accent-red">
                Not quite 😬
              </p>
            )}
            {hasAnswered && !round.resolvedAt && (
              <p className="text-muted">Waiting for other players…</p>
            )}
          </>
        ) : (
          <p className="text-muted">Loading question…</p>
        )}
      </div>
    </div>
  );
}
