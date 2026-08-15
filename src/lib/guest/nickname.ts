export const MAX_NICKNAME_LENGTH = 20;

export type NicknameValidation = { ok: true; value: string } | { ok: false; error: string };

export function validateNickname(raw: string): NicknameValidation {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { ok: false, error: "Enter a nickname" };
  }

  if (trimmed.length > MAX_NICKNAME_LENGTH) {
    return { ok: false, error: `Nickname must be ${MAX_NICKNAME_LENGTH} characters or fewer` };
  }

  return { ok: true, value: trimmed };
}
