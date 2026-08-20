"use server";

import { getGuestId } from "@/lib/guest/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { pickBotAnswerIndex, pickBotDelayMs } from "@/lib/match/bot-logic";
import { checkRateLimit } from "@/lib/rate-limit";

export type MatchInfo = {
  id: string;
  category: string;
  startedAt: string;
  endedAt: string | null;
  questionCount: number;
  questionDurationMs: number;
};

export type ParticipantInfo = {
  playerId: string;
  isBot: boolean;
  score: number;
  nickname: string | null;
  isLocked: boolean;
};

export type RoundInfo = {
  id: string;
  matchId: string;
  roundNumber: number;
  questionText: string;
  options: string[];
  startedAt: string;
  expiresAt: string;
  resolvedAt: string | null;
};

export async function getMatch(matchId: string): Promise<MatchInfo | null> {
  const admin = createAdminClient();

  await admin.rpc("end_stale_matches");

  const { data, error } = await admin
    .from("matches")
    .select("id, category, started_at, ended_at, question_count, question_duration_ms")
    .eq("id", matchId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch match: ${error.message}`);
  }

  if (!data) return null;

  return {
    id: data.id,
    category: data.category,
    startedAt: data.started_at,
    endedAt: data.ended_at,
    questionCount: data.question_count,
    questionDurationMs: data.question_duration_ms,
  };
}

export async function getParticipants(matchId: string): Promise<ParticipantInfo[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("match_results")
    .select("player_id, is_bot, score, is_locked")
    .eq("match_id", matchId);

  if (error) {
    throw new Error(`Failed to fetch participants: ${error.message}`);
  }

  const rows = data ?? [];
  const humanIds = rows.filter((row) => !row.is_bot).map((row) => row.player_id);

  const nicknamesByPlayerId: Record<string, string | null> = {};

  if (humanIds.length > 0) {
    const { data: sessions, error: sessionsError } = await admin
      .from("guest_sessions")
      .select("anonymous_id, nickname")
      .in("anonymous_id", humanIds);

    if (sessionsError) {
      throw new Error(`Failed to fetch participant nicknames: ${sessionsError.message}`);
    }

    for (const session of sessions ?? []) {
      nicknamesByPlayerId[session.anonymous_id] = session.nickname;
    }
  }

  return rows.map((row) => ({
    playerId: row.player_id,
    isBot: row.is_bot,
    score: row.score,
    nickname: row.is_bot ? null : nicknamesByPlayerId[row.player_id] ?? null,
    isLocked: row.is_locked,
  }));
}

export async function getMyParticipantId(matchId: string): Promise<string> {
  const guestId = await getGuestId();
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("match_results")
      .select("player_id")
      .eq("match_id", matchId)
      .eq("player_id", user.id)
      .maybeSingle();

    if (data) return user.id;
  }

  return guestId;
}

export async function getCurrentRound(matchId: string): Promise<RoundInfo | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("match_rounds")
    .select("id, match_id, round_number, question_text, options, started_at, expires_at, resolved_at")
    .eq("match_id", matchId)
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch current round: ${error.message}`);
  }

  if (!data) return null;

  return {
    id: data.id,
    matchId: data.match_id,
    roundNumber: data.round_number,
    questionText: data.question_text,
    options: data.options,
    startedAt: data.started_at,
    expiresAt: data.expires_at,
    resolvedAt: data.resolved_at,
  };
}

export type SubmitAnswerResult = {
  correct: boolean;
  recorded: boolean;
  matchEnded: boolean;
  nextRoundId: string | null;
};

async function callSubmitAnswer(
  guestId: string,
  roundId: string,
  answerIndex: number
): Promise<SubmitAnswerResult> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("submit_answer", {
    p_round_id: roundId,
    p_guest_id: guestId,
    p_answer_index: answerIndex,
  });

  if (error) {
    throw new Error(`Failed to submit answer: ${error.message}`);
  }

  const row = data?.[0];

  return {
    correct: Boolean(row?.correct),
    recorded: Boolean(row?.recorded),
    matchEnded: Boolean(row?.match_ended),
    nextRoundId: row?.next_round_id ?? null,
  };
}

export async function submitAnswer(
  roundId: string,
  answerIndex: number
): Promise<SubmitAnswerResult> {
  const guestId = await getGuestId();
  await checkRateLimit(`submit_answer:${guestId}`, 30, 60);
  return callSubmitAnswer(guestId, roundId, answerIndex);
}

export type ExpireRoundResult = {
  matchEnded: boolean;
  nextRoundId: string | null;
};

export async function expireRound(roundId: string): Promise<ExpireRoundResult> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("expire_round", { p_round_id: roundId });

  if (error) {
    throw new Error(`Failed to expire round: ${error.message}`);
  }

  const row = data?.[0];

  return {
    matchEnded: Boolean(row?.match_ended),
    nextRoundId: row?.next_round_id ?? null,
  };
}

export async function getMyGuestId(): Promise<string> {
  return getGuestId();
}

export async function triggerBotMove(botPlayerId: string, roundId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: round, error: roundError } = await admin
    .from("match_rounds")
    .select("question_id, options, resolved_at")
    .eq("id", roundId)
    .maybeSingle();

  if (roundError) {
    throw new Error(`Failed to fetch round for bot move: ${roundError.message}`);
  }

  if (!round || round.resolved_at) return;

  const { data: question, error: questionError } = await admin
    .from("questions")
    .select("correct_answer_index")
    .eq("id", round.question_id)
    .maybeSingle();

  if (questionError) {
    throw new Error(`Failed to fetch question for bot move: ${questionError.message}`);
  }

  if (!question) return;

  await new Promise((resolve) => setTimeout(resolve, pickBotDelayMs()));

  const answerIndex = pickBotAnswerIndex(question.correct_answer_index, round.options.length);

  await callSubmitAnswer(botPlayerId, roundId, answerIndex);
}
