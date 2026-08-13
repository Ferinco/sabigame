"use server";

import { getGuestId } from "@/lib/guest/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCategory, type Category } from "@/lib/categories";

export type JoinQueueResult =
  | { status: "matched"; matchId: string; opponentId: string }
  | { status: "waiting" };

export async function joinMatchmakingQueue(
  category: string
): Promise<JoinQueueResult> {
  if (!isCategory(category)) {
    throw new Error(`Invalid category: ${category}`);
  }

  const guestId = await getGuestId();
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("matchmaking_try_pair", {
    p_guest_id: guestId,
    p_category: category,
  });

  if (error) {
    throw new Error(`Failed to join matchmaking queue: ${error.message}`);
  }

  const row = data?.[0];

  if (row?.match_id) {
    return { status: "matched", matchId: row.match_id, opponentId: row.opponent_id };
  }

  return { status: "waiting" };
}

export type QueueStatus =
  | { status: "matched"; matchId: string }
  | { status: "waiting"; joinedAt: string }
  | { status: "idle" };

export async function checkMatchmakingStatus(): Promise<QueueStatus> {
  const guestId = await getGuestId();
  const admin = createAdminClient();

  const { data: match, error: matchError } = await admin
    .from("matches")
    .select("id, started_at")
    .or(`player_1_id.eq.${guestId},player_2_id.eq.${guestId}`)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (matchError) {
    throw new Error(`Failed to check match status: ${matchError.message}`);
  }

  if (match) {
    return { status: "matched", matchId: match.id };
  }

  const { data: queueEntry, error: queueError } = await admin
    .from("matchmaking_queue")
    .select("joined_at")
    .eq("guest_id", guestId)
    .maybeSingle();

  if (queueError) {
    throw new Error(`Failed to check queue status: ${queueError.message}`);
  }

  if (queueEntry) {
    return { status: "waiting", joinedAt: queueEntry.joined_at };
  }

  return { status: "idle" };
}

export async function leaveMatchmakingQueue(): Promise<void> {
  const guestId = await getGuestId();
  const admin = createAdminClient();

  const { error } = await admin
    .from("matchmaking_queue")
    .delete()
    .eq("guest_id", guestId);

  if (error) {
    throw new Error(`Failed to leave matchmaking queue: ${error.message}`);
  }
}

export type { Category };
