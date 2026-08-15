"use server";

import { getGuestId, setGuestNickname } from "@/lib/guest/session";
import { validateNickname, type NicknameValidation } from "@/lib/guest/nickname";

export type SubmitNicknameResult = { ok: true } | { ok: false; error: string };

export async function submitNickname(nickname: string): Promise<SubmitNicknameResult> {
  const validation: NicknameValidation = validateNickname(nickname);

  if (!validation.ok) {
    return validation;
  }

  const guestId = await getGuestId();
  await setGuestNickname(guestId, validation.value);

  return { ok: true };
}
