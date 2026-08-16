import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export async function lockMatchScore(
  matchId: string,
  guestId: string,
  userId: string
): Promise<void> {
  const admin = createAdminClient();

  const { data: session, error: sessionError } = await admin
    .from("guest_sessions")
    .select("nickname")
    .eq("anonymous_id", guestId)
    .maybeSingle();

  if (sessionError) {
    throw new Error(`Failed to fetch guest nickname for lock: ${sessionError.message}`);
  }

  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ id: userId, nickname: session?.nickname ?? null }, { onConflict: "id" });

  if (profileError) {
    throw new Error(`Failed to upsert profile: ${profileError.message}`);
  }

  const { error } = await admin
    .from("match_results")
    .update({ player_id: userId, is_locked: true })
    .eq("match_id", matchId)
    .eq("player_id", guestId);

  if (error) {
    throw new Error(`Failed to lock match score: ${error.message}`);
  }
}
