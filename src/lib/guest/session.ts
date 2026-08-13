import "server-only";
import { cookies } from "next/headers";
import { GUEST_ID_COOKIE } from "./constants";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Reads the anonymous guest ID for the current request.
 * Guaranteed to exist for any request that passed through middleware.ts.
 */
export async function getGuestId(): Promise<string> {
  const cookieStore = await cookies();
  const guestId = cookieStore.get(GUEST_ID_COOKIE)?.value;

  if (!guestId) {
    throw new Error(
      "Missing guest ID cookie — middleware should have set this before the request reached here."
    );
  }

  return guestId;
}

/**
 * Upserts a guest_sessions row for the given guest ID. Safe to call on
 * every request — no-op (via ON CONFLICT DO NOTHING) if the row already
 * exists. Call this once per request (e.g. root layout) so every visitor
 * gets persisted before they touch matchmaking.
 */
export async function ensureGuestSession(guestId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("guest_sessions")
    .upsert({ anonymous_id: guestId }, { onConflict: "anonymous_id", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Failed to persist guest session: ${error.message}`);
  }
}

/**
 * Sets/updates the nickname for an existing guest session.
 */
export async function setGuestNickname(
  guestId: string,
  nickname: string
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("guest_sessions")
    .update({ nickname })
    .eq("anonymous_id", guestId);

  if (error) {
    throw new Error(`Failed to set guest nickname: ${error.message}`);
  }
}
