import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export async function lockMatchScore(
  matchId: string,
  guestId: string,
  userId: string
): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin
    .from("match_results")
    .update({ player_id: userId, is_locked: true })
    .eq("match_id", matchId)
    .eq("player_id", guestId);

  if (error) {
    throw new Error(`Failed to lock match score: ${error.message}`);
  }
}
