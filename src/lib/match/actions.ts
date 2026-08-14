"use server";

import { getGuestId } from "@/lib/guest/session";
import { createAdminClient } from "@/lib/supabase/admin";

export type MatchInfo = {
  id: string;
  category: string;
  playerOneId: string;
  playerTwoId: string | null;
  startedAt: string;
  endedAt: string | null;
};

export type RoundInfo = {
  id: string;
  matchId: string;
  questionText: string;
  options: string[];
  startedAt: string;
  winnerGuestId: string | null;
};

export async function getMatch(matchId: string): Promise<MatchInfo | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("matches")
    .select("id, category, player_1_id, player_2_id, started_at, ended_at")
    .eq("id", matchId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch match: ${error.message}`);
  }

  if (!data) return null;

  return {
    id: data.id,
    category: data.category,
    playerOneId: data.player_1_id,
    playerTwoId: data.player_2_id,
    startedAt: data.started_at,
    endedAt: data.ended_at,
  };
}

export async function getCurrentRound(matchId: string): Promise<RoundInfo | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("match_rounds")
    .select("id, match_id, question_text, options, started_at, winner_guest_id")
    .eq("match_id", matchId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch current round: ${error.message}`);
  }

  if (!data) return null;

  return {
    id: data.id,
    matchId: data.match_id,
    questionText: data.question_text,
    options: data.options,
    startedAt: data.started_at,
    winnerGuestId: data.winner_guest_id,
  };
}

export type SubmitAnswerResult = {
  correct: boolean;
  claimed: boolean;
  matchEnded: boolean;
  nextRoundId: string | null;
};

export async function submitAnswer(
  roundId: string,
  answerIndex: number
): Promise<SubmitAnswerResult> {
  const guestId = await getGuestId();
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

export async function getMyGuestId(): Promise<string> {
  return getGuestId();
}
