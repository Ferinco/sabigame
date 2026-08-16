"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export type LeaderboardEntry = {
  playerId: string;
  nickname: string | null;
  totalScore: number;
  matchesPlayed: number;
};

export async function getLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("leaderboard")
    .select("player_id, nickname, total_score, matches_played")
    .order("total_score", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch leaderboard: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    playerId: row.player_id,
    nickname: row.nickname,
    totalScore: row.total_score,
    matchesPlayed: row.matches_played,
  }));
}
