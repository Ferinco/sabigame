import { type NextRequest } from "next/server";
import { GUEST_ID_COOKIE } from "./constants";

/**
 * Guarantees the incoming request carries a guest ID cookie.
 * Mutates `request.cookies` in place (before any NextResponse is built off
 * of `request`) so Server Components rendered for this same request can
 * already read it via `cookies()`. Caller is responsible for also setting
 * the cookie on the outgoing response when `isNew` is true, so the browser
 * persists it for future requests.
 */
export function ensureGuestId(request: NextRequest): {
  value: string;
  isNew: boolean;
} {
  const existing = request.cookies.get(GUEST_ID_COOKIE)?.value;
  if (existing) {
    return { value: existing, isNew: false };
  }

  const value = crypto.randomUUID();
  request.cookies.set(GUEST_ID_COOKIE, value);
  return { value, isNew: true };
}
