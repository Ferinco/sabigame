"use server";

import { getGuestId } from "@/lib/guest/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCategory } from "@/lib/categories";
import { checkRateLimit } from "@/lib/rate-limit";

export type JoinQueueResult =
  | { status: "matched"; matchId: string; firstRoundId: string }
  | { status: "waiting" };

export async function joinMatchmakingQueue(category: string): Promise<JoinQueueResult> {
  if (!isCategory(category)) {
    throw new Error(`Invalid category: ${category}`);
  }

  const guestId = await getGuestId();
  await checkRateLimit(`join_queue:${guestId}`, 10, 60);

  const admin = createAdminClient();

  const { data, error } = await admin.rpc("matchmaking_try_form_match", {
    p_guest_id: guestId,
    p_category: category,
  });

  if (error) {
    throw new Error(`Failed to join matchmaking queue: ${error.message}`);
  }

  const row = data?.[0];

  if (row?.match_id) {
    return { status: "matched", matchId: row.match_id, firstRoundId: row.first_round_id };
  }

  return { status: "waiting" };
}

export type QueueStatus =
  | { status: "matched"; matchId: string }
  | { status: "waiting"; joinedAt: string }
  | { status: "idle" };

export async function checkMatchmakingStatus(): Promise<QueueStatus> {
  const guestId = await getGuestId();
  await checkRateLimit(`check_status:${guestId}`, 40, 60);

  const admin = createAdminClient();

  await admin.rpc("end_stale_matches");

  const { data: participant, error: participantError } = await admin
    .from("match_results")
    .select("match_id, matches!inner(ended_at)")
    .eq("player_id", guestId)
    .is("matches.ended_at", null)
    .limit(1)
    .maybeSingle();

  if (participantError) {
    throw new Error(`Failed to check match status: ${participantError.message}`);
  }

  if (participant) {
    return { status: "matched", matchId: participant.match_id };
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
    const { data: botData, error: botError } = await admin.rpc("matchmaking_bot_fallback", {
      p_guest_id: guestId,
    });

    if (botError) {
      throw new Error(`Failed to run bot fallback: ${botError.message}`);
    }

    const botRow = botData?.[0];

    if (botRow?.match_id) {
      return { status: "matched", matchId: botRow.match_id };
    }

    return { status: "waiting", joinedAt: queueEntry.joined_at };
  }

  return { status: "idle" };
}

export async function leaveMatchmakingQueue(): Promise<void> {
  const guestId = await getGuestId();
  const admin = createAdminClient();

  const { error } = await admin.from("matchmaking_queue").delete().eq("guest_id", guestId);

  if (error) {
    throw new Error(`Failed to leave matchmaking queue: ${error.message}`);
  }
}
