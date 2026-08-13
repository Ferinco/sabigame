import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { ensureGuestId } from "@/lib/guest/middleware";
import { GUEST_ID_COOKIE, GUEST_ID_COOKIE_MAX_AGE } from "@/lib/guest/constants";

export async function middleware(request: NextRequest) {
  const guestId = ensureGuestId(request);

  const response = await updateSession(request);

  if (guestId.isNew) {
    response.cookies.set(GUEST_ID_COOKIE, guestId.value, {
      maxAge: GUEST_ID_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
    });
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
