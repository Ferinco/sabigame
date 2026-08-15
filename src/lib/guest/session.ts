import "server-only";
import { headers } from "next/headers";
import { GUEST_ID_HEADER } from "./constants";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getGuestId(): Promise<string> {
  const headerStore = await headers();
  const guestId = headerStore.get(GUEST_ID_HEADER);

  if (!guestId) {
    throw new Error("Missing guest ID header — proxy.ts should have set this.");
  }

  return guestId;
}

export async function ensureGuestSession(guestId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("guest_sessions")
    .upsert({ anonymous_id: guestId }, { onConflict: "anonymous_id", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Failed to persist guest session: ${error.message}`);
  }
}

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

export async function getGuestNickname(guestId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("guest_sessions")
    .select("nickname")
    .eq("anonymous_id", guestId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch guest nickname: ${error.message}`);
  }

  return data?.nickname ?? null;
}
