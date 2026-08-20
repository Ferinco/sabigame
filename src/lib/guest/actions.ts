"use server";

import { getGuestId, setGuestNickname } from "@/lib/guest/session";
import { validateNickname, type NicknameValidation } from "@/lib/guest/nickname";
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit";

export type SubmitNicknameResult = { ok: true } | { ok: false; error: string };

export async function submitNickname(nickname: string): Promise<SubmitNicknameResult> {
  const validation: NicknameValidation = validateNickname(nickname);

  if (!validation.ok) {
    return validation;
  }

  const guestId = await getGuestId();

  try {
    await checkRateLimit(`submit_nickname:${guestId}`, 10, 60);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  await setGuestNickname(guestId, validation.value);

  return { ok: true };
}
