"use server";

import { getGuestId } from "@/lib/guest/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { pickBotAnswerIndex, pickBotDelayMs } from "@/lib/match/bot-logic";

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
};

export type RoundInfo = {
  id: string;
  matchId: string;
  roundNumber: number;
  questionText: string;
  options: string[];
  startedAt: string;
  expiresAt: string;
  winnerGuestId: string | null;
};

export async function getMatch(matchId: string): Promise<MatchInfo | null> {
  const admin = createAdminClient();

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
    .select("player_id, is_bot, score")
    .eq("match_id", matchId);

  if (error) {
    throw new Error(`Failed to fetch participants: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    playerId: row.player_id,
    isBot: row.is_bot,
    score: row.score,
  }));
}

export async function getCurrentRound(matchId: string): Promise<RoundInfo | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("match_rounds")
    .select("id, match_id, round_number, question_text, options, started_at, expires_at, winner_guest_id")
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
    winnerGuestId: data.winner_guest_id,
  };
}

export type SubmitAnswerResult = {
  correct: boolean;
  claimed: boolean;
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
    claimed: Boolean(row?.claimed),
    matchEnded: Boolean(row?.match_ended),
    nextRoundId: row?.next_round_id ?? null,
  };
}

export async function submitAnswer(
  roundId: string,
  answerIndex: number
): Promise<SubmitAnswerResult> {
  const guestId = await getGuestId();
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
    .select("question_id, options, winner_guest_id")
    .eq("id", roundId)
    .maybeSingle();

  if (roundError) {
    throw new Error(`Failed to fetch round for bot move: ${roundError.message}`);
  }

  if (!round || round.winner_guest_id) return;

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
