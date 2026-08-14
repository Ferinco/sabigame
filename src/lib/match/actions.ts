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
  isBotMatch: boolean;
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
    .select("id, category, player_1_id, player_2_id, started_at, ended_at, is_bot_match")
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
    isBotMatch: data.is_bot_match,
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

export async function getMyGuestId(): Promise<string> {
  return getGuestId();
}

const BOT_MIN_DELAY_MS = 1200;
const BOT_MAX_DELAY_MS = 5500;
const BOT_CORRECT_CHANCE = 0.55;

export async function triggerBotMove(matchId: string, roundId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: match, error: matchError } = await admin
    .from("matches")
    .select("player_2_id, is_bot_match")
    .eq("id", matchId)
    .maybeSingle();

  if (matchError) {
    throw new Error(`Failed to fetch match for bot move: ${matchError.message}`);
  }

  if (!match?.is_bot_match || !match.player_2_id) return;

  const { data: round, error: roundError } = await admin
    .from("match_rounds")
    .select("question_id, options")
    .eq("id", roundId)
    .maybeSingle();

  if (roundError) {
    throw new Error(`Failed to fetch round for bot move: ${roundError.message}`);
  }

  if (!round) return;

  const { data: question, error: questionError } = await admin
    .from("questions")
    .select("correct_answer_index")
    .eq("id", round.question_id)
    .maybeSingle();

  if (questionError) {
    throw new Error(`Failed to fetch question for bot move: ${questionError.message}`);
  }

  if (!question) return;

  const delay =
    BOT_MIN_DELAY_MS + Math.random() * (BOT_MAX_DELAY_MS - BOT_MIN_DELAY_MS);
  await new Promise((resolve) => setTimeout(resolve, delay));

  const correctIndex = question.correct_answer_index;
  let answerIndex = correctIndex;

  if (Math.random() >= BOT_CORRECT_CHANCE) {
    const wrongIndices = round.options
      .map((_: string, i: number) => i)
      .filter((i: number) => i !== correctIndex);
    answerIndex = wrongIndices[Math.floor(Math.random() * wrongIndices.length)];
  }

  await callSubmitAnswer(match.player_2_id, roundId, answerIndex);
}
